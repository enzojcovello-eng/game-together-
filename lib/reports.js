'use strict';

/**
 * Denúncias de foto ou nickname. Guardadas em DATA_DIR/reports.json.
 * Com AUTO_HIDE_AT pessoas diferentes denunciando a mesma conta, a foto
 * enviada por ela é removida sozinha; o resto fica para a administração.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTO_HIDE_AT = 3;
const REASONS = new Set(['photo', 'name', 'other']);

class Reports {
  constructor({ dataDir, file, now } = {}) {
    this.file = file || path.join(dataDir || path.join(__dirname, '..', 'data'), 'reports.json');
    this.now = now || (() => Date.now());
    this.list = [];
    try { this.list = JSON.parse(fs.readFileSync(this.file, 'utf8')).list || []; } catch (_) { /* vazio */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ list: this.list }));
    } catch (err) { console.error('não consegui salvar denúncias:', err.message); }
  }

  /**
   * Registra. O relato (note) é obrigatório; evidence é o nome do arquivo do print, se houver.
   * Devolve { ok, id, distinct } (quantas pessoas diferentes já denunciaram essa conta).
   */
  report(by, target, reason, note, evidence, audio) {
    if (!by || !target || by === target) return { error: 'invalid' };
    const text = String(note || '').trim().slice(0, 1000);
    if (text.length < 10) return { error: 'note_required' };
    if (!REASONS.has(reason)) reason = 'other';
    const id = crypto.randomBytes(8).toString('hex');
    const open = this.list.filter((r) => r.target === target && r.status === 'open');
    const mine = open.find((r) => r.by === by);
    if (mine) {
      // a mesma pessoa atualiza o relato em vez de contar duas vezes
      mine.note = text; mine.reason = reason; mine.at = this.now();
      if (evidence) mine.evidence = evidence;
      if (audio) mine.audio = audio;
    } else {
      this.list.push({ id, by, target, reason, note: text, evidence: evidence || null, audio: audio || null, at: this.now(), status: 'open' });
    }
    this.save();
    const distinct = new Set(this.list.filter((r) => r.target === target && r.status === 'open').map((r) => r.by)).size;
    return { ok: true, id: mine ? mine.id : id, distinct, autoHide: distinct >= AUTO_HIDE_AT };
  }

  byId(id) { return this.list.find((r) => r.id === id) || null; }

  byReporter(by) {
    return this.list.filter((r) => r.by === by).sort((a, b) => b.at - a.at);
  }

  open() {
    return this.list.filter((r) => r.status === 'open').sort((a, b) => b.at - a.at);
  }

  resolve(target, status = 'resolved') {
    for (const r of this.list) if (r.target === target && r.status === 'open') r.status = status;
    this.save();
  }

  resolveOne(id, status = 'resolved') {
    const r = this.list.find((x) => x.id === id);
    if (r) { r.status = status; this.save(); }
    return Boolean(r);
  }
}

module.exports = { Reports, AUTO_HIDE_AT };
