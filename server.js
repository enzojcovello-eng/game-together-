'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Matchmaker } = require('./lib/matchmaker');
const { Auth } = require('./lib/auth');
const { Social } = require('./lib/social');
const { Reports } = require('./lib/reports');
const moderation = require('./lib/moderation');

const config = require('./games.json');
const pkg = require('./package.json');
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const AVATAR_DIR = path.join(DATA_DIR, 'avatars');

// Versão do app: muda a cada publicação. O cliente compara com a que carregou
// e avisa para atualizar. BUILD vem do Render (commit) ou da hora de início.
const VERSION = { version: pkg.version, build: process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || String(Date.now()) };

// Capas: se existir public/covers/<id>.jpg|jpeg|png|webp, ela vence a ilustração SVG.
const COVER_EXT = ['jpg', 'jpeg', 'png', 'webp'];
function resolveConfig() {
  const games = config.games.map((g) => {
    for (const ext of COVER_EXT) {
      const file = path.join(__dirname, 'public', 'covers', `${g.id}.${ext}`);
      if (fs.existsSync(file)) return { ...g, cover: `covers/${g.id}.${ext}` };
    }
    return g;
  });
  return { ...config, games, ...VERSION };
}

const app = express();
// HTTPS opcional: o microfone no celular só funciona em HTTPS ou localhost.
const isHttps = Boolean(process.env.SSL_KEY && process.env.SSL_CERT);
const server = isHttps
  ? https.createServer({ key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) }, app)
  : http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- visitas: conta aberturas da página inicial e visitantes diferentes por dia ----
