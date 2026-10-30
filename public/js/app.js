/* Game Together: interface, conta por nome, matchmaking e chamada de voz (WebRTC, só áudio) */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const PLATFORM_ICON = { pc: 'i-pc', playstation: 'i-playstation', xbox: 'i-xbox', switch: 'i-switch', mobile: 'i-mobile' };

  const state = {
    config: null,
    uiLang: null,
    token: null,
    name: '',
    pendingId: null,
    pendingName: '',
    requests: [],
    panelTab: 'chat',
    panelOpen: false,
    game: null,
    mode: 'duo',
    lang: null,
    platform: null,
    localStream: null,
    muted: false,
    room: null,
    me: null,
    peers: new Map(),
    searching: false,
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} },
  };

  // ---------- i18n ----------
  function t(key, vars) {
    const dict = window.I18N[state.uiLang] || window.I18N['pt-BR'];
    let s = dict[key] != null ? dict[key] : (window.I18N['pt-BR'][key] || key);
    if (vars) for (const k of Object.keys(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    return s;
  }
  function detectLang() {
    const saved = store.get('gt:uiLang');
    if (saved && window.I18N[saved]) return saved;
    return (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US';
  }
  function setUiLang(lang, { fromCallLang } = {}) {
    state.uiLang = lang;
    store.set('gt:uiLang', lang);
    document.documentElement.lang = lang;
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    $$('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    $$('#ui-lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    if (!fromCallLang) {
      state.lang = lang;
      $$('#lang-choice input').forEach((i) => { i.checked = i.value === lang; });
    }
    renderGameGrid();
    renderStats();
    renderPending();
    renderRequests();
    if (state.game) renderSetupTexts();
    if (state.room) renderRoom();
  }

  // ---------- utilidades ----------
  const icon = (id, cls = '') => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function platformName(id) {
    const p = state.config.platforms[id];
    return p ? (p[state.uiLang] || p['en-US']) : id;
  }
  function platformHtml(id) {
    return `${icon(PLATFORM_ICON[id] || 'i-pc')}<span>${escapeHtml(platformName(id))}</span>`;
  }
  function langLabel(code) {
    const l = state.config.languages.find((x) => x.code === code);
    return l ? l.label : code;
  }
  function gameById(id) { return state.config.games.find((g) => g.id === id); }
  function coverOf(game) { return game.cover || `covers/${game.id}.svg`; }
  function fullCrossplay(game) { return game.crossplay === true && !Array.isArray(game.crossplayGroups); }
  function partialCrossplay(game) { return Array.isArray(game.crossplayGroups) && game.crossplayGroups.length > 0; }
  const joinNames = (list) => list.map(platformName).join(', ');
  function crossplayVars(game) {
    const grouped = new Set(game.crossplayGroups.flat());
    return {
      together: game.crossplayGroups.map((grp) => joinNames(grp)).join(' / '),
      alone: joinNames(game.platforms.filter((p) => !grouped.has(p))) || '—',
    };
  }
  function crossplayTag(game) {
    if (fullCrossplay(game)) return { cls: '', text: t('game.crossplay') };
    if (partialCrossplay(game)) return { cls: 'partial', text: t('game.partial') };
    return { cls: 'nocross', text: t('game.noCrossplay') };
  }
  function crossplayLong(game) {
    if (fullCrossplay(game)) return t('game.crossplayLong');
    if (partialCrossplay(game)) return t('game.partialLong', crossplayVars(game));
    return t('game.noCrossplayLong');
  }
  let lastStats = null;
  function renderStats(st) {
    if (st) lastStats = st;
    if (!lastStats) return;
    $('#online-count').textContent = lastStats.online;
    $('#calls-count').textContent = lastStats.inCall;
    $('#online-pill').title = t('online.calls', { n: lastStats.inCall });
    $('#home-stats-text').textContent = t('home.stats', { online: lastStats.online, calls: lastStats.inCall });
    const per = lastStats.games || {};
    $$('.game-card .live').forEach((el) => {
      const g = per[el.dataset.game] || { inCall: 0, searching: 0 };
      const parts = [];
      if (g.inCall) parts.push(t('game.inCall', { n: g.inCall }));
      if (g.searching) parts.push(t('game.searching', { n: g.searching }));
      el.querySelector('span:last-child').textContent = parts.length ? parts.join(' · ') : t('game.nobody');
      el.classList.toggle('on', g.inCall > 0 || g.searching > 0);
    });
  }

  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo({ top: 0 });
    placePanel();
  }

  let toastTimer = null;
  function toast(msg, ms = 2800, actions) {
    const el = $('#toast');
    el.innerHTML = `<div>${escapeHtml(msg)}</div>`;
    if (actions && actions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'toast-actions';
      for (const a of actions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = a.primary ? 'btn-primary' : 'btn-secondary';
        b.textContent = a.label;
        b.addEventListener('click', () => { el.hidden = true; a.onClick(); });
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  function setError(sel, msg) {
    const el = $(sel);
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    return fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'generic');
        return data;
      });
  }
  const errText = (err) => {
    const code = err && err.message;
    if (!code || code === 'generic' || code === 'Failed to fetch' || /fetch/i.test(code)) return t('err.network');
    return t(`err.${code}`);
  };

  // ---------- conta ----------
  function setUser(name, token) {
    state.name = name || '';
    state.token = token || null;
    store.set('gt:token', token || null);
    store.set('gt:name', token ? name : null);
    renderUser();
    socket.emit('hello', { token: state.token });
  }
  function renderUser() {
    $('#user-pill').hidden = !state.token;
    $('#panel-btn').hidden = !state.token;
    $('#user-name').textContent = state.name;
    $('#user-avatar').textContent = (state.name || '?').slice(0, 1).toUpperCase();
  }

  async function onAuthSubmit(e) {
    e.preventDefault();
    setError('#auth-error', '');
    const name = $('#auth-name').value.trim();
    const btn = $('#auth-submit');
    btn.disabled = true;
    try {
      const r = await api('/api/claim', { method: 'POST', body: { name } });
      if (r.status === 'pending') {
        startPending(r.requestId, r.name);
      } else {
        setUser(r.name, r.token);
        toast(t('auth.welcome', { name: r.name }));
        showScreen('screen-home');
      }
    } catch (err) {
      setError('#auth-error', errText(err));
    } finally {
      btn.disabled = false;
    }
  }

  function logout({ silent, reason } = {}) {
    if (state.room) leaveRoom({ silent: true });
    if (state.searching) { state.searching = false; socket.emit('cancel'); }
    if (state.token && !reason) api('/api/logout', { method: 'POST' }).catch(() => {});
    setUser('', null);
    state.game = null;
    state.requests = [];
    renderRequests();
    closePanel();
    if (!silent) toast(reason ? t(reason) : t('auth.loggedOut'), reason ? 6000 : 2800);
    showScreen('screen-auth');
  }

  // ---------- pedido de login (quem está esperando) ----------
  let pendingPoll = null;
  function startPending(id, name) {
    state.pendingId = id;
    state.pendingName = name;
    store.set('gt:pending', JSON.stringify({ id, name }));
    renderPending();
    showScreen('screen-pending');
    socket.emit('watch-claim', { requestId: id });
    clearInterval(pendingPoll);
    pendingPoll = setInterval(checkPending, 5000);
    checkPending();
  }
  function renderPending() {
    if (!state.pendingName) return;
    $('#pending-body').textContent = t('pending.body', { name: state.pendingName });
  }
  async function checkPending() {
    if (!state.pendingId) return;
    try {
      const r = await api(`/api/claim/${state.pendingId}`);
      if (r.status === 'approved' && r.token) finishPending(r.name, r.token);
      else if (r.status === 'denied' || r.status === 'unknown') failPending();
    } catch (_) { /* tenta de novo no próximo ciclo */ }
  }
  function finishPending(name, token) {
    clearPending();
    setUser(name, token);
    toast(t('auth.welcome', { name }));
    showScreen('screen-home');
  }
  function failPending() {
    clearInterval(pendingPoll);
    $('#pending-status').textContent = t('pending.denied');
    $('#pending-ring').hidden = true;
    state.pendingId = null;
    store.set('gt:pending', null);
  }
  function clearPending() {
    clearInterval(pendingPoll);
    state.pendingId = null;
    state.pendingName = '';
    store.set('gt:pending', null);
    $('#pending-ring').hidden = false;
    $('#pending-status').textContent = t('pending.wait');
  }
  function cancelPending() {
    if (state.pendingId) api(`/api/claim/${state.pendingId}`, { method: 'DELETE' }).catch(() => {});
    clearPending();
    showScreen('screen-auth');
  }

  // ---------- pedidos de login (quem está com a conta) ----------
  function setRequests(list) {
    state.requests = Array.isArray(list) ? list : [];
    renderRequests();
  }
  async function refreshRequests() {
    if (!state.token) return;
    try { setRequests((await api('/api/requests')).requests); } catch (_) {}
  }
  function renderRequests() {
    const n = state.requests.length;
    for (const id of ['#panel-badge', '#logins-badge']) {
      const b = $(id);
      b.hidden = n === 0;
      b.textContent = n;
    }
    const list = $('#logins-list');
    $('#logins-empty').hidden = n > 0;
    list.innerHTML = '';
    for (const r of state.requests) {
      const li = document.createElement('li');
      li.className = 'login-req';
      const min = Math.max(0, Math.round((Date.now() - r.createdAt) / 60000));
      li.innerHTML = `<div>${escapeHtml(t('req.item', { name: state.name }))}</div>
        <div class="when">${min === 0 ? t('req.now') : t('req.when', { min })}</div>
        <div class="actions">
          <button type="button" class="btn-primary" data-act="approve">${t('req.approve')}</button>
          <button type="button" class="btn-secondary" data-act="deny">${t('req.deny')}</button>
        </div>`;
      li.querySelector('[data-act="approve"]').addEventListener('click', () => approveRequest(r.id));
      li.querySelector('[data-act="deny"]').addEventListener('click', () => denyRequest(r.id));
      list.appendChild(li);
    }
  }
  let approving = false;
  async function approveRequest(id) {
    approving = true;
    try {
      await api(`/api/requests/${id}/approve`, { method: 'POST' });
      // a conta foi para o outro aparelho: este sai
      if (state.token) logout({ reason: 'req.approved' });
    } catch (err) { toast(errText(err)); refreshRequests(); }
    approving = false;
  }
  async function denyRequest(id) {
    try {
      await api(`/api/requests/${id}/deny`, { method: 'POST' });
      setRequests(state.requests.filter((r) => r.id !== id));
      toast(t('req.denied'));
    } catch (err) { toast(errText(err)); refreshRequests(); }
  }
  function onLoginRequest(req) {
    if (!state.token) return;
    if (!state.requests.some((r) => r.id === req.id)) state.requests.push(req);
    renderRequests();
    toast(t('req.toast'), 15000, [
      { label: t('req.approve'), primary: true, onClick: () => approveRequest(req.id) },
      { label: t('req.deny'), onClick: () => denyRequest(req.id) },
    ]);
  }

  // ---------- painel (chat + logins) ----------
  function placePanel() {
    const panel = $('#panel');
    const inRoom = $('#screen-room').classList.contains('active');
    if (inRoom) {
      if (panel.parentElement !== $('#room-panel-slot')) $('#room-panel-slot').appendChild(panel);
      panel.classList.add('inline');
      panel.classList.remove('drawer');
      panel.hidden = false;
      $('#panel-backdrop').hidden = true;
    } else {
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      panel.classList.add('drawer');
      panel.classList.remove('inline');
      panel.hidden = !state.panelOpen;
      $('#panel-backdrop').hidden = !state.panelOpen;
    }
    $('#chat-empty').hidden = Boolean(state.room);
    $('#chat-form').hidden = !state.room;
  }
  function setPanelTab(tab) {
    state.panelTab = tab;
    $$('#panel-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-chat').hidden = tab !== 'chat';
    $('#tab-logins').hidden = tab !== 'logins';
  }
  function openPanel(tab) {
    state.panelOpen = true;
    if (tab) setPanelTab(tab);
    placePanel();
  }
  function closePanel() {
    state.panelOpen = false;
    placePanel();
  }

  // ---------- início ----------
  function renderGameGrid() {
    const grid = $('#game-grid');
    if (!state.config) return;
    grid.innerHTML = '';
    for (const g of state.config.games) {
      const tag = crossplayTag(g);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'game-card';
      b.innerHTML = `
        <span class="cover"><img src="${coverOf(g)}" alt="${escapeHtml(g.name)}" loading="lazy"><span class="tag ${tag.cls}">${tag.text}</span></span>
        <span class="name">${escapeHtml(g.name)}</span>
        <span class="meta">${icon('i-users')}<span>${t('game.upTo', { n: g.maxPlayers })}</span></span>
        <span class="live" data-game="${g.id}"><span class="dot"></span><span></span></span>
        <span class="plats">${g.platforms.map((p) => icon(PLATFORM_ICON[p] || 'i-pc')).join('')}</span>`;
      b.addEventListener('click', () => openSetup(g));
      grid.appendChild(b);
    }
    renderStats();
  }

  // ---------- configuração ----------
  function openSetup(game) {
    state.game = game;
    state.platform = null;
    setError('#setup-error', '');

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
    langWrap.onchange = (e) => {
      if (e.target.name === 'lang') {
        state.lang = e.target.value;
        setUiLang(state.lang, { fromCallLang: true });
      }
    };

    const cross = fullCrossplay(game);
    $('#platform-field').hidden = cross;
    $('#crossplay-note').hidden = !cross;
    const platWrap = $('#platform-choice');
    platWrap.innerHTML = '';
    const savedPlat = cross ? null : store.get(`gt:platform:${game.id}`);
    for (const p of cross ? [] : game.platforms) {
      const label = document.createElement('label');
      label.className = 'choice';
      label.innerHTML = `<input type="radio" name="platform" value="${p}" ${p === savedPlat ? 'checked' : ''}>
        <span class="choice-box"><strong>${platformHtml(p)}</strong></span>`;
      platWrap.appendChild(label);
    }
    if (savedPlat && game.platforms.includes(savedPlat)) state.platform = savedPlat;
    platWrap.onchange = (e) => { if (e.target.name === 'platform') state.platform = e.target.value; };

    const modeDuo = $('input[name="mode"][value="duo"]');
    const modeGroup = $('input[name="mode"][value="group"]');
    modeDuo.checked = true;
    state.mode = 'duo';
    modeGroup.disabled = game.maxPlayers < 3;
    modeGroup.closest('.choice').classList.toggle('disabled', modeGroup.disabled);

    renderSetupTexts();
    showScreen('screen-setup');
  }

  function renderSetupTexts() {
    const g = state.game;
    $('#setup-cover').src = coverOf(g);
    $('#setup-title').textContent = g.name;
    $('#setup-sub').textContent = `${t('game.upTo', { n: g.maxPlayers })} · ${crossplayLong(g)}`;
    $('#platform-hint').textContent = partialCrossplay(g) ? t('setup.platformPartial', crossplayVars(g)) : t('setup.platformNoCross');
    $('#group-desc').textContent = t('setup.groupDesc', { n: g.maxPlayers });
    $$('#platform-choice .choice').forEach((label) => {
      label.querySelector('strong').innerHTML = platformHtml(label.querySelector('input').value);
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
    setError('#setup-error', '');
    state.mode = $('input[name="mode"]:checked').value;
    if (!state.token) return logout({ reason: 'auth.expired' });
    const needsPlatform = !$('#platform-field').hidden;
    if (needsPlatform && !state.platform) return setError('#setup-error', t('setup.needPlatform'));
    if (needsPlatform) store.set(`gt:platform:${state.game.id}`, state.platform);

    const btn = $('#matchmake-btn');
    btn.disabled = true;
    try {
      await getMic();
    } catch (err) {
      btn.disabled = false;
      if (err && err.message === 'insecure') return setError('#setup-error', t('setup.insecure'));
      if (err && err.message === 'noWebRTC') return setError('#setup-error', t('setup.noWebRTC'));
      return setError('#setup-error', t('setup.micDenied'));
    }
    applyMute();

    socket.emit('find', {
      token: state.token,
      gameId: state.game.id,
      lang: state.lang,
      platform: needsPlatform ? state.platform : null,
      mode: state.mode,
    }, (res) => {
      btn.disabled = false;
      if (res && res.error === 'not_logged_in') return logout({ reason: 'auth.expired' });
      if (!res || res.error) return setError('#setup-error', t(res && res.error ? `err.${res.error}` : 'err.generic'));
      if (res.status === 'waiting') {
        state.searching = true;
        $('#search-summary').textContent = t('search.summary', {
          game: state.game.name, lang: langLabel(state.lang),
          platform: needsPlatform ? platformName(state.platform) : t('room.anyPlatform'),
        });
        showScreen('screen-searching');
      }
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
    setPanelTab(state.requests.length ? 'logins' : 'chat');
    showScreen('screen-room');
    const initiators = new Set(initiateWith || []);
    for (const m of room.members) {
      if (m.id !== me) connectPeer(m, initiators.has(m.id));
    }
    monitorLocalLevel();
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    const g = gameById(room.gameId) || { name: room.gameName, id: room.gameId };
    $('#room-cover').src = coverOf(g);
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
      const peer = state.peers.get(m.id);
      li.className = 'member' + (isMe ? ' me' : '') + (isMe && state.muted ? ' muted' : '') + (!isMe && !(peer && peer.connected) ? ' connecting' : '');
      li.dataset.id = m.id;
      li.innerHTML = `
        <span class="avatar">${escapeHtml((m.name || '?').slice(0, 1).toUpperCase())}</span>
        <span class="info">
          <span class="name">${escapeHtml(m.name)}${isMe ? ` <span class="muted">(${t('room.you')})</span>` : ''}</span>
          <span class="plat">${m.platform ? platformHtml(m.platform) : icon('i-globe') + `<span>${t('room.anyPlatform')}</span>`}</span>
        </span>
        <span class="mic">${icon(isMe && state.muted ? 'i-mic-off' : 'i-mic')}</span>`;
      list.appendChild(li);
    }
    $('#mute-btn .ctrl-label').textContent = state.muted ? t('room.unmute') : t('room.mute');
    $('#mute-icon').setAttribute('href', state.muted ? '#i-mic-off' : '#i-mic');
    $('#mute-btn').classList.toggle('active', state.muted);
  }

  function connectPeer(member, initiator) {
    if (state.peers.has(member.id)) return state.peers.get(member.id);
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
      if (pc.connectionState === 'failed' && pc.restartIce) pc.restartIce();
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
        const queued = peer.pending.splice(0);
        for (const c of queued) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      } else if (data.candidate) {
        if (pc.remoteDescription && pc.remoteDescription.type) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        else peer.pending.push(data.candidate);
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
    showScreen(state.token ? 'screen-setup' : 'screen-auth');
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

  // ---------- medidor de voz ----------
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

  // ---------- atualização ----------
  const GITHUB_RAW = 'https://raw.githubusercontent.com/enzojcovello-eng/game-together-/main/package.json';
  let loadedVersion = null; // { version, build } da versão que esta página carregou
  function showUpdate(kind, vars) {
    const banner = $('#update-banner');
    $('#update-text').textContent = kind === 'reload' ? t('update.new') : t('update.github', vars);
    $('#update-btn').hidden = kind !== 'reload';
    $('#update-btn').textContent = t('update.btn');
    $('#update-link').hidden = kind !== 'github';
    $('#update-link').textContent = t('update.githubBtn');
    banner.hidden = false;
  }
  function onServerVersion(v) {
    if (!v || !loadedVersion) return;
    if (v.version !== loadedVersion.version || v.build !== loadedVersion.build) showUpdate('reload');
  }
  async function reloadApp() {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.update();
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    } catch (_) {}
    location.reload();
  }
  const newer = (a, b) => { // a > b em "x.y.z"
    const pa = String(a).split('.').map(Number); const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
    return false;
  };
  async function checkGithub() {
    if (!loadedVersion || !loadedVersion.version) return;
    try {
      const r = await fetch(GITHUB_RAW, { cache: 'no-store' });
      const remote = (await r.json()).version;
      if (remote && newer(remote, loadedVersion.version)) showUpdate('github', { local: loadedVersion.version, remote });
    } catch (_) { /* sem internet ou GitHub bloqueado: ignora */ }
  }

  // ---------- socket ----------
  const socket = io({ transports: ['websocket', 'polling'] });
  socket.on('version', onServerVersion);

  socket.on('stats', renderStats);
  socket.on('matched', ({ room, you, initiateWith }) => enterRoom(room, you, initiateWith));
  socket.on('peer-joined', ({ room, peer }) => {
    if (!state.room) return;
    state.room = room;
    renderRoom();
    toast(t('toast.joined', { name: peer.name }));
    addChat({ sys: true, text: t('toast.joined', { name: peer.name }) });
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

  // conta
  socket.on('login-request', onLoginRequest);
  socket.on('login-requests', ({ requests }) => setRequests(requests));
  socket.on('login-requests-changed', refreshRequests);
  socket.on('account-transferred', () => { if (state.token) logout({ reason: approving ? 'req.approved' : 'auth.transferred' }); });
  socket.on('claim-update', ({ requestId, status }) => {
    if (requestId !== state.pendingId) return;
    if (status === 'approved') checkPending();
    else if (status === 'denied') failPending();
  });

  socket.on('disconnect', () => {
    if (state.room || state.searching) toast(t('toast.disconnected'), 5000);
  });
  socket.io.on('reconnect', () => {
    if (state.room) leaveRoom({ silent: true });
    if (state.searching) { state.searching = false; showScreen('screen-setup'); }
    if (state.token) socket.emit('hello', { token: state.token });
    if (state.pendingId) socket.emit('watch-claim', { requestId: state.pendingId });
    toast(t('toast.reconnected'));
  });

  // ---------- eventos da interface ----------
  $('#auth-form').addEventListener('submit', onAuthSubmit);
  $('#pending-cancel').addEventListener('click', cancelPending);
  $('#logout-btn').addEventListener('click', () => logout());
  $('#setup-form').addEventListener('submit', onMatchmake);
  $('#setup-back').addEventListener('click', () => { state.game = null; showScreen('screen-home'); });
  $('#brand-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (!state.token) return;
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
  $('#update-btn').addEventListener('click', reloadApp);
  $('#panel-btn').addEventListener('click', () => openPanel(state.requests.length ? 'logins' : state.panelTab));
  $('#panel-close').addEventListener('click', closePanel);
  $('#panel-backdrop').addEventListener('click', closePanel);
  $$('#panel-tabs .tab').forEach((b) => b.addEventListener('click', () => setPanelTab(b.dataset.tab)));
  $$('#ui-lang-switch button').forEach((b) => b.addEventListener('click', () => setUiLang(b.dataset.lang)));
  window.addEventListener('beforeunload', () => { if (state.room) socket.emit('leave'); });

  // ---------- boot ----------
  fetch('/api/config')
    .then((r) => r.json())
    .then(async (cfg) => {
      state.config = cfg;
      loadedVersion = { version: cfg.version, build: cfg.build };
      setUiLang(detectLang());
      setPanelTab('chat');
      checkGithub();
      // se o socket já conectou antes de sabermos a versão, confere agora
      api('/api/version').then(onServerVersion).catch(() => {});

      let pending = null;
      try { pending = JSON.parse(store.get('gt:pending') || 'null'); } catch (_) {}
      if (pending && pending.id) { startPending(pending.id, pending.name); return; }

      const token = store.get('gt:token');
      const name = store.get('gt:name') || '';
      if (token) {
        state.token = token; state.name = name;
        try {
          const me = await api('/api/me');
          setUser(me.name, token);
          setRequests(me.pending);
          showScreen('screen-home');
          return;
        } catch (err) {
          if (err.message === 'not_logged_in') { setUser('', null); }
          else { renderUser(); showScreen('screen-home'); return; }
        }
      }
      showScreen('screen-auth');
    })
    .catch(() => toast('Config error'));
})();
