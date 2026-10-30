'use strict';

/**
 * Contas do Game Together, sem senha.
 *
 * Uma conta é só um nome. Quem cria a conta recebe um token que fica salvo
 * no aparelho, e esse aparelho fica "dono" da conta. Só um aparelho pode
 * estar logado por vez. Se outro aparelho tentar entrar com o mesmo nome,
 * vira um pedido de login: o aparelho que está com a conta aprova ou recusa.
 * Se a conta ficar sem uso por muito tempo (INACTIVE_DAYS), o pedido é
 * aprovado sozinho, para ninguém ficar trancado para fora.
 *
 * Tudo fica num arquivo JSON (DATA_DIR/users.json).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;
const INACTIVE_DAYS = 7;
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PENDING = 20;

function normalize(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

class Auth {
  constructor({ dataDir, file, now } = {}) {
    this.file = file || path.join(dataDir || path.join(__dirname, '..', 'data'), 'users.json');
    this.now = now || (() => Date.now());
    this.users = new Map();     // nameLower -> { name, token, createdAt, lastSeen, requests: [] }
    this.tokens = new Map();    // token -> nameLower
    this.requests = new Map();  // requestId -> { id, nameLower, createdAt, status, token }
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
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
      fs.writeFileSync(tmp, JSON.stringify({ users: [...this.users.values()] }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('não consegui salvar as contas:', err.message);
    }
  }

  static validName(name) {
    const n = normalize(name);
    return NAME_RE.test(n) && n.length >= 3;
  }

  newToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  bind(user, token) {
    if (user.token) this.tokens.delete(user.token);
    user.token = token;
    user.lastSeen = this.now();
    this.tokens.set(token, user.name.toLowerCase());
  }

  /**
   * Entra com um nome.
   *  - nome livre: cria a conta e devolve o token.
   *  - conta sem dono (saiu) ou parada há mais de INACTIVE_DAYS: assume na hora.
   *  - conta em uso em outro aparelho: cria um pedido de login e devolve
   *    { status: 'pending', requestId }.
   */
  claim(name) {
    const clean = normalize(name);
    if (!Auth.validName(clean)) return { error: 'invalid_name' };
    const key = clean.toLowerCase();
    let user = this.users.get(key);
    if (!user) {
      user = { name: clean, token: null, createdAt: this.now(), lastSeen: this.now(), requests: [] };
      this.users.set(key, user);
      const token = this.newToken();
      this.bind(user, token);
      this.save();
      return { status: 'created', token, name: user.name };
    }
    const inactive = this.now() - (user.lastSeen || 0) > INACTIVE_DAYS * 24 * 60 * 60 * 1000;
    if (!user.token || inactive) {
      const token = this.newToken();
      this.bind(user, token);
      this.save();
      return { status: 'ok', token, name: user.name };
    }
    this.pruneRequests(user);
    if (user.requests.filter((r) => r.status === 'pending').length >= MAX_PENDING) return { error: 'too_many_requests' };
    const req = { id: this.newToken(), createdAt: this.now(), status: 'pending', token: null };
    user.requests.push(req);
    this.requests.set(req.id, { ...req, nameLower: key });
    this.save();
    return { status: 'pending', requestId: req.id, name: user.name };
  }

  verify(token) {
    if (typeof token !== 'string') return null;
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    return user ? { name: user.name } : null;
  }

  touch(token) {
    const key = this.tokens.get(token);
    const user = key && this.users.get(key);
    if (user) user.lastSeen = this.now();
  }

  logout(token) {
    const key = this.tokens.get(token);
    if (!key) return;
    const user = this.users.get(key);
    this.tokens.delete(token);
    if (user) user.token = null;
    this.save();
  }

  pruneRequests(user) {
    const cutoff = this.now() - REQUEST_TTL_MS;
    user.requests = user.requests.filter((r) => r.status === 'pending' ? r.createdAt > cutoff : r.createdAt > cutoff);
  }

  /** Pedidos pendentes da conta de quem tem este token. */
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
    const newToken = this.newToken();
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

  /** Quem pediu consulta o andamento. Quando aprovado, leva o token (uma vez só). */
  requestStatus(requestId) {
    const r = this.requests.get(requestId);
    if (!r) return { status: 'unknown' };
    const user = this.users.get(r.nameLower);
    const live = user && user.requests.find((x) => x.id === requestId);
    if (!live) return { status: 'unknown' };
    if (live.status === 'approved' && live.token) {
      const token = live.token;
      live.token = null; // entrega uma vez só
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
}

module.exports = { Auth, INACTIVE_DAYS };