const STATS_FILE = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'visits.json');
let visits = { total: 0, days: {} };
try { visits = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (_) { /* começa do zero */ }
function saveVisits() {
  try { fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true }); fs.writeFileSync(STATS_FILE, JSON.stringify(visits)); } catch (_) { /* sem disco */ }
}
function countVisit(req) {
  const day = new Date().toISOString().slice(0, 10);
  const who = crypto.createHash('sha256').update(`${req.ip}|${req.headers['user-agent'] || ''}|${day}`).digest('hex').slice(0, 16);
  const d = visits.days[day] || (visits.days[day] = { visits: 0, visitors: [] });
  d.visits += 1;
  visits.total += 1;
  if (!d.visitors.includes(who)) d.visitors.push(who);
  // guarda só os últimos 90 dias
  for (const k of Object.keys(visits.days)) if (k < new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)) delete visits.days[k];
  saveVisits();
}
function visitSummary() {
  const day = new Date().toISOString().slice(0, 10);
  const today = visits.days[day] || { visits: 0, visitors: [] };
  const last7 = Object.entries(visits.days).filter(([k]) => k >= new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10));
  return {
    visitsToday: today.visits,
    visitorsToday: today.visitors.length,
    visitsLast7Days: last7.reduce((a, [, v]) => a + v.visits, 0),
    visitorsLast7Days: last7.reduce((a, [, v]) => a + v.visitors.length, 0),
    visitsTotal: visits.total,
    byDay: Object.fromEntries(Object.entries(visits.days).sort().map(([k, v]) => [k, { visits: v.visits, visitors: v.visitors.length }])),
  };
}
// Endereço oficial: com SITE_URL definido (ex.: https://gametogether.com.br), qualquer outro
// endereço (como o onrender.com) redireciona para ele, para o Google contar um site só.
// Aceita deslizes comuns na variável: espaços, falta de https://, barra ou ponto sobrando no fim.
let SITE_URL = (process.env.SITE_URL || '').trim().replace(/[\/.\s]+$/, '');
if (SITE_URL && !/^https?:\/\//i.test(SITE_URL)) SITE_URL = `https://${SITE_URL}`;
let siteHost = null;
try {
  if (SITE_URL) {
    const u = new URL(SITE_URL);
    siteHost = u.host.toLowerCase().replace(/\.+$/, '');
    SITE_URL = `${u.protocol}//${siteHost}`;
  }
} catch (_) { console.warn('SITE_URL inválida, ignorando:', SITE_URL); SITE_URL = ''; }
if (siteHost) {
  app.use((req, res, next) => {
    const host = (req.headers.host || '').toLowerCase().replace(/\.+(?=:|$)/, '');
    if (host && host !== siteHost && !host.startsWith('localhost') && !host.startsWith('127.')) {
      // sem cache: se a configuração estiver errada por um tempo, o navegador não fica preso nela
      res.set('Cache-Control', 'no-store');
      return res.redirect(302, SITE_URL + req.originalUrl);
    }
    next();
  });
}

// Teclados de celular costumam colar um ponto no fim do link (".../." ou ".../api/stats."):
// tira o ponto e segue para o endereço certo.
app.use((req, res, next) => {
  if (req.method === 'GET' && /\.+$/.test(req.path) && req.path !== '/') {
    const clean = req.path.replace(/\.+$/, '') || '/';
    const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.set('Cache-Control', 'no-store');
    return res.redirect(302, clean + q);
  }
  next();
});

app.get(['/', '/index.html'], (req, _res, next) => {
  // só aberturas de verdade da página (não as buscas internas do service worker)
  const mode = req.headers['sec-fetch-mode'];
  if (!mode || mode === 'navigate') countVisit(req);
  next();
});

app.use('/avatars', express.static(AVATAR_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/profile/avatar', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '200kb' }));
app.get('/api/config', (_req, res) => res.json(resolveConfig()));
app.get('/api/version', (_req, res) => res.json(VERSION));
app.get('/api/stats', (_req, res) => res.json({ online, ...mm.stats(), accounts: auth.users.size, ...visitSummary() }));

const mm = new Matchmaker(config);
// DATA_DIR: pasta das contas e amigos. SESSION_SECRET: assina os tokens
// (defina no host para as contas sobreviverem a reinícios e atualizações).
const auth = new Auth({ dataDir: process.env.DATA_DIR });
const social = new Social({ dataDir: process.env.DATA_DIR });
const reports = new Reports({ dataDir: process.env.DATA_DIR });
const ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) console.warn('Aviso: defina ADMIN_KEY para abrir a página de administração (/admin).');
// O detector de fotos é pesado (uns 250 MB de memória). Por padrão carrega só
// quando a primeira foto for enviada; MODERATION_WARMUP=1 carrega ao ligar.
if (process.env.MODERATION_WARMUP === '1') moderation.warmUp();
if (!process.env.SESSION_SECRET) console.warn('Aviso: defina SESSION_SECRET para as contas sobreviverem a reinícios do servidor.');
let online = 0;

// ---- contas (só nickname; um aparelho por vez) ----
const acctRoom = (key) => `acct:${key}`;
const claimRoom = (id) => `claim:${id}`;

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

const claimsByIp = new Map();
function tooManyClaims(ip) {
  const now = Date.now();
  const list = (claimsByIp.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  claimsByIp.set(ip, list);
  return list.length > 40;
}

app.post('/api/claim', (req, res) => {
  if (tooManyClaims(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
  const r = auth.claim((req.body || {}).name);
  if (r.error) return res.status(400).json({ error: r.error });
  if (r.status === 'pending') {
    const key = auth.keyOfRequest(r.requestId);
    io.to(acctRoom(key)).emit('login-request', { id: r.requestId, createdAt: Date.now() });
  }
  res.json(r);
});

app.get('/api/claim/:id', (req, res) => res.json(auth.requestStatus(req.params.id)));

app.delete('/api/claim/:id', (req, res) => {
  const key = auth.keyOfRequest(req.params.id);
  auth.cancelRequest(req.params.id);
  if (key) io.to(acctRoom(key)).emit('login-requests-changed');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = tokenFrom(req);
  const user = auth.verify(token);
  if (!user) return res.status(401).json({ error: 'not_logged_in' });
  auth.touch(token);
  const key = auth.ownerKey(token);
  res.json({ name: user.name, recovered: user.recovered, devices: auth.devicesOf(token), pending: auth.pendingFor(token) || [], avatar: avatarUrl(key), avatarKind: (auth.avatarOf(key) || {}).type || null, title: auth.titleOf(key) });
});

app.get('/api/requests', (req, res) => {
  const list = auth.pendingFor(tokenFrom(req));
  if (!list) return res.status(401).json({ error: 'not_logged_in' });
  res.json({ requests: list });
});

app.post('/api/requests/:id/approve', (req, res) => {
  const token = tokenFrom(req);
  const key = auth.ownerKey(token);
  const r = auth.approve(token, req.params.id);
  if (r.error) return res.status(r.error === 'not_logged_in' ? 401 : 404).json({ error: r.error });
  io.to(claimRoom(req.params.id)).emit('claim-update', { requestId: req.params.id, status: 'approved' });
  io.to(acctRoom(key)).emit('login-requests-changed');
  res.json(r);
});

app.post('/api/requests/:id/deny', (req, res) => {
  const token = tokenFrom(req);
  const r = auth.deny(token, req.params.id);
  if (r.error) return res.status(r.error === 'not_logged_in' ? 401 : 404).json({ error: r.error });
  io.to(claimRoom(req.params.id)).emit('claim-update', { requestId: req.params.id, status: 'denied' });
  io.to(acctRoom(auth.ownerKey(token))).emit('login-requests-changed');
  res.json(r);
});

// Sair: apaga a conta, as amizades e as conversas; o nickname fica livre.
app.post('/api/logout', (req, res) => {
  const token = tokenFrom(req);
  const key = auth.ownerKey(token);
  if (key) {
    const affected = social.erase(key);
    auth.logout(token);
    io.to(acctRoom(key)).emit('account-deleted'); // todos os aparelhos da conta saem
    io.in(acctRoom(key)).socketsLeave(acctRoom(key));
    for (const f of affected) pushSocial(f);
  }
  res.json({ ok: true });
});

// ---- perfil ----
function avatarUrl(key) {
  const a = auth.avatarOf(key);
  if (!a) return null;
  if (a.type === 'cover') { const g = config.games.find((x) => x.id === a.id); return g ? resolveConfig().games.find((x) => x.id === a.id).cover : null; }
  if (a.type === 'upload') return `/avatars/${encodeURIComponent(key)}.jpg?v=${a.ver}`;
  return null;
}
function profileOf(key) {
  return { key, name: auth.nameOf(key) || key, avatar: avatarUrl(key), title: auth.titleOf(key) };
}
function removeUploadedAvatar(key) {
  try { fs.unlinkSync(path.join(AVATAR_DIR, `${key}.jpg`)); } catch (_) { /* já não existia */ }
  auth.setAvatarByKey(key, null);
}
function pushProfile(key, extra = {}) {
  io.to(acctRoom(key)).emit('profile', { ...profileOf(key), titleCert: auth.titleCert(key), ...extra });
  pushPresence(key);
}

app.get('/api/profile', (req, res) => {
  const key = auth.ownerKey(tokenFrom(req));
  if (!key) return res.status(401).json({ error: 'not_logged_in' });
  res.json({ ...profileOf(key), avatarKind: (auth.avatarOf(key) || {}).type || null });
});

// foto da galeria (capa de jogo) ou nenhuma
app.post('/api/profile/avatar/cover', (req, res) => {
  const token = tokenFrom(req);
  const key = auth.ownerKey(token);
  if (!key) return res.status(401).json({ error: 'not_logged_in' });
  const id = (req.body || {}).id;
  if (id === null || id === '') { removeUploadedAvatar(key); pushProfile(key); return res.json(profileOf(key)); }
  if (!config.games.some((g) => g.id === id)) return res.status(400).json({ error: 'unknown_game' });
  removeUploadedAvatar(key);
  auth.setAvatar(token, { type: 'cover', id });
  pushProfile(key);
  res.json(profileOf(key));
});

// upload: a imagem passa pela checagem antes de ser salva
const uploadsByKey = new Map();
app.post('/api/profile/avatar', async (req, res) => {
  const token = tokenFrom(req);
  const key = auth.ownerKey(token);
  if (!key) return res.status(401).json({ error: 'not_logged_in' });
  const last = uploadsByKey.get(key) || 0;
  if (Date.now() - last < 15 * 1000) return res.status(429).json({ error: 'too_many_attempts' });
  uploadsByKey.set(key, Date.now());
  const data = String((req.body || {}).image || '');
  const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/i.exec(data);
  if (!m) return res.status(400).json({ error: 'bad_image' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'too_large' });
  const result = await moderation.checkAvatar(buf);
  if (!result.ok) return res.status(result.error === 'moderation_unavailable' ? 503 : 400).json({ error: result.error });
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  fs.writeFileSync(path.join(AVATAR_DIR, `${key}.jpg`), result.jpeg);
  auth.setAvatar(token, { type: 'upload', ver: Date.now() });
  pushProfile(key);
  res.json(profileOf(key));
});

// trocar nickname mantendo amigos, conversas e foto
app.post('/api/profile/name', (req, res) => {
  const token = tokenFrom(req);
  const r = auth.rename(token, (req.body || {}).name);
  if (r.error) return res.status(r.error === 'not_logged_in' ? 401 : 400).json({ error: r.error });
  if (!r.same) {
    const affected = social.rename(r.oldKey, r.newKey);
    mm.renamePlayer(r.oldKey, r.name);
    try { fs.renameSync(path.join(AVATAR_DIR, `${r.oldKey}.jpg`), path.join(AVATAR_DIR, `${r.newKey}.jpg`)); } catch (_) { /* sem upload */ }
    // os sockets da conta mudam de sala de aviso
    for (const s of io.sockets.adapter.rooms.get(acctRoom(r.oldKey)) || []) {
      const sock = io.sockets.sockets.get(s);
      if (sock) { sock.leave(acctRoom(r.oldKey)); sock.join(acctRoom(r.newKey)); sock.data.key = r.newKey; }
    }
    for (const f of affected) pushSocial(f);
    // quem está na mesma chamada vê o nome novo
    const room = [...io.sockets.adapter.rooms.get(acctRoom(r.newKey)) || []].map((id) => mm.roomOf(id)).find(Boolean);
    if (room) io.to(room.id).emit('room-update', { room: publicRoom(room) });
  } else {
    mm.renamePlayer(r.oldKey, r.name);
  }
  pushProfile(r.newKey);
  pushSocial(r.newKey);
  // o aparelho que pediu já leva um token com o nome novo por dentro
  res.json({ ...profileOf(r.newKey), name: r.name, token: auth.refreshToken(token) || undefined, titleCert: auth.titleCert(r.newKey) });
});

// denúncia de foto ou nome
app.post('/api/report', (req, res) => {
  const by = auth.ownerKey(tokenFrom(req));
  if (!by) return res.status(401).json({ error: 'not_logged_in' });
  const { target, reason, note } = req.body || {};
  const key = String(target || '').trim().toLowerCase();
  if (!auth.exists(key)) return res.status(404).json({ error: 'unknown_user' });
  const r = reports.report(by, key, reason, note);
  if (r.error) return res.status(400).json(r);
  if (r.autoHide && (auth.avatarOf(key) || {}).type === 'upload') { removeUploadedAvatar(key); pushProfile(key, { removed: true }); }
  res.json({ ok: true });
});

// ---- administração (ADMIN_KEY) ----
function isAdmin(req) {
  const k = req.headers['x-admin-key'] || req.query.key;
  return Boolean(ADMIN_KEY) && typeof k === 'string' && k.length === ADMIN_KEY.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN_KEY));
}
app.get('/api/admin/reports', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin_key' });
  const list = reports.open().map((r) => ({ ...r, byName: auth.nameOf(r.by) || r.by, target: r.target, targetName: auth.nameOf(r.target) || r.target, targetAvatar: avatarUrl(r.target), targetExists: auth.exists(r.target) }));
  res.json({ reports: list, stats: { accounts: auth.users.size, banned: auth.banned.size } });
});
// títulos ao lado do nickname ("Dono", "Mod"...), dados pela administração
app.get('/api/admin/titles', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin_key' });
  res.json({ titles: auth.allTitles() });
});
app.post('/api/admin/title', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin_key' });
  const { name, title } = req.body || {};
  const r = auth.setTitle(name, title);
  if (r.error) return res.status(r.error === 'unknown_user' ? 404 : 400).json(r);
  pushProfile(r.key);
  res.json(r);
});

