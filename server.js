'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { Server } = require('socket.io');
const { Matchmaker } = require('./lib/matchmaker');
const { Auth } = require('./lib/auth');

const config = require('./games.json');
const PORT = process.env.PORT || 3000;

const app = express();
// HTTPS opcional: o microfone no celular só funciona em HTTPS ou localhost.
// Defina SSL_KEY e SSL_CERT (caminhos dos arquivos) para subir em HTTPS.
const isHttps = Boolean(process.env.SSL_KEY && process.env.SSL_CERT);
const server = isHttps
  ? https.createServer({ key: fs.readFileSync(process.env.SSL_KEY), cert: fs.readFileSync(process.env.SSL_CERT) }, app)
  : http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10kb' }));
app.get('/api/config', (_req, res) => res.json(config));
app.get('/api/stats', (_req, res) => res.json({ ...mm.stats(), online }));

const mm = new Matchmaker(config);
// DATA_DIR: pasta onde ficam as contas (users.json). Num host com disco
// persistente, aponte para ele para as contas sobreviverem a reinícios.
const auth = new Auth({ dataDir: process.env.DATA_DIR });
let online = 0;

// ---- contas (só nome; um aparelho por vez) ----
const acctRoom = (key) => `acct:${key}`;
const claimRoom = (id) => `claim:${id}`;

function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// limite simples de pedidos por IP para evitar spam de nomes
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
    // avisa o aparelho que está com a conta, se estiver aberto
    const key = auth.keyOfRequest(r.requestId);
    io.to(acctRoom(key)).emit('login-request', { id: r.requestId, createdAt: Date.now() });
  }
  res.json(r);
});

app.get('/api/claim/:id', (req, res) => {
  res.json(auth.requestStatus(req.params.id));
});

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
  res.json({ ...user, pending: auth.pendingFor(token) || [] });
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
  // quem pediu recebe o token pela rota GET /api/claim/:id; aqui só avisamos
  io.to(claimRoom(req.params.id)).emit('claim-update', { requestId: req.params.id, status: 'approved' });
  // todo mundo que estava com a conta no aparelho antigo é deslogado
  io.to(acctRoom(key)).emit('account-transferred');
  io.in(acctRoom(key)).socketsLeave(acctRoom(key));
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

app.post('/api/logout', (req, res) => {
  const token = tokenFrom(req);
  const key = auth.ownerKey(token);
  if (token) auth.logout(token);
  if (key) io.in(acctRoom(key)).socketsLeave(acctRoom(key));
  res.json({ ok: true });
});

function broadcastStats() {
  io.emit('stats', { ...mm.stats(), online });
}

io.on('connection', (socket) => {
  online += 1;
  broadcastStats();

  // o aparelho se identifica para receber avisos da conta (pedidos de login)
  socket.on('hello', ({ token } = {}) => {
    const key = auth.ownerKey(token);
    for (const r of socket.rooms) if (r.startsWith('acct:')) socket.leave(r);
    if (!key) return;
    auth.touch(token);
    socket.join(acctRoom(key));
    socket.emit('login-requests', { requests: auth.pendingFor(token) || [] });
  });

  // quem está esperando aprovação acompanha o pedido ao vivo
  socket.on('watch-claim', ({ requestId } = {}) => {
    if (typeof requestId === 'string' && requestId.length === 64) socket.join(claimRoom(requestId));
  });

  socket.on('find', (req, ack) => {
    req = req || {};
    // o nome vem da conta, nunca do que o cliente mandar
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
    const room = result.room;
    const pub = mm.publicRoom(room);
    // Para evitar colisão de ofertas, cada pessoa que entra inicia a conexão
    // só com quem já estava na sala e com quem entrou antes dela na mesma leva.
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
      if (s) {
        for (const id of result.joined) {
          const m = room.members.get(id);
          s.emit('peer-joined', { room: pub, peer: { id, name: m.name, platform: m.platform } });
        }
      }
    }
    if (typeof ack === 'function') ack({ status: 'matched' });
    broadcastStats();
  });

  socket.on('cancel', () => handleLeave(socket));
  socket.on('leave', () => handleLeave(socket));

  // Sinalização WebRTC: encaminha offer/answer/ice para um peer da mesma sala.
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
    const me = room.members.get(socket.id);
    io.to(room.id).emit('chat', { from: socket.id, name: me ? me.name : '?', text: msg, at: Date.now() });
  });

  socket.on('disconnect', () => {
    online = Math.max(0, online - 1);
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const result = mm.leave(socket.id);
  if (result) {
    socket.leave(result.room.id);
    const pub = mm.publicRoom(result.room);
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
