'use strict';

/**
 * Contas do Game Together, sem senha.
 *
 * Uma conta é só um nickname. Quem cria recebe um token assinado (HMAC) que
 * fica salvo no aparelho. O token prova a identidade mesmo que o servidor
 * reinicie e perca o arquivo de contas: ao reconectar, a conta é recriada
 * a partir do token ("recuperação"). A conta só sai do aparelho quando a
 * pessoa clica em Sair ou aprova a transferência para outro aparelho.
 *
 * A conta pode estar em vários aparelhos ao mesmo tempo, mas cada aparelho
 * novo só entra depois que um aparelho que já está na conta aprova o pedido.
 *
 * SESSION_SECRET (variável de ambiente) assina os tokens. Sem ela, um
 * segredo é gerado e salvo em DATA_DIR/secret; se esse arquivo se perder,
 * os tokens antigos deixam de valer.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 20;
const MAX_DEVICES = 10;

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(s, 'base64url').toString('utf8');

function normalize(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

class Auth {
  constructor({ dataDir, file, now, secret } = {}) {
    this.dataDir = dataDir || path.join(__dirname, '..', 'data');
    this.file = file || path.join(this.dataDir, 'users.json');
    this.now = now || (() => Date.now());
    this.bootAt = this.now();   // tokens emitidos antes disto vieram de um servidor anterior
    this.secret = secret || process.env.SESSION_SECRET || this.loadOrCreateSecret();
    this.users = new Map();     // nameLower -> { name, tokens: [], createdAt, lastSeen, requests: [] }
    this.tokens = new Map();    // token -> nameLower
    this.requests = new Map();  // requestId -> { id, nameLower, createdAt, status, token }
    this.deleted = new Map();   // nameLower -> quando a pessoa clicou em Sair (tokens anteriores morrem)
    this.banned = new Set();    // nicknames banidos pela administração
    this.titles = new Map();    // nickname (chave) -> título mostrado ao lado do nome ("Dono", "Mod"...)
    this.load();
  }

  loadOrCreateSecret() {
    const file = path.join(this.dataDir, 'secret');
    try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { /* cria */ }
    const secret = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.writeFileSync(file, secret); } catch (_) { /* segue em memória */ }
    return secret;
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, at] of Object.entries(raw.deleted || {})) this.deleted.set(k, at);
      for (const k of raw.banned || []) this.banned.add(k);
      for (const [k, v] of Object.entries(raw.titles || {})) this.titles.set(k, v);
      if (raw.owner && !this.titles.has(raw.owner)) this.titles.set(raw.owner, 'Dono');
      for (const u of raw.users || []) {
        const key = u.name.toLowerCase();
        u.requests = u.requests || [];
        u.tokens = u.tokens || (u.token ? [u.token] : []);
        delete u.token;
        u.loaded = true; // existia no arquivo: só aceita tokens da lista
        this.users.set(key, u);
        for (const tk of u.tokens) this.tokens.set(tk, key);
        for (const r of u.requests) this.requests.set(r.id, { ...r, nameLower: key });
      }
    } catch (_) {
      // sem arquivo ainda
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      const users = [...this.users.values()].map(({ loaded, ...u }) => u);
      fs.writeFileSync(tmp, JSON.stringify({ users, deleted: Object.fromEntries(this.deleted), banned: [...this.banned], titles: Object.fromEntries(this.titles) }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('não consegui salvar as contas:', err.message);
    }
  }

  static validName(name) {
    const n = normalize(name);
    return NAME_RE.test(n) && n.length >= 3;
  }

  // ---- tokens assinados: v2.<nome>.<issuedAt>.<device>.<assinatura>
  sign(parts) {
    return crypto.createHmac('sha256', this.secret).update(parts.join('|')).digest('base64url');
  }

  newToken(nameLower) {
    const issuedAt = this.now();
    const device = crypto.randomBytes(8).toString('hex');
    const sig = this.sign([nameLower, issuedAt, device]);
    return `v2.${b64u(nameLower)}.${issuedAt}.${device}.${sig}`;
  }

  parseToken(token) {
    if (typeof token !== 'string') return null;
    const p = token.split('.');
    if (p.length !== 5 || p[0] !== 'v2') return null;
    let nameLower;
    try { nameLower = unb64u(p[1]); } catch (_) { return null; }
    const issuedAt = Number(p[2]);
    const device = p[3];
    const expected = this.sign([nameLower, issuedAt, device]);
    const a = Buffer.from(p[4]); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { nameLower, issuedAt, device };
  }

  addToken(user, token) {
    const key = user.name.toLowerCase();
    if (!user.tokens.includes(token)) user.tokens.push(token);
    while (user.tokens.length > MAX_DEVICES) this.tokens.delete(user.tokens.shift());
    user.lastSeen = this.now();
    this.tokens.set(token, key);
  }

  dropTokens(user, keep = () => false) {
    user.tokens = user.tokens.filter((tk) => { const ok = keep(tk); if (!ok) this.tokens.delete(tk); return ok; });
  }

  /**
   * Entra com um nickname.
   *  - livre: cria a conta e devolve o token.
   *  - conta já existe em outro aparelho: cria um pedido de login, que um
   *    aparelho da conta aprova (o novo aparelho entra junto) ou recusa.
   */
  claim(name) {
    const clean = normalize(name);
    if (!Auth.validName(clean)) return { error: 'invalid_name' };
    const key = clean.toLowerCase();
    if (this.banned.has(key)) return { error: 'banned' };
    let user = this.users.get(key);
    if (!user) {
      user = { name: clean, tokens: [], createdAt: this.now(), lastSeen: this.now(), requests: [], avatar: null };
      this.users.set(key, user);
      const token = this.newToken(key);
      this.addToken(user, token);
      this.save();
      return { status: 'created', token, name: user.name };
    }
    if (user.tokens.length === 0) {
      const token = this.newToken(key);
      this.addToken(user, token);
      this.save();
      return { status: 'ok', token, name: user.name };
    }
    this.pruneRequests(user);
    if (user.requests.filter((r) => r.status === 'pending').length >= MAX_PENDING) return { error: 'too_many_requests' };
    const req = { id: crypto.randomBytes(32).toString('hex'), createdAt: this.now(), status: 'pending', token: null };
    user.requests.push(req);
    this.requests.set(req.id, { ...req, nameLower: key });
    this.save();
    return { status: 'pending', requestId: req.id, name: user.name };
  }

  /**
   * Confere um token. Devolve { name, recovered } ou null.
   *
   * Recuperação: se o servidor subiu sem o arquivo de contas, um token
   * assinado emitido ANTES deste servidor subir (bootAt) prova que a conta
   * existia; ele recria a conta (recovered = true) ou entra numa conta que
   * foi recriada depois do reinício. Se alguém tiver pegado o nickname nesse
   * meio-tempo por um pedido comum, os tokens dessa pessoa caem: a conta
   * volta para quem tinha os tokens antigos. Contas que já existiam no
   * arquivo só aceitam os tokens da lista delas.
   */
  verify(token) {
    const key = this.tokens.get(token);
    if (key) {
      const user = this.users.get(key);
      return user ? { name: user.name, recovered: false } : null;
    }
    const parsed = this.parseToken(token);
    if (!parsed) return null;
    // a pessoa clicou em Sair depois de este token nascer: não recupera
    if ((this.deleted.get(parsed.nameLower) || 0) >= parsed.issuedAt) return null;
    if (parsed.issuedAt >= this.bootAt) return null; // emitido por este servidor e não está na lista: inválido
    const user = this.users.get(parsed.nameLower);
    if (!user) {
      const fresh = { name: this.displayName(parsed.nameLower), tokens: [], createdAt: this.now(), lastSeen: this.now(), requests: [], recoveredAt: this.now() };
      this.users.set(parsed.nameLower, fresh);
      this.addToken(fresh, token);
      this.save();
      return { name: fresh.name, recovered: true };
    }
    if (user.loaded) return null;
    if (!user.recoveredAt) {
      // a conta foi criada por pedido comum depois do reinício: quem a criou perde a vez
      this.dropTokens(user);
      user.recoveredAt = this.now();
    }
    this.addToken(user, token);
    this.save();
    return { name: user.name, recovered: true };
  }

  displayName(nameLower) {
    return nameLower;
  }

  /** O cliente informa como o nickname era escrito (maiúsculas) depois de uma recuperação. */
  restoreName(token, name) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user || !name) return;
    const clean = normalize(name);
    // só vale enquanto o nome guardado for o "cru" da recuperação (tudo minúsculo)
    if (user.name !== key) return;
    if (clean.toLowerCase() === key && clean !== user.name) { user.name = clean; this.save(); }
  }

  touch(token) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (user) user.lastSeen = this.now();
  }

  /** Sair: a conta deixa de existir em todos os aparelhos e o nickname fica livre. */
  logout(token) {
    const key = this.tokens.get(token);
    if (!key) return null;
    const user = this.users.get(key);
    if (user) {
      this.dropTokens(user);
      for (const r of user.requests) this.requests.delete(r.id);
      this.users.delete(key);
    }
    this.deleted.set(key, this.now());
    this.titles.delete(key);
    this.save();
    return key;
  }

  pruneRequests(user) {
    const cutoff = this.now() - REQUEST_TTL_MS;
    user.requests = user.requests.filter((r) => r.createdAt > cutoff);
  }

  pendingFor(token) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user) return null;
    this.pruneRequests(user);
    return user.requests.filter((r) => r.status === 'pending').map((r) => ({ id: r.id, createdAt: r.createdAt }));
  }

  /** Um aparelho da conta aprova: o aparelho que pediu entra junto. */
  approve(token, requestId) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user) return { error: 'not_logged_in' };
    const req = user.requests.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) return { error: 'unknown_request' };
    const newToken = this.newToken(key);
    req.status = 'approved';
    req.token = newToken;
    this.addToken(user, newToken);
    this.syncRequests(user, key);
    this.save();
    return { ok: true, name: user.name, devices: user.tokens.length };
  }

  deny(token, requestId) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user) return { error: 'not_logged_in' };
    const req = user.requests.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) return { error: 'unknown_request' };
    req.status = 'denied';
    this.syncRequests(user, key);
    this.save();
    return { ok: true };
  }

  syncRequests(user, key) {
    for (const r of user.requests) this.requests.set(r.id, { ...r, nameLower: key });
  }

  requestStatus(requestId) {
    const r = this.requests.get(requestId);
    if (!r) return { status: 'unknown' };
    const user = this.users.get(r.nameLower);
    const live = user && user.requests.find((x) => x.id === requestId);
    if (!live) return { status: 'unknown' };
    if (live.status === 'approved' && live.token) {
      const token = live.token;
      live.token = null;
      this.requests.set(requestId, { ...live, nameLower: r.nameLower });
      this.save();
      return { status: 'approved', token, name: user.name };
    }
    return { status: live.status, name: user.name };
  }

  cancelRequest(requestId) {
    const r = this.requests.get(requestId);
    if (!r) return;
    const user = this.users.get(r.nameLower);
    if (user) user.requests = user.requests.filter((x) => x.id !== requestId);
    this.requests.delete(requestId);
    this.save();
  }

  ownerKey(token) {
    return this.tokens.get(token) || null;
  }

  keyOfRequest(requestId) {
    const r = this.requests.get(requestId);
    return r ? r.nameLower : null;
  }

  nameOf(key) {
    const u = this.users.get(key);
    return u ? u.name : null;
  }

  // ---- perfil ----
  userOf(token) {
    const key = this.tokens.get(token);
    return key ? this.users.get(key) || null : null;
  }

  avatarOf(key) {
    const u = this.users.get(key);
    return u && u.avatar ? u.avatar : null;
  }

  /** avatar: null | { type: 'cover', id } | { type: 'upload', ver } */
  setAvatar(token, avatar) {
    const user = this.userOf(token);
    if (!user) return { error: 'not_logged_in' };
    user.avatar = avatar || null;
    this.save();
    return { ok: true, avatar: user.avatar };
  }

  setAvatarByKey(key, avatar) {
    const user = this.users.get(key);
    if (!user) return false;
    user.avatar = avatar || null;
    this.save();
    return true;
  }

  /** Troca o nickname mantendo a conta (tokens, pedidos, foto). Devolve { ok, oldKey, newKey, name }. */
  rename(token, newName) {
    const user = this.userOf(token);
    if (!user) return { error: 'not_logged_in' };
    const clean = normalize(newName);
    if (!Auth.validName(clean)) return { error: 'invalid_name' };
    const oldKey = user.name.toLowerCase();
    const newKey = clean.toLowerCase();
    if (this.banned.has(newKey)) return { error: 'banned' };
    if (newKey !== oldKey && this.users.has(newKey)) return { error: 'name_taken' };
    if (newKey === oldKey) { user.name = clean; this.save(); return { ok: true, oldKey, newKey, name: clean, same: true }; }
    this.users.delete(oldKey);
    user.name = clean;
    this.users.set(newKey, user);
    for (const tk of user.tokens) this.tokens.set(tk, newKey);
    for (const r of user.requests) this.requests.set(r.id, { ...r, nameLower: newKey });
    // tokens antigos assinados com o nome velho continuam na lista; a assinatura
    // só importa na recuperação, que passa a ser pelo nome novo
    this.deleted.set(oldKey, this.now()); // o nome velho não "recupera" a conta por token antigo
    if (this.titles.has(oldKey)) { this.titles.set(newKey, this.titles.get(oldKey)); this.titles.delete(oldKey); }
    this.save();
    return { ok: true, oldKey, newKey, name: clean };
  }

  /** Banir: apaga a conta e bloqueia o nickname. */
  ban(key) {
    const user = this.users.get(key);
    if (user) {
      this.dropTokens(user);
      for (const r of user.requests) this.requests.delete(r.id);
      this.users.delete(key);
    }
    this.deleted.set(key, this.now());
    this.banned.add(key);
    this.titles.delete(key);
    this.save();
    return Boolean(user);
  }

  titleOf(key) { return (key && this.titles.get(key)) || null; }

  /** Dá (ou tira, com título vazio) o título mostrado ao lado do nickname. Só a administração chama. */
  setTitle(name, title) {
    const key = normalize(name).toLowerCase();
    if (!this.users.has(key)) return { error: 'unknown_user' };
    const clean = String(title || '').trim().replace(/\s+/g, ' ').slice(0, 16);
    if (clean && !/^[\p{L}\p{N} _.!-]+$/u.test(clean)) return { error: 'invalid_title' };
    if (clean) this.titles.set(key, clean); else this.titles.delete(key);
    this.save();
    return { ok: true, key, name: this.nameOf(key), title: clean || null };
  }

  allTitles() {
    return [...this.titles].map(([key, title]) => ({ key, name: this.nameOf(key) || key, title }));
  }

  exists(key) {
    return this.users.has(key);
  }

  devicesOf(token) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    return user ? user.tokens.length : 0;
  }
}

module.exports = { Auth };