app.post('/api/admin/action', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin_key' });
  const { target, action } = req.body || {};
  const key = String(target || '').toLowerCase();
  if (action === 'remove_photo') { removeUploadedAvatar(key); pushProfile(key, { removed: true }); reports.resolve(key, 'photo_removed'); }
  else if (action === 'ban') {
    const affected = social.erase(key);
    auth.ban(key);
    io.to(acctRoom(key)).emit('account-deleted');
    io.in(acctRoom(key)).socketsLeave(acctRoom(key));
    for (const f of affected) pushSocial(f);
    reports.resolve(key, 'banned');
  } else if (action === 'dismiss') reports.resolve(key, 'dismissed');
  else return res.status(400).json({ error: 'unknown_action' });
  res.json({ ok: true });
});

// ---- amigos ----
function isOnline(key) {
  const r = io.sockets.adapter.rooms.get(acctRoom(key));
  return Boolean(r && r.size > 0);
}

function socialState(key) {
  const snap = social.snapshot(key);
  return {
    me: key,
    friends: snap.friends.map((f) => ({ key: f, name: auth.nameOf(f) || f, online: isOnline(f), avatar: avatarUrl(f), title: auth.titleOf(f) })),
    requests: snap.requests.map((r) => ({ from: r.from, name: auth.nameOf(r.from) || r.from, at: r.at, avatar: avatarUrl(r.from) })),
    dms: snap.dms,
  };
}

