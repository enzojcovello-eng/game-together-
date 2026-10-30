'use strict';

/**
 * Contas do Game Together: nome + senha.
 *
 * Guarda tudo num arquivo JSON (DATA_DIR/users.json). A senha nunca é salva
 * em texto: usa scrypt com sal por usuário. Cada login gera um token que o
 * app guarda no aparelho e manda nas próximas aberturas.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NAME_RE = /^[\p{L}\p{N}_. -]{3,20}$/u;
const MIN_PASSWORD = 6;
const MAX_TOKENS = 10;

class Auth {
  constructor({ dataDir, file } = {}) {
    this.file = file || path.join(dataDir || path.join(__dirname, '..', 'data'), 'users.json');
    this.users = new Map();      // nameLower -> { name, salt, hash, createdAt, tokens: [] }
    this.tokens = new Map();     // token -> nameLower
    this.attempts = new Map();   // ip -> { count, resetAt }
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const u of raw.users || []) {
        this.users.set(u.name.toLowerCase(), u);
        for (const t of u.tokens || []) this.tokens.set(t, u.name.toLowerCase());
      }
    } catch (_) {
      // sem arquivo ainda: começa vazio
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
    return typeof name === 'string' && NAME_RE.test(name.trim()) && name.trim().length >= 3;
  }

  static hash(password, salt) {
    return crypto.scryptSync(password, salt, 64).toString('hex');
  }

  register(name, password) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (!Auth.validName(name)) return { error: 'invalid_name' };
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) return { error: 'weak_password' };
    const key = name.toLowerCase();
    if (this.users.has(key)) return { error: 'name_taken' };
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { name, salt, hash: Auth.hash(password, salt), createdAt: Date.now(), tokens: [] };
    this.users.set(key, user);
    const token = this.issueToken(user);
    this.save();
    return { token, name: user.name };
  }

  login(name, password, ip = '') {
    if (this.tooManyAttempts(ip)) return { error: 'too_many_attempts' };
    const key = String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const user = this.users.get(key);
    const given = Buffer.from(user ? Auth.hash(String(password || ''), user.salt) : '0'.repeat(128), 'hex');
    const stored = Buffer.from(user ? user.hash : '0'.repeat(128), 'hex');
    const ok = user && given.length === stored.length && crypto.timingSafeEqual(given, stored);
    if (!ok) {
      this.countAttempt(ip);
      return { error: 'bad_credentials' };
    }
    this.attempts.delete(ip);
    const token = this.issueToken(user);
    this.save();
    return { token, name: user.name };
  }

  issueToken(user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.tokens = user.tokens || [];
    user.tokens.push(token);
    while (user.tokens.length > MAX_TOKENS) {
      const old = user.tokens.shift();
      this.tokens.delete(old);
    }
    this.tokens.set(token, user.name.toLowerCase());
    return token;
  }

  verify(token) {
    if (typeof token !== 'string') return null;
    const key = this.tokens.get(token);
    if (!key) return null;
    const user = this.users.get(key);
    return user ? { name: user.name } : null;
  }

  logout(token) {
    const key = this.tokens.get(token);
    if (!key) return;
    this.tokens.delete(token);
    const user = this.users.get(key);
    if (user) user.tokens = (user.tokens || []).filter((t) => t !== token);
    this.save();
  }

  tooManyAttempts(ip) {
    const a = this.attempts.get(ip);
    if (!a) return false;
    if (Date.now() > a.resetAt) { this.attempts.delete(ip); return false; }
    return a.count >= 10;
  }

  countAttempt(ip) {
    const a = this.attempts.get(ip) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    a.count += 1;
    this.attempts.set(ip, a);
  }
}

module.exports = { Auth };
