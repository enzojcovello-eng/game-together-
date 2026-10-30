'use strict';

/**
 * Amigos e conversas privadas do Game Together.
 *
 * Guarda em DATA_DIR/social.json:
 *  - friends: nameLower -> [nameLower]
 *  - requests: nameLower (quem recebe) -> [{ from, at }]
 *  - dms: "a|b" (ordem alfabética) -> [{ id, from, text, at }]
 *
 * Cada aparelho também guarda uma cópia dos próprios dados (snapshot). Se o
 * servidor perder o arquivo, o aparelho devolve a cópia e a gente junta.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_DM = 300;
const MAX_FRIENDS = 200;

const pairKey = (a, b) => [a, b].sort().join('|');

class Social {
  constructor({ dataDir, file, now } = {}) {
    this.file = file || path.join(dataDir || path.join(__dirname, '..', 'data'), 'social.json');
    this.now = now || (() => Date.now());
    this.friends = new Map();   // key -> Set(key)
    this.requests = new Map();  // key -> [{ from, at }]
    this.dms = new Map();       // pairKey -> [msgs]
    this.vouch = new Map();     // key -> Set(key): "eu digo que fulano é meu amigo" (recuperação)
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [k, v] of Object.entries(raw.friends || {})) this.friends.set(k, new Set(v));
      for (const [k, v] of Object.entries(raw.requests || {})) this.requests.set(k, v);
      for (const [k, v] of Object.entries(raw.dms || {})) this.dms.set(k, v);
      for (const [k, v] of Object.entries(raw.vouch || {})) this.vouch.set(k, new Set(v));
    } catch (_) { /* vazio */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const out = {
        friends: Object.fromEntries([...this.friends].map(([k, v]) => [k, [...v]])),
        requests: Object.fromEntries(this.requests),
        dms: Object.fromEntries(this.dms),
        vouch: Object.fromEntries([...this.vouch].map(([k, v]) => [k, [...v]])),
      };
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(out));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('não consegui salvar amigos:', err.message);
    }
  }

  friendsOf(key) {
    return [...(this.friends.get(key) || [])];
  }

  areFriends(a, b) {
    const s = this.friends.get(a);
    return Boolean(s && s.has(b));
  }

  requestsFor(key) {
    return this.requests.get(key) || [];
  }

  /** Pedido de amizade. Se o outro já tinha pedido, vira amizade direto. */
  request(from, to) {
    if (from === to) return { error: 'self' };
    if (this.areFriends(from, to)) return { status: 'already' };
    if ((this.friends.get(from) || new Set()).size >= MAX_FRIENDS) return { error: 'too_many_friends' };
    const mine = this.requests.get(from) || [];
    if (mine.some((r) => r.from === to)) {
      this.accept(from, to);
      return { status: 'friends' };
    }
    const list = this.requests.get(to) || [];
    if (list.some((r) => r.from === from)) return { status: 'pending' };
    list.push({ from, at: this.now() });
    this.requests.set(to, list);
    this.save();
    return { status: 'pending' };
  }

  accept(me, from) {
    const list = this.requests.get(me) || [];
    if (!list.some((r) => r.from === from)) return { error: 'unknown_request' };
    this.requests.set(me, list.filter((r) => r.from !== from));
    this.link(me, from);
    this.save();
    return { ok: true };
  }

  decline(me, from) {
    const list = this.requests.get(me) || [];
    this.requests.set(me, list.filter((r) => r.from !== from));
    this.save();
    return { ok: true };
  }

  link(a, b) {
    if (!this.friends.has(a)) this.friends.set(a, new Set());
    if (!this.friends.has(b)) this.friends.set(b, new Set());
    this.friends.get(a).add(b);
    this.friends.get(b).add(a);
  }

  unfriend(a, b) {
    if (this.friends.get(a)) this.friends.get(a).delete(b);
    if (this.friends.get(b)) this.friends.get(b).delete(a);
    if (this.vouch.get(a)) this.vouch.get(a).delete(b);
    if (this.vouch.get(b)) this.vouch.get(b).delete(a);
    this.dms.delete(pairKey(a, b));
    this.save();
    return { ok: true };
  }

  /** Mensagem privada entre amigos. */
  send(from, to, text) {
    if (!this.areFriends(from, to)) return { error: 'not_friends' };
    const msg = { id: crypto.randomBytes(6).toString('hex'), from, text: String(text || '').trim().slice(0, 500), at: this.now() };
    if (!msg.text) return { error: 'empty' };
    const key = pairKey(from, to);
    const list = this.dms.get(key) || [];
    list.push(msg);
    while (list.length > MAX_DM) list.shift();
    this.dms.set(key, list);
    this.save();
    return { ok: true, msg };
  }

  thread(a, b) {
    return this.dms.get(pairKey(a, b)) || [];
  }

  /** Tudo que o aparelho precisa guardar e mostrar. */
  snapshot(key) {
    const friends = this.friendsOf(key);
    const dms = {};
    for (const f of friends) dms[f] = this.thread(key, f);
    return { friends, requests: this.requestsFor(key), dms };
  }

  /**
   * O aparelho devolve a cópia dele depois de o servidor perder os dados.
   * Uma amizade só volta quando os DOIS lados dizem que são amigos (assim
   * ninguém se "adiciona" na lista de outra pessoa). Das mensagens, cada
   * lado só devolve as que ele mesmo mandou. Devolve os amigos religados.
   */
  merge(key, snap) {
    if (!snap || typeof snap !== 'object') return [];
    const relinked = [];
    if (!this.vouch.has(key)) this.vouch.set(key, new Set());
    for (const raw of Array.isArray(snap.friends) ? snap.friends : []) {
      if (typeof raw !== 'string' || raw.length > 20) continue;
      const f = raw.toLowerCase();
      if (f === key) continue;
      this.vouch.get(key).add(f);
      const other = this.vouch.get(f);
      if (other && other.has(key) && !this.areFriends(key, f)) { this.link(key, f); relinked.push(f); }
    }
    const dms = snap.dms && typeof snap.dms === 'object' ? snap.dms : {};
    for (const [rawF, msgs] of Object.entries(dms)) {
      const f = String(rawF).toLowerCase();
      if (!Array.isArray(msgs) || !this.areFriends(key, f)) continue;
      const pk = pairKey(key, f);
      const list = this.dms.get(pk) || [];
      const ids = new Set(list.map((m) => m.id));
      for (const m of msgs.slice(-MAX_DM)) {
        if (!m || ids.has(m.id) || typeof m.text !== 'string') continue;
        if (String(m.from).toLowerCase() !== key) continue; // só o que eu mesmo mandei
        list.push({ id: String(m.id).slice(0, 16), from: key, text: m.text.slice(0, 500), at: Number(m.at) || this.now() });
        ids.add(m.id);
      }
      list.sort((x, y) => x.at - y.at);
      while (list.length > MAX_DM) list.shift();
      this.dms.set(pk, list);
    }
    this.save();
    return relinked;
  }

  /** Sair: apaga amizades, pedidos e conversas da pessoa. Devolve os amigos afetados. */
  erase(key) {
    const friends = this.friendsOf(key);
    for (const f of friends) {
      const s = this.friends.get(f);
      if (s) s.delete(key);
      this.dms.delete(pairKey(key, f));
    }
    this.friends.delete(key);
    this.requests.delete(key);
    this.vouch.delete(key);
    for (const v of this.vouch.values()) v.delete(key);
    for (const [k, list] of this.requests) this.requests.set(k, list.filter((r) => r.from !== key));
    this.save();
    return friends;
  }
}

module.exports = { Social, pairKey };