function pushSocial(key) {
  if (isOnline(key)) io.to(acctRoom(key)).emit('social', socialState(key));
}

function pushPresence(key) {
  for (const f of social.friendsOf(key)) pushSocial(f);
}

const invites = new Map(); // inviteId -> { from, to, roomId, at }
const lastSnapshot = new Map(); // key -> última cópia enviada pelo aparelho (só memória)

function broadcastStats() {
  io.emit('stats', { ...mm.stats(), online });
}

/** Sala pública com a foto de cada membro. */
function publicRoom(room) {
  const pub = mm.publicRoom(room);
  pub.members = pub.members.map((m) => ({ ...m, avatar: avatarUrl(String(m.name).toLowerCase()), title: auth.titleOf(String(m.name).toLowerCase()) }));
  return pub;
}

/** Avisa a sala de quem entrou e manda "matched" para quem entrou. */
function announceJoin(result) {
  const room = result.room;
  const pub = publicRoom(room);
  const joinedSet = new Set(result.joined);
  const existing = [...room.members.keys()].filter((id) => !joinedSet.has(id));
  result.joined.forEach((id, idx) => {
    const s = io.sockets.sockets.get(id);
    if (!s) return;
    s.join(room.id);
    const initiateWith = existing.concat(result.joined.slice(0, idx));
    s.emit('matched', { room: pub, you: id, initiateWith });
  });
  for (const member of room.members.keys()) {
    if (joinedSet.has(member)) continue;
    const s = io.sockets.sockets.get(member);
    if (!s) continue;
    for (const id of result.joined) {
      const m = room.members.get(id);
      s.emit('peer-joined', { room: pub, peer: { id, name: m.name, platform: m.platform, avatar: avatarUrl(String(m.name).toLowerCase()) } });
    }
  }
  broadcastStats();
}

