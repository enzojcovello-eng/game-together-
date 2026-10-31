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
    social: { me: null, friends: [], contacts: [], requests: [], dms: {} },
    pendingContact: null, // conversa aberta por nickname antes da primeira mensagem
    profile: { avatar: null, avatarKind: null, title: null },
    ban: null, // { until, reason } enquanto a conta estiver congelada
    clip: null, // { blob, seconds, mime } últimos segundos da chamada, guardados pela pessoa para uma denúncia
    dmWith: null,
    unread: {},
    panelTab: 'reports',
    afterAuth: null, // o que fazer depois de criar o nickname ('matchmake' = seguir para a chamada)
    recent: [],   // pessoas que passaram por chamadas nesta sessão (para denunciar depois)
    myReports: [],
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
    renderUser();
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
    renderMini();
  }

  // ---------- chamada minimizada ----------
  // Fora da tela da chamada, mas ainda nela: barra no pé da tela, microfone aberto.
  function renderMini() {
    const bar = $('#mini-call');
    const minimized = Boolean(state.room) && !$('#screen-room').classList.contains('active');
    bar.hidden = !minimized;
    document.body.classList.toggle('mini-open', minimized);
    if (!minimized) return;
    const room = state.room;
    const g = gameById(room.gameId) || { name: room.gameName, cover: 'icons/icon-512.png' };
    $('#mini-cover').src = room.private ? 'icons/icon-192.png' : coverOf(g);
    $('#mini-title').textContent = room.private ? t('friends.title') : g.name;
    const n = room.members.length;
    $('#mini-sub').innerHTML = `<span class="live-dot"></span>${n > 1 ? t('mini.people', { n }) : t('mini.alone')}`;
    $('#mini-mic-icon').setAttribute('href', state.muted ? '#i-mic-off' : '#i-mic');
    $('#mini-mute').classList.toggle('active', state.muted);
  }
  function minimizeCall() {
    if (!state.room) return;
    showScreen('screen-home');
    toast(t('mini.tip'), 3500);
  }
  function restoreCall() {
    if (!state.room) return;
    showScreen('screen-room');
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
  function sendHello() {
    if (!state.token) return;
    let snapshot = null;
    try { snapshot = JSON.parse(store.get('gt:social') || 'null'); } catch (_) {}
    socket.emit('hello', { token: state.token, name: state.name, snapshot, titleCert: store.get('gt:titleCert') });
  }
  function setUser(name, token) {
    state.name = name || '';
    state.token = token || null;
    store.set('gt:token', token || null);
    store.set('gt:name', token ? name : null);
    renderUser();
    sendHello();
  }
  // O servidor não reconheceu o token (reinício sem SESSION_SECRET, por exemplo):
  // tenta entrar de novo com o mesmo nickname sem incomodar a pessoa.
  let recovering = false;
  async function recoverSession() {
    if (recovering || !state.name) return;
    recovering = true;
    try {
      const r = await api('/api/claim', { method: 'POST', body: { name: state.name } });
      if (r.status === 'pending') { setUser('', null); startPending(r.requestId, r.name); return; }
      setUser(r.name, r.token);
      if (!$('#screen-home').classList.contains('active') && !state.room && !state.searching) showScreen('screen-home');
      toast(t('auth.welcomeBack', { name: r.name }));
    } catch (err) {
      if (err.message !== 'invalid_name' && err.message !== 'too_many_attempts') return; // rede: tenta de novo depois
      logout({ reason: 'auth.expired' });
    } finally { recovering = false; }
  }
  // foto de perfil (ou a inicial do nickname)
  function avatarInner(name, url) {
    return url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy">` : escapeHtml((name || '?').slice(0, 1).toUpperCase());
  }
  const ownerBadge = (title) => (title ? `<span class="owner">${icon('i-crown')}${escapeHtml(title)}</span>` : '');
  function renderUser() {
    $('#user-pill').hidden = !state.token;
    $('#panel-btn').hidden = !state.token;
    $('#login-btn').hidden = Boolean(state.token);
    $('#user-name').innerHTML = escapeHtml(state.name) + ownerBadge(state.profile.title);
    $('#user-avatar').innerHTML = avatarInner(state.name, state.profile.avatar);
    renderProfile();
  }

  // ---------- perfil ----------
  function setProfile(p) {
    if (!p) return;
    // nome "cru" de uma recuperação (tudo minúsculo) não apaga as maiúsculas guardadas aqui
    const raw = p.name && p.name === p.name.toLowerCase() && state.name && state.name.toLowerCase() === p.name && state.name !== p.name;
    if (p.name && state.token && !raw) { state.name = p.name; store.set('gt:name', p.name); }
    state.profile = { avatar: p.avatar || null, avatarKind: p.avatarKind || (p.avatar ? (p.avatar.startsWith('/avatars/') ? 'upload' : 'cover') : null), title: p.title || null };
    if (p.removed) { store.set('gt:avatar', null); store.set('gt:avatarCover', null); toast(t('profile.photoRemoved'), 6000); }
    // o comprovante do título só sai daqui quando a administração tira o título (ou no "Sair")
    if (p.titleCert) store.set('gt:titleCert', p.titleCert);
    else if (p.titleRemoved) store.set('gt:titleCert', null);
    renderUser();
    if (state.room) renderRoom();
  }
  function renderProfile() {
    $('#profile-avatar').innerHTML = avatarInner(state.name, state.profile.avatar);
    $('#profile-name').innerHTML = escapeHtml(state.name) + ownerBadge(state.profile.title);
    const grid = $('#avatar-covers');
    if (state.config && !grid.childElementCount) {
      grid.innerHTML = state.config.games.map((g) => `<button type="button" data-id="${g.id}" title="${escapeHtml(g.name)}"><img src="${coverOf(g)}" alt="${escapeHtml(g.name)}" loading="lazy"></button>`).join('');
      grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => chooseCover(b.dataset.id)));
    }
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', state.profile.avatarKind === 'cover' && state.profile.avatar && state.profile.avatar.includes(`/${b.dataset.id}.`)));
  }
  async function chooseCover(id) {
    setError('#avatar-error', '');
    try {
      const p = await api('/api/profile/avatar/cover', { method: 'POST', body: { id } });
      store.set('gt:avatar', null);
      store.set('gt:avatarCover', id || null);
      setProfile({ ...p, avatarKind: id ? 'cover' : null });
      toast(t('profile.photoSaved'));
      $('#avatar-picker').hidden = true;
    } catch (err) { setError('#avatar-error', errText(err)); }
  }
  function readImage(file, max = 512) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad_image')); };
      img.src = url;
    });
  }
  async function uploadAvatar(file, { silent } = {}) {
    if (!file) return;
    setError('#avatar-error', '');
    if (file.size > 4 * 1024 * 1024) return setError('#avatar-error', t('err.too_large'));
    let data;
    try { data = await readImage(file); } catch (_) { return setError('#avatar-error', t('err.bad_image')); }
    if (!silent) toast(t('profile.checking'), 30000);
    try {
      const p = await api('/api/profile/avatar', { method: 'POST', body: { image: data } });
      store.set('gt:avatar', data); // cópia local: volta sozinha se o servidor perder a foto
      store.set('gt:avatarCover', null);
      setProfile({ ...p, avatarKind: 'upload' });
      toast(t('profile.photoSaved'));
      $('#avatar-picker').hidden = true;
    } catch (err) { $('#toast').hidden = true; setError('#avatar-error', errText(err)); }
  }
  // o servidor perdeu a foto (reinício sem dados): devolve a cópia local (foto enviada ou capa escolhida)
  let reuploaded = false;
  async function maybeReupload() {
    if (reuploaded || state.profile.avatar) return;
    const data = store.get('gt:avatar');
    const cover = store.get('gt:avatarCover');
    if (!data && !cover) return;
    reuploaded = true;
    try {
      if (data) {
        const p = await api('/api/profile/avatar', { method: 'POST', body: { image: data } });
        setProfile({ ...p, avatarKind: 'upload' });
      } else {
        const p = await api('/api/profile/avatar/cover', { method: 'POST', body: { id: cover } });
        setProfile({ ...p, avatarKind: 'cover' });
      }
    } catch (_) { /* fica sem foto até a pessoa escolher outra */ }
  }
  async function renameAccount(newName) {
    setError('#rename-error', '');
    try {
      const p = await api('/api/profile/name', { method: 'POST', body: { name: newName } });
      if (p.token) { state.token = p.token; store.set('gt:token', p.token); }
      setProfile(p);
      sendHello();
      toast(t('profile.renamed', { name: p.name }), 5000);
      $('#rename-form').hidden = true;
      if (state.room) renderRoom();
    } catch (err) { setError('#rename-error', errText(err)); }
  }
  let reportTarget = null;
  let reportImage = null;
  let reportAudio = null; // áudio escolhido do aparelho (dataURL)
  function reportUser(name) {
    reportTarget = name;
    reportImage = null;
    reportAudio = null;
    $('#report-who').textContent = name;
    $('#report-note').value = '';
    $('#report-file-name').textContent = '';
    $('#report-audio-name').textContent = '';
    setError('#report-error', '');
    $('#report-clip').hidden = !state.clip;
    if (state.clip) $('#report-clip-text').textContent = t('clip.attached', { s: state.clip.seconds });
    $('#report-backdrop').hidden = false;
    $('#report-note').focus();
  }
  function closeReport() { $('#report-backdrop').hidden = true; reportTarget = null; reportImage = null; reportAudio = null; }
  async function pickReportAudio(file) {
    if (!file) return;
    setError('#report-error', '');
    if (file.size > 6 * 1024 * 1024) return setError('#report-error', t('report.audioBig'));
    const type = file.type || '';
    const okType = /^audio\/(webm|mp4|ogg|mpeg|aac|x-m4a)$/i.test(type) || /^video\/webm$/i.test(type) || /\.(m4a|mp3|ogg|webm)$/i.test(file.name);
    if (!okType) return setError('#report-error', t('report.audioType'));
    let data = await blobToDataUrl(file);
    // alguns celulares não informam o tipo: deduz pela extensão
    if (!type) data = data.replace(/^data:[^;]*;/, `data:audio/${/\.mp3$/i.test(file.name) ? 'mpeg' : /\.ogg$/i.test(file.name) ? 'ogg' : /\.webm$/i.test(file.name) ? 'webm' : 'mp4'};`);
    reportAudio = data;
    $('#report-audio-name').textContent = file.name;
    $('#report-clip').hidden = true; // o áudio escolhido vale no lugar do trecho
  }
  async function sendReport(e) {
    e.preventDefault();
    const note = $('#report-note').value.trim();
    if (note.length < 10) return setError('#report-error', t('report.short'));
    const btn = $('#report-send');
    btn.disabled = true;
    try {
      const audio = reportAudio || (state.clip && !$('#report-clip').hidden ? await blobToDataUrl(state.clip.blob) : undefined);
      await api('/api/report', { method: 'POST', body: { target: reportTarget, reason: 'other', note, image: reportImage || undefined, audio } });
      if (audio && !reportAudio) { state.clip = null; $('#clip-btn').classList.remove('rec-on'); }
      closeReport();
      toast(t('report.sent'), 4000);
      loadMyReports();
    } catch (err) { setError('#report-error', errText(err)); }
    btn.disabled = false;
  }
  async function pickReportImage(file) {
    if (!file) return;
    try {
      reportImage = await readImage(file, 1280);
      $('#report-file-name').textContent = file.name;
    } catch (_) { setError('#report-error', t('err.bad_image')); }
  }

  // ---------- conta congelada (banimento) ----------
  let banTimer = null;
  function fmtLeft(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return `${d}d ${h}h ${m}min`;
    if (h) return `${h}h ${m}min ${sec}s`;
    return `${m}min ${sec}s`;
  }
  function setBan(ban) {
    state.ban = ban || null;
    clearInterval(banTimer);
    const ov = $('#ban-overlay');
    if (!state.ban) { ov.hidden = true; document.body.classList.remove('banned'); return; }
    if (state.room) leaveRoom({ silent: true });
    if (state.searching) { state.searching = false; socket.emit('cancel'); }
    closePanel(); closeReport();
    $('#ban-reason').textContent = state.ban.reason ? t('ban.reason', { reason: state.ban.reason }) : t('ban.noReason');
    ov.hidden = false;
    document.body.classList.add('banned');
    const tick = () => {
      if (!state.ban.until) { $('#ban-left').textContent = t('ban.forever'); return; }
      const left = state.ban.until - Date.now();
      $('#ban-left').textContent = fmtLeft(left);
      if (left <= 0) { clearInterval(banTimer); checkBanOver(); }
    };
    tick();
    banTimer = setInterval(tick, 1000);
  }
  async function checkBanOver() {
    try {
      const me = await api('/api/me');
      if (!me.ban) { setBan(null); toast(t('ban.over'), 5000); showScreen('screen-home'); }
      else setBan(me.ban);
    } catch (_) { setTimeout(checkBanOver, 5000); }
  }

  // sem nickname ainda: a tela do nickname aparece só agora, na hora de entrar na chamada
  function askNickname(next) {
    state.afterAuth = next || null;
    $('#auth-why').hidden = next !== 'matchmake';
    showScreen('screen-auth');
    $('#auth-name').focus();
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
        $('#auth-why').hidden = true;
        const next = state.afterAuth; state.afterAuth = null;
        if (state.game) { showScreen('screen-setup'); if (next === 'matchmake') $('#setup-form').requestSubmit(); }
        else showScreen('screen-home');
      }
    } catch (err) {
      setError('#auth-error', errText(err));
    } finally {
      btn.disabled = false;
    }
  }
  // o api() devolve só o código; para 'banned' o servidor manda também o prazo
  

  function confirmLogout() {
    if (state.ban) return;
    toast(t('logout.confirm'), 20000, [
      { label: t('logout.yes'), primary: true, onClick: () => logout() },
      { label: t('logout.no'), onClick: () => {} },
    ]);
  }
  function logout({ silent, reason } = {}) {
    if (state.room) leaveRoom({ silent: true });
    if (state.searching) { state.searching = false; socket.emit('cancel'); }
    if (state.token && !reason) api('/api/logout', { method: 'POST' }).catch(() => {});
    setUser('', null);
    store.set('gt:social', null);
    store.set('gt:avatar', null);
    store.set('gt:avatarCover', null);
    store.set('gt:titleCert', null);
    state.profile = { avatar: null, avatarKind: null, title: null };
    state.game = null;
    state.requests = [];
    state.dmWith = null;
    state.unread = {};
    setSocial({ me: null, friends: [], requests: [], dms: {} });
    renderRequests();
    closePanel();
    if (!silent) toast(reason ? t(reason) : t('auth.loggedOut'), reason ? 6000 : 2800);
    showScreen('screen-home');
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
    $('#auth-name').focus();
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
  function unreadTotal() { return Object.values(state.unread).reduce((a, b) => a + b, 0); }
  function renderBadges() {
    const logins = state.requests.length;
    const friends = state.social.requests.length + unreadTotal();
    const set = (id, n) => { const b = $(id); b.hidden = n === 0; b.textContent = n; };
    set('#logins-badge', logins);
    set('#friends-badge', friends);
    set('#panel-badge', logins + friends);
  }
  function renderRequests() {
    renderBadges();
    const list = $('#logins-list');
    $('#logins-empty').hidden = state.requests.length > 0;
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
  async function approveRequest(id) {
    try {
      await api(`/api/requests/${id}/approve`, { method: 'POST' });
      setRequests(state.requests.filter((r) => r.id !== id));
      toast(t('req.approved'), 5000);
    } catch (err) { toast(errText(err)); refreshRequests(); }
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

  // ---------- painel (denúncias, amigos, perfil, logins) ----------
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
    $('#panel-chat-form').hidden = !state.room;
  }
  function setPanelTab(tab) {
    state.panelTab = tab;
    $$('#panel-tabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tab-reports').hidden = tab !== 'reports';
    $('#tab-chat').hidden = tab !== 'chat';
    $('#tab-friends').hidden = tab !== 'friends';
    $('#tab-profile').hidden = tab !== 'profile';
    $('#tab-logins').hidden = tab !== 'logins';
    if (tab === 'profile') renderProfile();
    if (tab === 'reports') { renderReportsTab(); loadMyReports(); }
    if (tab === 'friends' && state.dmWith) markRead(state.dmWith);
  }

  // ---------- aba de denúncias ----------
  function rememberPeople(room) {
    if (!room) return;
    for (const m of room.members) {
      if (m.id === state.me) continue;
      const key = keyOf(m.name);
      state.recent = state.recent.filter((r) => r.key !== key);
      state.recent.unshift({ key, name: m.name, avatar: m.avatar || null, title: m.title || null, at: Date.now() });
    }
    state.recent = state.recent.slice(0, 20);
  }
  function personLi(p, extra = '') {
    const li = document.createElement('li');
    li.className = 'friend';
    li.innerHTML = `<span class="avatar">${avatarInner(p.name, p.avatar)}</span>
      <span class="info"><span class="name">${escapeHtml(p.name)}${ownerBadge(p.title)}${extra}</span></span>
      <span class="acts"><button type="button" class="btn-secondary small report-person">${icon('i-flag')}${t('report.btn')}</button></span>`;
    li.querySelector('button').addEventListener('click', () => reportUser(p.name));
    return li;
  }
  function renderReportsTab() {
    const inCall = state.room ? state.room.members.filter((m) => m.id !== state.me) : [];
    const room = $('#report-room');
    room.innerHTML = '';
    for (const m of inCall) room.appendChild(personLi({ name: m.name, avatar: m.avatar, title: m.title }));
    $('#report-room-empty').hidden = inCall.length > 0;
    const inCallKeys = new Set(inCall.map((m) => keyOf(m.name)));
    const recent = state.recent.filter((r) => !inCallKeys.has(r.key));
    const rl = $('#report-recent');
    rl.innerHTML = '';
    for (const r of recent) rl.appendChild(personLi(r));
    $('#report-recent-wrap').hidden = recent.length === 0;
    renderMyReports();
  }
  function renderMyReports() {
    const wrap = $('#my-reports-wrap');
    const ul = $('#my-reports');
    ul.innerHTML = '';
    for (const r of state.myReports) {
      const li = document.createElement('li');
      const status = r.status === 'open' ? 'open' : r.status === 'dismissed' ? 'dismissed' : 'done';
      li.className = 'my-report ' + status;
      li.innerHTML = `<span class="who">${escapeHtml(r.target)}</span><span class="when">${new Date(r.at).toLocaleDateString(state.uiLang === 'en-US' ? 'en-US' : 'pt-BR')}</span><span class="status">${t('reports.status.' + status)}</span>`;
      ul.appendChild(li);
    }
    wrap.hidden = state.myReports.length === 0;
  }
  async function loadMyReports() {
    if (!state.token) return;
    try {
      const { reports } = await api('/api/my-reports');
      state.myReports = reports || [];
      renderMyReports();
    } catch (_) { /* sem rede ou sem conta: a lista fica como está */ }
  }
  async function reportByName(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    setError('#report-name-error', '');
    if (!clean) return;
    if (keyOf(clean) === keyOf(state.name)) return setError('#report-name-error', t('reports.self'));
    try {
      const { exists, name: real } = await api('/api/exists/' + encodeURIComponent(clean));
      if (!exists) return setError('#report-name-error', t('reports.unknown'));
      $('#report-name-input').value = '';
      reportUser(real || clean);
    } catch (err) { setError('#report-name-error', errText(err)); }
  }

  // ---------- amigos ----------
  const keyOf = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const friendOf = (key) => state.social.friends.find((f) => f.key === key);
  const contactOf = (key) => state.social.contacts.find((f) => f.key === key) || (state.pendingContact && state.pendingContact.key === key ? state.pendingContact : null);
  const personOf = (key) => friendOf(key) || contactOf(key);
  const friendName = (key) => { const f = personOf(key); return f ? f.name : key; };
  function setSocial(st) {
    state.social = { me: st.me || null, friends: st.friends || [], contacts: st.contacts || [], requests: st.requests || [], dms: st.dms || {} };
    if (state.pendingContact && (friendOf(state.pendingContact.key) || state.social.contacts.some((c) => c.key === state.pendingContact.key))) state.pendingContact = null;
    for (const k of Object.keys(state.unread)) if (!personOf(k)) delete state.unread[k];
    if (state.token) store.set('gt:social', JSON.stringify({ friends: state.social.friends.map((f) => f.key), dms: state.social.dms }));
    if (state.dmWith && !personOf(state.dmWith)) closeDm();
    renderFriends();
    renderBadges();
    if (state.room) renderRoom();
    if (state.dmWith) renderDm();
  }
  function renderFriends() {
    const reqs = state.social.requests;
    $('#friend-requests-wrap').hidden = reqs.length === 0;
    const rl = $('#friend-requests');
    rl.innerHTML = '';
    for (const r of reqs) {
      const li = document.createElement('li');
      li.className = 'friend is-online';
      li.innerHTML = `<span class="avatar">${avatarInner(r.name, r.avatar)}</span>
        <span class="info"><span class="name">${escapeHtml(r.name)}</span><span class="sub">${t('friends.pendingFrom')}</span></span>
        <span class="acts">
          <button type="button" class="icon-btn primary" data-act="accept" title="${t('friends.accept')}">${icon('i-check')}</button>
          <button type="button" class="icon-btn" data-act="decline" title="${t('friends.decline')}">${icon('i-x')}</button>
        </span>`;
      li.querySelector('[data-act="accept"]').addEventListener('click', () => socket.emit('friend-accept', { from: r.from }));
      li.querySelector('[data-act="decline"]').addEventListener('click', () => socket.emit('friend-decline', { from: r.from }));
      rl.appendChild(li);
    }
    const list = $('#friends-list');
    list.innerHTML = '';
    $('#friends-empty').hidden = state.social.friends.length > 0;
    const sorted = [...state.social.friends].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    for (const f of sorted) {
      const li = document.createElement('li');
      li.className = 'friend' + (f.online ? ' is-online' : '');
      const unread = state.unread[f.key] || 0;
      li.innerHTML = `<span class="avatar">${avatarInner(f.name, f.avatar)}<span class="st"></span></span>
        <span class="info"><span class="name">${escapeHtml(f.name)}</span><span class="sub">${ownerBadge(f.title)}${f.online ? t('friends.online') : t('friends.offline')}</span></span>
        ${unread ? `<span class="unread">${unread}</span>` : ''}
        <span class="acts">
          <button type="button" class="icon-btn" data-act="dm" title="${t('friends.message')}">${icon('i-chat')}</button>
          <button type="button" class="icon-btn primary" data-act="call" title="${t('friends.call')}">${icon('i-mic')}</button>
          <button type="button" class="icon-btn danger" data-act="rm" title="${t('friends.remove')}">${icon('i-trash')}</button>
          <button type="button" class="icon-btn danger" data-act="report" title="${t('report.btn')}">${icon('i-flag')}</button>
        </span>`;
      li.querySelector('[data-act="report"]').addEventListener('click', () => reportUser(f.name));
      li.querySelector('[data-act="dm"]').addEventListener('click', () => openDm(f.key));
      li.querySelector('[data-act="call"]').addEventListener('click', () => callFriend(f.key));
      li.querySelector('[data-act="rm"]').addEventListener('click', () => toast(t('friends.removeConfirm', { name: f.name }), 15000, [
        { label: t('friends.removeYes'), primary: true, onClick: () => socket.emit('unfriend', { name: f.key }) },
        { label: t('friends.cancel'), onClick: () => {} },
      ]));
      list.appendChild(li);
    }
    const cl = $('#contacts-list');
    cl.innerHTML = '';
    const contacts = [...state.social.contacts].sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
    for (const c of contacts) {
      const li = document.createElement('li');
      li.className = 'friend' + (c.online ? ' is-online' : '');
      const unread = state.unread[c.key] || 0;
      li.innerHTML = `<span class="avatar">${avatarInner(c.name, c.avatar)}<span class="st"></span></span>
        <span class="info"><span class="name">${escapeHtml(c.name)}</span><span class="sub">${ownerBadge(c.title)}${c.online ? t('friends.online') : t('friends.offline')}</span></span>
        ${unread ? `<span class="unread">${unread}</span>` : ''}
        <span class="acts">
          <button type="button" class="icon-btn" data-act="dm" title="${t('friends.message')}">${icon('i-chat')}</button>
          <button type="button" class="icon-btn primary" data-act="add" title="${t('friends.add')}">${icon('i-plus')}</button>
          <button type="button" class="icon-btn danger" data-act="report" title="${t('report.btn')}">${icon('i-flag')}</button>
        </span>`;
      li.querySelector('[data-act="dm"]').addEventListener('click', () => openDm(c.key));
      li.querySelector('[data-act="add"]').addEventListener('click', () => addFriend(c.name));
      li.querySelector('[data-act="report"]').addEventListener('click', () => reportUser(c.name));
      cl.appendChild(li);
    }
    $('#contacts-wrap').hidden = contacts.length === 0;
  }
  async function openDirect(name) {
    const clean = String(name || '').trim().replace(/\s+/g, ' ');
    setError('#direct-error', '');
    if (!clean) return;
    if (keyOf(clean) === keyOf(state.name)) return setError('#direct-error', t('friends.self'));
    try {
      const { exists, name: real } = await api('/api/exists/' + encodeURIComponent(clean));
      if (!exists) return setError('#direct-error', t('reports.unknown'));
      const key = keyOf(real || clean);
      if (!personOf(key)) state.pendingContact = { key, name: real || clean, avatar: null, title: null, online: false };
      $('#direct-input').value = '';
      openDm(key);
    } catch (err) { setError('#direct-error', errText(err)); }
  }
  function addFriend(name) {
    socket.emit('friend-request', { to: name }, (r) => {
      if (!r || r.error) return toast(r && r.error ? t(`err.${r.error}`) : t('err.generic'));
      if (r.status === 'already' || r.status === 'friends') return toast(t('friends.already'));
      toast(t('friends.sent', { name }));
    });
  }
  function markRead(key) {
    if (state.unread[key]) { delete state.unread[key]; renderFriends(); renderBadges(); }
  }
  function openDm(key) {
    state.dmWith = key;
    $('#friends-home').hidden = true;
    $('#dm-view').hidden = false;
    $('#dm-name').textContent = friendName(key);
    $('#dm-call').hidden = !friendOf(key); // chamada direta só entre amigos
    markRead(key);
    renderDm();
    $('#dm-input').focus();
  }
  function closeDm() {
    state.dmWith = null;
    $('#friends-home').hidden = false;
    $('#dm-view').hidden = true;
  }
  function renderDm() {
    const log = $('#dm-log');
    log.innerHTML = '';
    const me = state.social.me;
    for (const m of state.social.dms[state.dmWith] || []) {
      const div = document.createElement('div');
      div.className = 'msg' + (m.from === me ? ' mine' : '');
      const d = new Date(m.at);
      div.innerHTML = `${escapeHtml(m.text)}<time>${d.toLocaleDateString(state.uiLang, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(state.uiLang, { hour: '2-digit', minute: '2-digit' })}</time>`;
      log.appendChild(div);
    }
    log.scrollTop = log.scrollHeight;
  }
  function onDm({ with: key, msg }) {
    const list = state.social.dms[key] || (state.social.dms[key] = []);
    if (!list.some((m) => m.id === msg.id)) list.push(msg);
    if (state.token) store.set('gt:social', JSON.stringify({ friends: state.social.friends.map((f) => f.key), dms: state.social.dms }));
    const viewing = state.dmWith === key && !$('#tab-friends').hidden && !$('#panel').hidden;
    if (msg.from !== state.social.me && !viewing) {
      state.unread[key] = (state.unread[key] || 0) + 1;
      toast(`${friendName(key)}: ${msg.text}`, 4000);
    }
    renderFriends();
    renderBadges();
    if (state.dmWith === key) renderDm();
  }
  async function callFriend(key) {
    const f = friendOf(key);
    if (!f) return;
    if (!f.online) return toast(t('friends.offlineCall', { name: f.name }));
    try { await getMic(); applyMute(); } catch (err) { return toast(t(err && err.message === 'insecure' ? 'setup.insecure' : 'setup.micDenied'), 5000); }
    socket.emit('invite', { to: key }, (r) => {
      if (!r || r.error) return toast(r && r.error ? t(`err.${r.error}`) : t('err.generic'));
      toast(t('invite.sent', { name: f.name }), 5000);
      closePanel();
    });
  }
  async function acceptInvite(id) {
    try { await getMic(); applyMute(); } catch (err) { return toast(t(err && err.message === 'insecure' ? 'setup.insecure' : 'setup.micDenied'), 5000); }
    keepAliveStart();
    ensureAudioCtx();
    awakeVideoStart();
    socket.emit('invite-accept', { id }, (r) => {
      if (!r || r.error) toast(r && r.error ? t(`err.${r.error}`) : t('err.generic'));
    });
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
  // capas inclinadas deslizando devagar no topo (a lista vem duas vezes para não ter emenda)
  function renderHeroCovers() {
    const track = $('#hero-track');
    if (!track || !state.config) return;
    const games = state.config.games;
    track.innerHTML = [...games, ...games].map((g) => `<div class="hero-cover"><img src="${coverOf(g)}" alt="" loading="lazy"></div>`).join('');
  }
  async function copySiteLink() {
    const url = location.origin + '/';
    try {
      if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) { await navigator.share({ title: 'Game Together', url }); return; }
      await navigator.clipboard.writeText(url);
      toast(t('hero.copied'));
    } catch (_) { toast(url, 5000); }
  }
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
      b.dataset.name = g.name;
      b.addEventListener('click', () => openSetup(g));
      grid.appendChild(b);
    }
    renderStats();
    filterGames();
  }

  // busca por nome: ignora maiúsculas e acentos
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  function filterGames() {
    const q = fold($('#game-search').value.trim());
    let shown = 0;
    $$('#game-grid .game-card').forEach((card) => {
      const hit = !q || fold(card.dataset.name).includes(q);
      card.classList.toggle('hidden', !hit);
      if (hit) shown += 1;
    });
    $('#game-empty').hidden = shown > 0;
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
    watchMic(stream);
    return stream;
  }

  async function onMatchmake(e) {
    e.preventDefault();
    setError('#setup-error', '');
    if (state.ban) return setBan(state.ban);
    if (state.room) leaveRoom({ silent: true }); // procurar outra chamada encerra a minimizada
    state.mode = $('input[name="mode"]:checked').value;
    if (!state.token) return askNickname('matchmake');
    const needsPlatform = !$('#platform-field').hidden;
    if (needsPlatform && !state.platform) return setError('#setup-error', t('setup.needPlatform'));
    if (needsPlatform) store.set(`gt:platform:${state.game.id}`, state.platform);

    const btn = $('#matchmake-btn');
    btn.disabled = true;
    keepAliveStart();
    ensureAudioCtx();
    awakeVideoStart();
    try {
      await getMic();
      keepAlivePlay();
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
      if (res && res.error === 'banned') return setBan(res.ban || { until: null, reason: '' });
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
    keepAliveStop();
    wakeLockOff();
    showScreen('screen-setup');
  }

  // ---------- sala / chamada ----------
  function enterRoom(room, me, initiateWith) {
    const rejoin = Boolean(state.room && state.room.id === room.id);
    const solo = !rejoin && !room.private && room.members.length === 1;
    state.searching = false;
    state.room = room;
    state.me = me;
    if (!rejoin) { $('#chat-log').innerHTML = ''; $('#panel-chat-log').innerHTML = ''; state.clip = null; $('#clip-btn').classList.remove('rec-on'); }
    rememberPeople(room);
    renderRoom();
    setPanelTab(state.requests.length ? 'logins' : 'reports');
    showScreen('screen-room');
    const initiators = new Set(initiateWith || []);
    for (const m of room.members) {
      if (m.id !== me) connectPeer(m, initiators.has(m.id));
    }
    monitorLocalLevel();
    recStart();
    keepAliveStart();
    mediaSessionStart(room);
    wakeLockOn();
    if (solo) toast(t('room.solo'), 7000);
    if (!rejoin && room.members.length > 1) playTone('join');
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    const g = gameById(room.gameId) || { name: room.gameName, id: room.gameId, cover: 'icons/icon-512.png' };
    $('#room-cover').src = coverOf(g);
    $('#room-title').textContent = room.private ? t('room.friends') : g.name;
    $('#room-sub').textContent = room.private ? t('room.friendsSub') : t('room.sub', {
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
      const canAdd = !isMe && state.token && !friendOf(keyOf(m.name));
      li.innerHTML = `
        <span class="avatar">${avatarInner(m.name, isMe ? state.profile.avatar : m.avatar)}</span>
        <span class="info">
          <span class="name">${escapeHtml(m.name)}${isMe ? ` <span class="muted">(${t('room.you')})</span>` : ''}</span>
          <span class="plat">${ownerBadge(isMe ? state.profile.title : m.title)}${m.platform ? platformHtml(m.platform) : icon('i-globe') + `<span>${room.private ? t('friends.title').toLowerCase() : t('room.anyPlatform')}</span>`}</span>
        </span>
        ${isMe ? '' : `<button type="button" class="report" title="${t('report.btn')}">${icon('i-flag')}</button>`}
        ${canAdd ? `<button type="button" class="add">${icon('i-plus')}${t('friends.add')}</button>` : ''}
        <span class="mic">${icon(isMe && state.muted ? 'i-mic-off' : 'i-mic')}</span>`;
      if (!isMe) li.querySelector('.report').addEventListener('click', () => reportUser(m.name));
      if (canAdd) li.querySelector('.add').addEventListener('click', () => addFriend(m.name));
      list.appendChild(li);
    }
    if (!$('#tab-reports').hidden) renderReportsTab();
    renderMini();
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
    audio.addEventListener('pause', () => { if (state.peers.get(member.id) === peer && audio.srcObject) setTimeout(() => audio.play().catch(() => {}), 300); });
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
      recAdd(member.id, e.streams[0]);
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
    recStop();
    keepAliveStop();
    mediaSessionStop();
    wakeLockOff();
    state.room = null;
    state.me = null;
    socket.emit('leave');
    if (!silent) toast(t('toast.leftRoom'));
    showScreen(!state.token ? 'screen-auth' : state.game ? 'screen-setup' : 'screen-home');
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

  // ---------- últimos 30 s da chamada (só em memória, no aparelho) ----------
  // Três gravadores se revezam: um novo a cada 10 s, cada um vive 30 s. Ao pedir o
  // trecho, o mais antigo em andamento é fechado: ele tem entre 20 e 30 s.
  const rec = { ctx: null, dest: null, sources: new Map(), recorders: [], timer: null, mime: null };
  function recMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) if (MediaRecorder.isTypeSupported(m)) return m;
    return '';
  }
  function recStart() {
    if (rec.ctx || !state.localStream) return;
    try {
      rec.mime = recMime();
      if (rec.mime === null) return;
      rec.ctx = audioCtx || (audioCtx = new (window.AudioContext || window.webkitAudioContext)());
      rec.dest = rec.ctx.createMediaStreamDestination();
      recAdd('me', state.localStream);
      for (const [id, p] of state.peers) if (p.audio && p.audio.srcObject) recAdd(id, p.audio.srcObject);
      recSpawn();
      rec.timer = setInterval(recSpawn, 10000);
    } catch (_) { recStop(); }
  }
  function recAdd(id, stream) {
    if (!rec.ctx || rec.sources.has(id) || !stream.getAudioTracks().length) return;
    try { const src = rec.ctx.createMediaStreamSource(stream); src.connect(rec.dest); rec.sources.set(id, src); } catch (_) {}
  }
  function recSpawn() {
    if (!rec.dest) return;
    try {
      const r = new MediaRecorder(rec.dest.stream, rec.mime ? { mimeType: rec.mime } : undefined);
      r.chunks = []; r.startedAt = Date.now();
      r.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
      r.start(1000);
      rec.recorders.push(r);
      while (rec.recorders.length > 3) { const old = rec.recorders.shift(); try { old.ondataavailable = null; old.stop(); } catch (_) {} }
    } catch (_) {}
  }
  function recStop() {
    clearInterval(rec.timer);
    for (const r of rec.recorders) { try { r.ondataavailable = null; r.stop(); } catch (_) {} }
    for (const srcNode of rec.sources.values()) { try { srcNode.disconnect(); } catch (_) {} }
    rec.recorders = []; rec.sources.clear(); rec.ctx = null; rec.dest = null; rec.timer = null;
  }
  function captureClip() {
    return new Promise((resolve) => {
      const r = rec.recorders[0];
      if (!r || r.state !== 'recording') return resolve(null);
      const seconds = Math.min(30, Math.round((Date.now() - r.startedAt) / 1000));
      r.onstop = () => {
        const blob = new Blob(r.chunks, { type: r.mimeType || rec.mime || 'audio/webm' });
        rec.recorders = rec.recorders.filter((x) => x !== r);
        recSpawn();
        resolve(blob.size ? { blob, seconds, mime: blob.type } : null);
      };
      try { r.stop(); } catch (_) { resolve(null); }
    });
  }
  async function saveClip() {
    if (typeof MediaRecorder === 'undefined') return toast(t('clip.unsupported'), 4000);
    const clip = await captureClip();
    if (!clip || clip.seconds < 2) return toast(t('clip.none'), 4000);
    state.clip = clip;
    $('#clip-btn').classList.add('rec-on');
    toast(t('clip.saved', { s: clip.seconds }), 6000);
  }
  const blobToDataUrl = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });

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

  // ---------- chamada em segundo plano ----------
  // Ao trocar de app ou de aba, o celular tende a pausar áudio, cortar o microfone e
  // derrubar a conexão. Três cuidados: um áudio silencioso em loop mantém a sessão de
  // áudio viva; a Media Session mostra a chamada nos controles do sistema; e na volta
  // o microfone e os alto-falantes são retomados (ou pedidos de novo, se o sistema cortou).
  let keepAlive = null;
  let micMutedSince = 0;
  function silentWav() { // 1 segundo de silêncio (8 kHz, mono, 8 bits)
    const rate = 8000; const n = rate;
    const buf = new ArrayBuffer(44 + n); const v = new DataView(buf);
    const str = (o, txt) => { for (let i = 0; i < txt.length; i++) v.setUint8(o + i, txt.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function keepAliveStart() {
    if (keepAlive) { keepAlivePlay(); return; }
    try {
      const el = new Audio(silentWav());
      el.loop = true; el.volume = 0.01; el.setAttribute('playsinline', '');
      // o sistema pausa esse áudio ao ligar o microfone ou ao trocar a saída de som: liga de novo
      el.addEventListener('pause', () => { if (keepAlive === el && (state.room || state.searching)) setTimeout(keepAlivePlay, 300); });
      keepAlive = el;
      keepAlivePlay();
    } catch (_) { keepAlive = null; }
  }
  function keepAlivePlay() { if (keepAlive && keepAlive.paused) keepAlive.play().catch(() => {}); }
  function keepAliveStop() {
    if (!keepAlive) return;
    const el = keepAlive; keepAlive = null;
    try { el.pause(); el.src = ''; } catch (_) {}
  }

  // tela ligada durante a chamada: se ela apaga sozinha, o celular pode cortar o microfone
  let wakeLock = null;
  // Plano B para a tela: um vídeo minúsculo em loop (o que apps de chamada usam quando o
  // navegador não tem Wake Lock, caso do iPhone antigo). Precisa começar num toque.
  let awakeVideo = null;
  function awakeVideoStart() {
    try {
      if (!awakeVideo) {
        awakeVideo = document.createElement('video');
        awakeVideo.src = 'media/awake.mp4';
        awakeVideo.loop = true; awakeVideo.setAttribute('playsinline', ''); awakeVideo.setAttribute('title', 'keep awake');
        awakeVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;right:0';
        document.body.appendChild(awakeVideo);
      }
      awakeVideo.play().catch(() => {});
    } catch (_) {}
  }
  function awakeVideoStop() { if (awakeVideo) { try { awakeVideo.pause(); } catch (_) {} } }
  async function wakeLockOn() {
    if (!(state.room || state.searching) || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator)) { awakeVideoStart(); return; }
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
      awakeVideoStop(); // o navegador segura a tela: o vídeo não precisa tocar
    } catch (_) { wakeLock = null; awakeVideoStart(); }
  }
  function wakeLockOff() {
    awakeVideoStop();
    if (!wakeLock) return;
    const w = wakeLock; wakeLock = null;
    try { w.release().catch(() => {}); } catch (_) {}
  }

  // ---------- sons de entrada e saída ----------
  function ensureAudioCtx() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (_) {}
    return audioCtx;
  }
  function playTone(kind) {
    const ctx = ensureAudioCtx();
    if (!ctx) return;
    const notes = kind === 'join' ? [523, 784] : [784, 523];
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((freq, i) => {
      try {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        const start = t0 + i * 0.13;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start); osc.stop(start + 0.13);
      } catch (_) {}
    });
  }
  function mediaSessionStart(room) {
    if (!('mediaSession' in navigator)) return;
    try {
      const g = gameById(room.gameId) || { name: room.gameName };
      navigator.mediaSession.metadata = new MediaMetadata({ title: t('bg.title', { game: g.name }), artist: 'Game Together', artwork: g.cover ? [{ src: new URL(coverOf(g), location.href).href, sizes: '512x512', type: 'image/jpeg' }] : [] });
      navigator.mediaSession.playbackState = 'playing';
      const keep = () => { try { navigator.mediaSession.playbackState = 'playing'; } catch (_) {} };
      for (const a of ['play', 'pause']) { try { navigator.mediaSession.setActionHandler(a, keep); } catch (_) {} }
      try { navigator.mediaSession.setActionHandler('hangup', () => leaveRoom()); } catch (_) {}
      try { navigator.mediaSession.setActionHandler('togglemicrophone', toggleMute); } catch (_) {}
    } catch (_) {}
  }
  function mediaSessionStop() {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } catch (_) {}
    for (const a of ['play', 'pause', 'hangup', 'togglemicrophone']) { try { navigator.mediaSession.setActionHandler(a, null); } catch (_) {} }
  }
  function watchMic(stream) {
    const tr = stream.getAudioTracks()[0];
    if (!tr) return;
    micMutedSince = tr.muted ? Date.now() : 0;
    tr.onmute = () => { micMutedSince = Date.now(); };
    tr.onunmute = () => { micMutedSince = 0; };
    tr.onended = () => { if (document.visibilityState === 'visible') recoverMic(); };
  }
  let micRecovering = false;
  async function recoverMic() {
    const old = state.localStream;
    if (!state.room || !old || micRecovering) return;
    const tr = old.getAudioTracks()[0];
    const dead = !tr || tr.readyState === 'ended' || (tr.muted && micMutedSince && Date.now() - micMutedSince > 3000);
    if (!dead) return;
    micRecovering = true;
    try {
      state.localStream = null;
      const fresh = await getMic();
      const track = fresh.getAudioTracks()[0];
      track.enabled = !state.muted;
      for (const p of state.peers.values()) {
        const sender = p.pc.getSenders().find((x) => x.track && x.track.kind === 'audio') || p.pc.getSenders()[0];
        if (sender) await sender.replaceTrack(track).catch(() => {});
      }
      for (const x of old.getTracks()) { try { x.stop(); } catch (_) {} }
      if (localMeter) { localMeter.stop(); localMeter = null; }
      monitorLocalLevel();
      if (rec.ctx) {
        const src = rec.sources.get('me');
        if (src) { try { src.disconnect(); } catch (_) {} rec.sources.delete('me'); }
        recAdd('me', fresh);
      }
    } catch (_) { if (!state.localStream) state.localStream = old; }
    micRecovering = false;
  }
  function resumeAudio() {
    if (!state.room) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    for (const p of state.peers.values()) if (p.audio && p.audio.paused && p.audio.srcObject) p.audio.play().catch(() => {});
    keepAlivePlay();
    wakeLockOn();
    recoverMic();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') resumeAudio(); });
  window.addEventListener('pageshow', resumeAudio);
  window.addEventListener('focus', resumeAudio);
  setInterval(() => { if (state.room && document.visibilityState === 'visible') resumeAudio(); }, 5000);

  // ---------- chat da chamada ----------
  // a mesma conversa aparece na caixa da tela da chamada e na aba Chat do painel
  function addChat({ name, text, sys }) {
    for (const log of [$('#chat-log'), $('#panel-chat-log')]) {
      const div = document.createElement('div');
      div.className = 'msg' + (sys ? ' sys' : '');
      div.innerHTML = sys ? escapeHtml(text) : `<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
    }
  }
  function sendChat(input) {
    const text = input.value.trim();
    if (!text || !state.room) return;
    socket.emit('chat', text);
    input.value = '';
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
  if (typeof io === 'undefined') {
    // o script do Socket.IO não veio (servidor dormindo, página guardada de antes): avisa e recarrega quando ele responder
    const el = document.getElementById('waking'); if (el) el.hidden = false;
    const tryAgain = () => fetch('/api/version', { cache: 'no-store' }).then((r) => { if (r.ok) location.reload(); else setTimeout(tryAgain, 5000); }).catch(() => setTimeout(tryAgain, 5000));
    setTimeout(tryAgain, 3000);
    return;
  }
  const socket = io({ transports: ['websocket', 'polling'] });
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { window.__gtSocket = socket; window.__gtState = state; } // só para testes locais
  socket.on('version', onServerVersion);

  socket.on('stats', renderStats);
  socket.on('matched', ({ room, you, initiateWith }) => enterRoom(room, you, initiateWith));
  socket.on('peer-joined', ({ room, peer, rejoining }) => {
    if (!state.room) return;
    state.room = room;
    renderRoom();
    rememberPeople(room);
    if (!rejoining) {
      playTone('join');
      toast(t('toast.joined', { name: peer.name }));
      addChat({ sys: true, text: t('toast.joined', { name: peer.name }) });
    }
    connectPeer(peer, false);
  });
  socket.on('peer-left', ({ room, peerId, rejoining }) => {
    if (!state.room) return;
    const gone = state.peers.get(peerId);
    const name = gone ? gone.name : '?';
    removePeer(peerId);
    state.room = room;
    renderRoom();
    if (rejoining) return;
    playTone('leave');
    toast(t('toast.left', { name }));
    addChat({ sys: true, text: t('toast.left', { name }) });
  });
  socket.on('peer-away', ({ peerId }) => { // caiu, mas tem um minuto para voltar
    const peer = state.peers.get(peerId);
    if (!peer) return;
    peer.connected = false;
    const li = document.querySelector(`.member[data-id="${peerId}"]`);
    if (li) li.classList.add('connecting');
  });
  socket.on('signal', onSignal);
  socket.on('chat', (m) => {
    addChat(m);
    // minimizada: a mensagem aparece como aviso, já que o chat não está na tela
    if (state.room && !$('#screen-room').classList.contains('active') && m.from !== state.me) toast(`${m.name}: ${m.text}`, 4000);
  });
  socket.on('room-update', ({ room }) => { if (state.room && room && room.id === state.room.id) { state.room = room; rememberPeople(room); renderRoom(); } });
  socket.on('profile', (p) => { setProfile(p); maybeReupload(); });
  socket.on('token', ({ token }) => { if (token && state.token) { state.token = token; store.set('gt:token', token); } });
  socket.on('banned', (ban) => setBan(ban || { until: null, reason: '' }));
  socket.on('unbanned', () => { setBan(null); toast(t('ban.over'), 5000); showScreen('screen-home'); });

  // conta
  socket.on('login-request', onLoginRequest);
  socket.on('login-requests', ({ requests }) => setRequests(requests));
  socket.on('login-requests-changed', refreshRequests);
  socket.on('not-logged-in', () => { if (state.token) recoverSession(); });
  socket.on('social', setSocial);
  socket.on('announce', (a) => {
    if (!a || a.clear) { $('#announce-banner').hidden = true; return; }
    $('#announce-text').textContent = a.text;
    $('#announce-banner').hidden = false;
    if (state.room) addChat({ sys: true, text: `${t('announce.title')} ${a.text}` });
    toast(`${t('announce.title')} ${a.text}`, 8000);
  });
  socket.on('dm', onDm);
  socket.on('friend-request', ({ from, name }) => toast(t('friends.requestToast', { name }), 20000, [
    { label: t('friends.accept'), primary: true, onClick: () => socket.emit('friend-accept', { from }) },
    { label: t('friends.decline'), onClick: () => socket.emit('friend-decline', { from }) },
  ]));
  socket.on('friend-accepted', ({ name }) => toast(t('friends.accepted', { name })));
  socket.on('invite', (inv) => toast(t('invite.toast', { name: inv.name }), 30000, [
    { label: t('invite.accept'), primary: true, onClick: () => acceptInvite(inv.id) },
    { label: t('invite.decline'), onClick: () => socket.emit('invite-decline', { id: inv.id }) },
  ]));
  socket.on('invite-declined', ({ name }) => toast(t('invite.declined', { name })));
  socket.on('account-deleted', () => { if (state.token) logout({ reason: 'auth.deleted' }); });
  socket.on('claim-update', ({ requestId, status }) => {
    if (requestId !== state.pendingId) return;
    if (status === 'approved') checkPending();
    else if (status === 'denied') failPending();
  });

  socket.on('disconnect', () => {
    if (state.room || state.searching) toast(t('toast.disconnected'), 5000);
  });
  socket.io.on('reconnect', () => {
    sendHello();
    if (state.room) {
      // volta para a mesma sala: o servidor segurou o lugar por um minuto
      const roomId = state.room.id;
      for (const id of [...state.peers.keys()]) removePeer(id);
      renderRoom();
      socket.emit('rejoin', { roomId }, (res) => {
        if (res && res.ok) return;
        leaveRoom({ silent: true });
        toast(t('toast.callLost'), 6000);
      });
    }
    if (state.searching) { state.searching = false; showScreen('screen-setup'); }
    if (state.pendingId) socket.emit('watch-claim', { requestId: state.pendingId });
    toast(t('toast.reconnected'));
  });

  // ---------- eventos da interface ----------
  $('#auth-form').addEventListener('submit', onAuthSubmit);
  $('#login-btn').addEventListener('click', () => askNickname(null));
  $('#auth-back').addEventListener('click', () => { state.afterAuth = null; $('#auth-why').hidden = true; showScreen(state.game ? 'screen-setup' : 'screen-home'); });
  $('#pending-cancel').addEventListener('click', cancelPending);
  $('#logout-btn').addEventListener('click', confirmLogout);
  $('#dm-back').addEventListener('click', closeDm);
  $('#avatar-btn').addEventListener('click', () => { const p = $('#avatar-picker'); p.hidden = !p.hidden; $('#rename-form').hidden = true; renderProfile(); });
  $('#rename-btn').addEventListener('click', () => { const f = $('#rename-form'); f.hidden = !f.hidden; $('#avatar-picker').hidden = true; $('#rename-input').value = state.name; if (!f.hidden) $('#rename-input').focus(); });
  $('#rename-cancel').addEventListener('click', () => { $('#rename-form').hidden = true; });
  $('#rename-form').addEventListener('submit', (e) => { e.preventDefault(); renameAccount($('#rename-input').value.trim()); });
  $('#avatar-none').addEventListener('click', () => chooseCover(null));
  $('#report-form').addEventListener('submit', sendReport);
  $('#report-cancel').addEventListener('click', closeReport);
  $('#report-clip-rm').addEventListener('click', () => { $('#report-clip').hidden = true; });
  $('#report-audio').addEventListener('change', (e) => { pickReportAudio(e.target.files[0]); e.target.value = ''; });
  $('#clip-btn').addEventListener('click', saveClip);
  $('#report-file').addEventListener('change', (e) => { pickReportImage(e.target.files[0]); e.target.value = ''; });
  $('#avatar-file').addEventListener('change', (e) => { uploadAvatar(e.target.files[0]); e.target.value = ''; });
  $('#dm-call').addEventListener('click', () => { if (state.dmWith) callFriend(state.dmWith); });
  $('#dm-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#dm-input');
    const text = input.value.trim();
    if (!text || !state.dmWith) return;
    socket.emit('dm', { to: state.dmWith, text }, (r) => { if (r && r.error) toast(t(`err.${r.error}`)); });
    input.value = '';
  });
  $('#setup-form').addEventListener('submit', onMatchmake);
  $('#setup-back').addEventListener('click', () => { state.game = null; showScreen('screen-home'); });
  $('#brand-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.searching) cancelSearch();
    state.game = null;
    if (state.room) { minimizeCall(); return; } // a chamada continua, minimizada
    showScreen('screen-home');
  });
  $('#mini-open').addEventListener('click', restoreCall);
  $('#mini-back').addEventListener('click', restoreCall);
  $('#mini-mute').addEventListener('click', () => { toggleMute(); renderMini(); });
  $('#mini-leave').addEventListener('click', () => leaveRoom());
  $('#cancel-btn').addEventListener('click', cancelSearch);
  $('#mute-btn').addEventListener('click', toggleMute);
  $('#leave-btn').addEventListener('click', () => leaveRoom());
  $('#report-by-name').addEventListener('submit', (e) => { e.preventDefault(); reportByName($('#report-name-input').value); });
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('#chat-input')); });
  $('#panel-chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat($('#panel-chat-input')); });
  $('#update-btn').addEventListener('click', reloadApp);
  $('#announce-close').addEventListener('click', () => { $('#announce-banner').hidden = true; });
  $('#direct-form').addEventListener('submit', (e) => { e.preventDefault(); openDirect($('#direct-input').value); });
  $('#share-link').addEventListener('click', copySiteLink);
  $('#game-search').addEventListener('input', filterGames);
  $('#panel-btn').addEventListener('click', () => openPanel(state.requests.length ? 'logins' : (state.social.requests.length || unreadTotal()) ? 'friends' : state.panelTab));
  $('#panel-close').addEventListener('click', closePanel);
  $('#panel-backdrop').addEventListener('click', closePanel);
  $$('#panel-tabs .tab').forEach((b) => b.addEventListener('click', () => setPanelTab(b.dataset.tab)));
  $$('#ui-lang-switch button').forEach((b) => b.addEventListener('click', () => setUiLang(b.dataset.lang)));
  window.addEventListener('beforeunload', () => { if (state.room) socket.emit('leave'); });

  // ---------- boot ----------
  // Depois da primeira visita o navegador guarda a página (PWA) e a mostra mesmo com o
  // servidor dormindo. Se a configuração não vier, mostra "acordando" e tenta de novo.
  function showWaking(on) {
    const el = $('#waking');
    if (el) el.hidden = !on;
  }
  let bootTries = 0;
  function boot() {
  fetch('/api/config', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error('config ' + r.status); return r.json(); })
    .then(async (cfg) => {
      showWaking(false);
      state.config = cfg;
      loadedVersion = { version: cfg.version, build: cfg.build };
      $('#about-games').textContent = cfg.games.map((g) => g.name).join(', ') + '.';
      renderHeroCovers();
      $('#share-host').textContent = location.host;
      setUiLang(detectLang());
      setPanelTab('reports');
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
          // depois de uma recuperação o servidor devolve o nome em minúsculas: mantém as maiúsculas guardadas
          setUser(name && name.toLowerCase() === String(me.name).toLowerCase() ? name : me.name, token);
          setProfile({ name: me.name, avatar: me.avatar, avatarKind: me.avatarKind, title: me.title });
          setRequests(me.pending);
          showScreen('screen-home');
          if (me.ban) setBan(me.ban);
          return;
        } catch (err) {
          if (err.message === 'not_logged_in') {
            // conta não reconhecida (servidor reiniciou sem o segredo?): entra de novo com o mesmo nickname
            try {
              const r = await api('/api/claim', { method: 'POST', body: { name } });
              if (r.status === 'pending') { setUser('', null); startPending(r.requestId, r.name); return; }
              setUser(r.name, r.token);
              showScreen('screen-home');
              return;
            } catch (_) { setUser('', null); }
          } else { renderUser(); showScreen('screen-home'); return; }
        }
      }
      renderUser();
      showScreen('screen-home');
    })
    .catch((err) => {
      console.error('boot', err);
      bootTries += 1;
      showWaking(true);
      setTimeout(boot, bootTries < 12 ? 5000 : 15000);
    });
  }
  boot();
})();
