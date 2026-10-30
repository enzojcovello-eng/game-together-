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
 * Só um aparelho por vez. Outro aparelho com o mesmo nickname vira um
 * pedido de login que o aparelho dono aprova ou recusa.
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
    this.secret = secret || process.env.SESSION_SECRET || this.loadOrCreateSecret();
    this.users = new Map();     // nameLower -> { name, token, createdAt, lastSeen, requests: [] }
    this.tokens = new Map();    // token -> nameLower
    this.requests = new Map();  // requestId -> { id, nameLower, createdAt, status, token }
    this.deleted = new Map();   // nameLower -> quando a pessoa clicou em Sair (tokens anteriores morrem)
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
      for (const u of raw.users || []) {
        const key = u.name.toLowerCase();
        u.requests = u.requests || [];
        this.users.set(key, u);
        if (u.token) this.tokens.set(u.token, key);
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
      fs.writeFileSync(tmp, JSON.stringify({ users: [...this.users.values()], deleted: Object.fromEntries(this.deleted) }, null, 2));
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

  bind(user, token) {
    if (user.token) this.tokens.delete(user.token);
    user.token = token;
    user.lastSeen = this.now();
    this.tokens.set(token, user.name.toLowerCase());
  }

  /**
   * Entra com um nickname.
   *  - livre: cria a conta e devolve o token.
   *  - conta sem dono (a pessoa saiu): assume na hora.
   *  - conta em uso em outro aparelho: cria um pedido de login.
   */
  claim(name) {
    const clean = normalize(name);
    if (!Auth.validName(clean)) return { error: 'invalid_name' };
    const key = clean.toLowerCase();
    let user = this.users.get(key);
    if (!user) {
      user = { name: clean, token: null, createdAt: this.now(), lastSeen: this.now(), requests: [] };
      this.users.set(key, user);
      this.bind(user, this.newToken(key));
      this.save();
      return { status: 'created', token: user.token, name: user.name };
    }
    if (!user.token) {
      this.bind(user, this.newToken(key));
      this.save();
      return { status: 'ok', token: user.token, name: user.name };
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
   * Se o servidor perdeu o arquivo de contas, um token assinado válido
   * recria a conta (recovered = true). Se outra pessoa pegou o nickname
   * depois da perda, o token mais antigo vence, porque é a prova de que a
   * conta existia antes.
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
    const user = this.users.get(parsed.nameLower);
    if (!user) {
      const fresh = { name: this.displayName(parsed.nameLower), token: null, createdAt: this.now(), lastSeen: this.now(), requests: [], recoveredAt: this.now() };
      this.users.set(parsed.nameLower, fresh);
      this.bind(fresh, token);
      this.save();
      return { name: fresh.name, recovered: true };
    }
    // conta existe com outro token: só cede se ela foi (re)criada depois
    // de este token ter sido emitido, ou seja, depois de uma perda de dados
    if (user.createdAt > parsed.issuedAt) {
      this.bind(user, token);
      this.save();
      return { name: user.name, recovered: true };
    }
    return null;
  }

  displayName(nameLower) {
    return nameLower;
  }

  /** O cliente pode informar como o nickname era escrito (maiúsculas). */
  restoreName(token, name) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user || !name) return;
    const clean = normalize(name);
    if (clean.toLowerCase() === key && clean !== user.name) { user.name = clean; this.save(); }
  }

  touch(token) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (user) user.lastSeen = this.now();
  }

  /** Sair: a conta deixa de existir e o nickname fica livre. */
  logout(token) {
    const key = this.tokens.get(token);
    if (!key) return null;
    const user = this.users.get(key);
    this.tokens.delete(token);
    if (user) {
      for (const r of user.requests) this.requests.delete(r.id);
      this.users.delete(key);
    }
    this.deleted.set(key, this.now());
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

  /** O dono aprova: a conta passa para o aparelho que pediu. */
  approve(token, requestId) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (!user) return { error: 'not_logged_in' };
    const req = user.requests.find((r) => r.id === requestId && r.status === 'pending');
    if (!req) return { error: 'unknown_request' };
    const newToken = this.newToken(key);
    req.status = 'approved';
    req.token = newToken;
    this.bind(user, newToken);
    for (const other of user.requests) if (other !== req && other.status === 'pending') other.status = 'denied';
    this.syncRequests(user, key);
    this.save();
    return { ok: true, name: user.name };
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

  exists(key) {
    return this.users.has(key);
  }
}

module.exports = { Auth };