io.on('connection', (socket) => {
  online += 1;
  broadcastStats();
  socket.emit('version', VERSION);

  const me = () => socket.data.key || null;
  const myName = () => (socket.data.key ? auth.nameOf(socket.data.key) : null);

  // o aparelho se identifica; se o servidor perdeu os dados, devolve a cópia
  socket.on('hello', ({ token, name, snapshot, titleCert } = {}) => {
    for (const r of socket.rooms) if (r.startsWith('acct:')) socket.leave(r);
    const user = auth.verify(token);
    socket.data.key = null;
    if (!user) { socket.emit('not-logged-in'); return; }
    const key = auth.ownerKey(token);
    socket.data.key = key;
    socket.data.token = token;
    auth.touch(token);
    auth.restoreName(token, name); // devolve as maiúsculas do nickname após uma recuperação
    if (titleCert) auth.restoreTitle(token, titleCert); // devolve o título após um reinício sem dados
    const fresh = auth.refreshToken(token); // nickname trocado: token passa a carregar o nome atual
    if (fresh) { socket.data.token = fresh; socket.emit('token', { token: fresh }); }
    // a cópia do aparelho religa amizades (quando os dois lados confirmam) e mensagens.
    // Guardamos a cópia em memória: quando o outro lado confirmar, reprocessamos esta.
    if (snapshot) lastSnapshot.set(key, snapshot);
    const relinked = snapshot ? social.merge(key, snapshot) : [];
    for (const f of relinked) if (lastSnapshot.has(f)) social.merge(f, lastSnapshot.get(f));
    socket.join(acctRoom(key));
    socket.emit('login-requests', { requests: auth.pendingFor(token) || [] });
    socket.emit('profile', { ...profileOf(key), titleCert: auth.titleCert(key) });
    pushSocial(key);
    pushPresence(key);
    for (const f of relinked) pushSocial(f);
  });

  socket.on('watch-claim', ({ requestId } = {}) => {
    if (typeof requestId === 'string' && requestId.length === 64) socket.join(claimRoom(requestId));
  });

  // ---- pedidos de amizade, mensagens e convites ----
  const keyOf = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

  socket.on('friend-request', ({ to } = {}, ack) => {
    const k = me(); const target = keyOf(to);
    if (!k) return ack && ack({ error: 'not_logged_in' });
    if (!auth.exists(target)) return ack && ack({ error: 'unknown_user' });
    // só quem está na mesma chamada (ou já pediu sua amizade) pode ser adicionado
    const room = mm.roomOf(socket.id);
    const sameCall = room && [...room.members.values()].some((m) => keyOf(m.name) === target);
    const askedMe = social.requestsFor(k).some((r) => r.from === target);
    if (!sameCall && !askedMe) return ack && ack({ error: 'not_in_call' });
    const r = social.request(k, target);
    if (r.error) return ack && ack(r);
    if (r.status === 'pending') io.to(acctRoom(target)).emit('friend-request', { from: k, name: myName() });
    pushSocial(k); pushSocial(target);
    ack && ack(r);
  });

  socket.on('friend-accept', ({ from } = {}, ack) => {
    const k = me(); if (!k) return;
    const r = social.accept(k, keyOf(from));
    if (r.ok) { pushSocial(k); pushSocial(keyOf(from)); io.to(acctRoom(keyOf(from))).emit('friend-accepted', { name: myName() }); }
    ack && ack(r);
  });

  socket.on('friend-decline', ({ from } = {}) => {
    const k = me(); if (!k) return;
    social.decline(k, keyOf(from));
    pushSocial(k);
  });

  socket.on('unfriend', ({ name } = {}) => {
    const k = me(); if (!k) return;
    social.unfriend(k, keyOf(name));
    pushSocial(k); pushSocial(keyOf(name));
  });

  socket.on('dm', ({ to, text } = {}, ack) => {
    const k = me(); if (!k) return ack && ack({ error: 'not_logged_in' });
    const target = keyOf(to);
    const r = social.send(k, target, text);
    if (r.error) return ack && ack(r);
    io.to(acctRoom(k)).emit('dm', { with: target, msg: r.msg });
    io.to(acctRoom(target)).emit('dm', { with: k, msg: r.msg });
    ack && ack({ ok: true });
  });

  // Convite para chamada: entra na sala atual do anfitrião ou abre uma sala de amigos.
  socket.on('invite', ({ to } = {}, ack) => {
    const k = me(); const target = keyOf(to);
    if (!k) return ack && ack({ error: 'not_logged_in' });
    if (!social.areFriends(k, target)) return ack && ack({ error: 'not_friends' });
    if (!isOnline(target)) return ack && ack({ error: 'offline' });
    let room = mm.roomOf(socket.id);
    let created = null;
    if (!room) {
      room = mm.hostPrivate(socket.id, myName());
      created = { room, joined: [socket.id] };
    }
    if (room.members.size >= room.max) return ack && ack({ error: 'room_full' });
    const id = crypto.randomBytes(12).toString('hex');
    invites.set(id, { id, from: k, to: target, roomId: room.id, at: Date.now() });
    io.to(acctRoom(target)).emit('invite', { id, from: k, name: myName(), game: room.gameName, private: Boolean(room.private) });
    if (created) announceJoin(created);
    ack && ack({ ok: true, roomId: room.id });
  });

  socket.on('invite-accept', ({ id } = {}, ack) => {
    const k = me(); const inv = invites.get(id);
    if (!k || !inv || inv.to !== k) return ack && ack({ error: 'unknown_invite' });
    invites.delete(id);
    const r = mm.joinById(inv.roomId, socket.id, myName());
    if (r.error) return ack && ack(r);
    announceJoin(r);
    ack && ack({ ok: true });
  });

  socket.on('invite-decline', ({ id } = {}) => {
    const k = me(); const inv = invites.get(id);
    if (!k || !inv || inv.to !== k) return;
    invites.delete(id);
    io.to(acctRoom(inv.from)).emit('invite-declined', { name: myName() });
  });

  // ---- matchmaking ----
  socket.on('find', (req, ack) => {
    req = req || {};
    const user = auth.verify(req.token);
    if (!user) {
      if (typeof ack === 'function') ack({ error: 'not_logged_in' });
      return;
    }
    auth.touch(req.token);
    const result = mm.find(socket.id, { ...req, name: user.name });
    if (result.error) {
      if (typeof ack === 'function') ack({ error: result.error });
      return;
    }
    if (result.status === 'waiting') {
      if (typeof ack === 'function') ack({ status: 'waiting' });
      broadcastStats();
      return;
    }
    announceJoin(result);
    if (typeof ack === 'function') ack({ status: 'matched' });
  });

  socket.on('cancel', () => handleLeave(socket));
  socket.on('leave', () => handleLeave(socket));

  socket.on('signal', ({ to, data } = {}) => {
    const room = mm.roomOf(socket.id);
    if (!room || !room.members.has(to)) return;
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('signal', { from: socket.id, data });
  });

  socket.on('chat', (text) => {
    const room = mm.roomOf(socket.id);
    if (!room) return;
    const msg = String(text || '').trim().slice(0, 300);
    if (!msg) return;
    const m = room.members.get(socket.id);
    io.to(room.id).emit('chat', { from: socket.id, name: m ? m.name : '?', text: msg, at: Date.now() });
  });

  socket.on('disconnect', () => {
    online = Math.max(0, online - 1);
    handleLeave(socket);
    const k = socket.data.key;
    if (k) setTimeout(() => { if (!isOnline(k)) pushPresence(k); }, 500);
  });
});

function handleLeave(socket) {
  const result = mm.leave(socket.id);
  if (result) {
    socket.leave(result.room.id);
    const pub = publicRoom(result.room);
    for (const id of result.remaining) {
      const s = io.sockets.sockets.get(id);
      if (s) s.emit('peer-left', { room: pub, peerId: socket.id });
    }
  }
  broadcastStats();
}

server.listen(PORT, () => {
  console.log(`Game Together rodando em ${isHttps ? 'https' : 'http'}://localhost:${PORT}`);
});
