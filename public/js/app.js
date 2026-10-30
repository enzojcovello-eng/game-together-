/* Game Together: interface, matchmaking e chamada de voz (WebRTC, só áudio) */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];

  const state = {
    config: null,
    uiLang: null,
    game: null,
    mode: 'duo',
    lang: null,
    platform: null,
    name: '',
    localStream: null,
    muted: false,
    room: null,
    me: null,
    peers: new Map(), // id -> { pc, audio, name, platform, meter }
    searching: false,
  };

  // ---------- i18n ----------
  function t(key, vars) {
    const dict = window.I18N[state.uiLang] || window.I18N['pt-BR'];
    let s = dict[key] != null ? dict[key] : (window.I18N['pt-BR'][key] || key);
    if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    return s;
  }

  function detectLang() {
    const saved = localStorage.getItem('gt:uiLang');
    if (saved && window.I18N[saved]) return saved;
    return (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  }

  function setUiLang(lang, { fromCallLang } = {}) {
    state.uiLang = lang;
    localStorage.setItem('gt:uiLang', lang);
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('#ui-lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    if (!fromCallLang) {
      state.lang = lang;
      $$('#lang-choice input').forEach((i) => { i.checked = i.value === lang; });
    }
    renderGameGrid();
    if (state.game) renderSetupTexts();
    if (state.room) renderRoom();
  }

  // ---------- helpers ----------
  function platformLabel(id) {
    const p = state.config.platforms[id];
    return p ? `${p.icon} ${p[state.uiLang] || p['en-US']}` : id;
  }
  function langLabel(code) {
    const l = state.config.languages.find((x) => x.code === code);
    return l ? `${l.flag} ${l.label}` : code;
  }
  function gameById(id) { return state.config.games.find((g) => g.id === id); }

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo({ top: 0 });
  }

  let toastTimer = null;
  function toast(msg, ms = 2800) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  function setError(msg) {
    const el = $('#setup-error');
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  // ---------- tela inicial ----------
  function renderGameGrid() {
    const grid = $('#game-grid');
    if (!state.config) return;
    grid.innerHTML = '';
    for (const g of state.config.games) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'game-card';
      b.style.setProperty('--game-color', g.color);
      b.innerHTML = `
        <span class="emoji">${g.emoji}</span>
        <span class="badge ${g.crossplay || g.crossplayGroups ? 'cross' : 'nocross'}">${g.crossplay || g.crossplayGroups ? 'crossplay' : (state.uiLang === 'pt-BR' ? 'sem crossplay' : 'no crossplay')}</span>
        <span class="name">${g.name}</span>
        <span class="meta">👥 ${t('game.upTo', { n: g.maxPlayers })}</span>
        <span class="meta">${g.platforms.map((p) => state.config.platforms[p].icon).join(' ')}</span>`;
      b.addEventListener('click', () => openSetup(g));
      grid.appendChild(b);
    }
  }

  // ---------- configuração ----------
  function openSetup(game) {
    state.game = game;
    state.platform = null;
    setError('');
    const savedName = localStorage.getItem('gt:name');
    if (savedName) $('#nickname').value = savedName;

    // idioma da chamada: segue o idioma da interface por padrão
    const langWrap = $('#lang-choice');
    langWrap.innerHTML = '';
    for (const l of state.config.languages) {
      const label = document.createElement('label');
      label.className = 'choice';
      label.innerHTML = `<input type="radio" name="lang" value="${l.code}" ${l.code === state.uiLang ? 'checked' : ''}>
        <span class="choice-box"><strong>${l.flag} ${l.label}</strong></span>`;
      langWrap.appendChild(label);
    }
    state.lang = state.uiLang;
    langWrap.addEventListener('change', (e) => {
      if (e.target.name === 'lang') {
        state.lang = e.target.value;
        // escolher o idioma da chamada também traduz a interface
        setUiLang(state.lang, { fromCallLang: true });
      }
    });

    // plataformas disponíveis para o jogo
    const platWrap = $('#platform-choice');
    platWrap.innerHTML = '';
    const savedPlat = localStorage.getItem(`gt:platform:${game.id}`);
    for (const p of game.platforms) {
      const label = document.createElement('label');
      label.className = 'choice';
      label.innerHTML = `<input type="radio" name="platform" value="${p}" ${p === savedPlat ? 'checked' : ''}>
        <span class="choice-box"><strong>${platformLabel(p)}</strong></span>`;
      platWrap.appendChild(label);
    }
    if (savedPlat && game.platforms.includes(savedPlat)) state.platform = savedPlat;
    platWrap.onchange = (e) => { if (e.target.name === 'platform') state.platform = e.target.value; };

    const modeDuo = $('input[name="mode"][value="duo"]');
    const modeGroup = $('input[name="mode"][value="group"]');
    modeDuo.checked = true;
    state.mode = 'duo';
    modeGroup.disabled = game.maxPlayers < 3;
    modeGroup.closest('.choice').style.opacity = modeGroup.disabled ? 0.45 : 1;

    renderSetupTexts();
    showScreen('screen-setup');
  }

  function renderSetupTexts() {
    const g = state.game;
    $('#setup-emoji').textContent = g.emoji;
    $('#setup-title').textContent = g.name;
    $('#setup-sub').textContent = `👥 ${t('game.upTo', { n: g.maxPlayers })} · ${g.crossplay || g.crossplayGroups ? t('game.crossplay') : t('game.noCrossplay')}`;
    $('#group-desc').textContent = t('setup.groupDesc', { n: g.maxPlayers });
    $('#platform-hint').textContent = g.crossplay || g.crossplayGroups ? t('setup.platformCross') : t('setup.platformNoCross');
    $$('#platform-choice .choice').forEach((label) => {
      const input = label.querySelector('input');
      label.querySelector('strong').textContent = platformLabel(input.value);
    });
  }

  async function getMic() {
    if (state.localStream) return state.localStream;
    if (!window.RTCPeerConnection) throw new Error('noWebRTC');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(window.isSecureContext ? 'noWebRTC' : 'insecure');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    state.localStream = stream;
    return stream;
  }

  async function onMatchmake(e) {
    e.preventDefault();
    setError('');
    state.name = $('#nickname').value.trim();
    state.mode = $('input[name="mode"]:checked').value;
    if (!state.name) return setError(t('setup.needName'));
    if (!state.platform) return setError(t('setup.needPlatform'));
    localStorage.setItem('gt:name', state.name);
    localStorage.setItem(`gt:platform:${state.game.id}`, state.platform);

    const btn = $('#matchmake-btn');
    btn.disabled = true;
    try {
      await getMic();
    } catch (err) {
      btn.disabled = false;
      if (err && err.message === 'insecure') return setError(t('setup.insecure'));
      if (err && err.message === 'noWebRTC') return setError(t('setup.noWebRTC'));
      return setError(t('setup.micDenied'));
    }
    applyMute();

    socket.emit('find', {
      name: state.name,
      gameId: state.game.id,
      lang: state.lang,
      platform: state.platform,
      mode: state.mode,
    }, (res) => {
      btn.disabled = false;
      if (!res || res.error) return setError(t(res && res.error ? `err.${res.error}` : 'err.generic'));
      if (res.status === 'waiting') {
        state.searching = true;
        $('#search-summary').textContent = t('search.summary', {
          game: state.game.name, lang: langLabel(state.lang), platform: platformLabel(state.platform),
        });
        showScreen('screen-searching');
      }
      // "matched" chega pelo evento 'matched'
    });
  }

  function cancelSearch() {
    state.searching = false;
    socket.emit('cancel');
    showScreen('screen-setup');
  }

  // ---------- sala / chamada ----------
  function enterRoom(room, me, initiateWith) {
    state.searching = false;
    state.room = room;
    state.me = me;
    $('#chat-log').innerHTML = '';
    renderRoom();
    showScreen('screen-room');
    // O servidor diz com quem devemos iniciar a oferta; com os demais só
    // preparamos a conexão e esperamos a oferta deles.
    const initiators = new Set(initiateWith || []);
    for (const m of room.members) {
      if (m.id !== me) connectPeer(m, initiators.has(m.id));
    }
    monitorLocalLevel();
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    const g = gameById(room.gameId) || { emoji: '🎮', name: room.gameName };
    $('#room-emoji').textContent = g.emoji;
    $('#room-title').textContent = g.name;
    $('#room-sub').textContent = t('room.sub', {
      lang: langLabel(room.lang),
      mode: room.mode === 'duo' ? t('mode.duo') : t('mode.group', { n: room.max }),
    });
    $('#room-count').textContent = room.members.length;
    $('#room-max').textContent = room.max;

    const status = $('#room-status');
    if (room.members.length < 2) { status.textContent = t('room.waiting'); status.classList.remove('live'); }
    else if (room.members.length >= room.max) { status.textContent = t('room.full'); status.classList.add('live'); }
    else { status.textContent = t('room.live'); status.classList.add('live'); }

    const list = $('#members');
    list.innerHTML = '';
    for (const m of room.members) {
      const li = document.createElement('li');
      const isMe = m.id === state.me;
      li.className = 'member' + (isMe && state.muted ? ' muted' : '') + (!isMe && !(state.peers.get(m.id) || {}).connected ? ' connecting' : '');
      li.dataset.id = m.id;
      li.innerHTML = `
        <span class="avatar">${(m.name || '?').slice(0, 1).toUpperCase()}</span>
        <span class="info">
          <span class="name">${escapeHtml(m.name)}${isMe ? ` <span class="muted">(${t('room.you')})</span>` : ''}</span>
          <span class="plat">${platformLabel(m.platform)}</span>
        </span>
        <span class="mic">🎙️</span>`;
      list.appendChild(li);
    }
    $('#mute-btn .ctrl-label').textContent = state.muted ? t('room.unmute') : t('room.mute');
    $('#mute-btn .ctrl-icon').textContent = state.muted ? '🔇' : '🎙️';
    $('#mute-btn').classList.toggle('active', state.muted);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function connectPeer(member, initiator) {
    if (state.peers.has(member.id)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    $('#audio-sink').appendChild(audio);
    const peer = { pc, audio, name: member.name, platform: member.platform, connected: false, meter: null, pending: [] };
    state.peers.set(member.id, peer);

    for (const track of state.localStream.getTracks()) pc.addTrack(track, state.localStream);

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('signal', { to: member.id, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
      monitorRemoteLevel(member.id, e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      peer.connected = pc.connectionState === 'connected';
      const li = document.querySelector(`.member[data-id="${member.id}"]`);
      if (li) li.classList.toggle('connecting', !peer.connected);
      if (pc.connectionState === 'failed') {
        pc.restartIce && pc.restartIce();
      }
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          socket.emit('signal', { to: member.id, data: { sdp: pc.localDescription } });
        } catch (err) { console.warn('offer failed', err); }
      };
    }
    return peer;
  }

  async function onSignal({ from, data }) {
    let peer = state.peers.get(from);
    if (!peer) {
      const m = state.room && state.room.members.find((x) => x.id === from);
      if (!m) return;
      peer = connectPeer(m, false);
    }
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        if (data.sdp.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('signal', { to: from, data: { sdp: pc.localDescription } });
        }
        // candidatos que chegaram antes da descrição remota
        const queued = peer.pending.splice(0);
        for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } else {
          peer.pending.push(data.candidate);
        }
      }
    } catch (err) { console.warn('signal error', err); }
  }

  function removePeer(id) {
    const peer = state.peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch (_) {}
    if (peer.meter) peer.meter.stop();
    peer.audio.remove();
    state.peers.delete(id);
  }

  function leaveRoom({ silent } = {}) {
    for (const id of [...state.peers.keys()]) removePeer(id);
    if (localMeter) { localMeter.stop(); localMeter = null; }
    state.room = null;
    state.me = null;
    socket.emit('leave');
    if (!silent) toast(t('toast.leftRoom'));
    showScreen('screen-setup');
  }

  function applyMute() {
    if (!state.localStream) return;
    for (const tr of state.localStream.getAudioTracks()) tr.enabled = !state.muted;
  }

  function toggleMute() {
    state.muted = !state.muted;
    applyMute();
    renderRoom();
  }

  // ---------- medidor de voz (quem está falando) ----------
  let audioCtx = null;
  let localMeter = null;
  function makeMeter(stream, onLevel) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        onLevel(Math.sqrt(sum / buf.length));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return { stop: () => { cancelAnimationFrame(raf); try { src.disconnect(); } catch (_) {} } };
    } catch (_) { return { stop() {} }; }
  }
  function speakingClass(id, level) {
    const li = document.querySelector(`.member[data-id="${id}"]`);
    if (li) li.classList.toggle('speaking', level > 0.04);
  }
  function monitorLocalLevel() {
    if (localMeter || !state.localStream) return;
    localMeter = makeMeter(state.localStream, (lvl) => speakingClass(state.me, state.muted ? 0 : lvl));
  }
  function monitorRemoteLevel(id, stream) {
    const peer = state.peers.get(id);
    if (!peer || peer.meter) return;
    peer.meter = makeMeter(stream, (lvl) => speakingClass(id, lvl));
  }

  // ---------- chat ----------
  function addChat({ name, text, sys }) {
    const log = $('#chat-log');
    const div = document.createElement('div');
    div.className = 'msg' + (sys ? ' sys' : '');
    div.innerHTML = sys ? escapeHtml(text) : `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });

  socket.on('stats', (s) => { $('#online-count').textContent = s.online; });

  socket.on('matched', ({ room, you, initiateWith }) => enterRoom(room, you, initiateWith));

  socket.on('peer-joined', ({ room, peer }) => {
    if (!state.room) return;
    state.room = room;
    renderRoom();
    toast(t('toast.joined', { name: peer.name }));
    addChat({ sys: true, text: t('toast.joined', { name: peer.name }) });
    // o novo membro é quem inicia a oferta; aqui só preparamos a conexão
    connectPeer(peer, false);
  });

  socket.on('peer-left', ({ room, peerId }) => {
    if (!state.room) return;
    const gone = state.peers.get(peerId);
    const name = gone ? gone.name : '?';
    removePeer(peerId);
    state.room = room;
    renderRoom();
    toast(t('toast.left', { name }));
    addChat({ sys: true, text: t('toast.left', { name }) });
  });

  socket.on('signal', onSignal);
  socket.on('chat', addChat);

  socket.on('disconnect', () => {
    if (state.room || state.searching) toast(t('toast.disconnected'), 5000);
  });
  socket.io.on('reconnect', () => {
    // o servidor perdeu nosso estado; voltamos para a configuração
    if (state.room) leaveRoom({ silent: true });
    if (state.searching) { state.searching = false; showScreen('screen-setup'); }
    toast(t('toast.reconnected'));
  });

  // ---------- eventos da interface ----------
  $('#setup-form').addEventListener('submit', onMatchmake);
  $('#setup-back').addEventListener('click', () => { state.game = null; showScreen('screen-home'); });
  $('#brand-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.room) leaveRoom();
    if (state.searching) cancelSearch();
    state.game = null;
    showScreen('screen-home');
  });
  $('#cancel-btn').addEventListener('click', cancelSearch);
  $('#mute-btn').addEventListener('click', toggleMute);
  $('#leave-btn').addEventListener('click', () => leaveRoom());
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    input.value = '';
  });
  $$('#ui-lang-switch button').forEach((b) => b.addEventListener('click', () => setUiLang(b.dataset.lang)));
  window.addEventListener('beforeunload', () => { if (state.room) socket.emit('leave'); });

  // ---------- boot ----------
  fetch('/api/config')
    .then((r) => r.json())
    .then((cfg) => {
      state.config = cfg;
      setUiLang(detectLang());
    })
    .catch(() => toast('Config error'));
})();
