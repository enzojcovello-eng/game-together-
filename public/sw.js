/* Service worker do Game Together.
   Guarda os arquivos da interface para o app abrir rápido e ser instalável.
   O matchmaking e a chamada sempre passam pela rede (Socket.IO e WebRTC). */
const CACHE = 'game-together-v3';
// o script do Socket.IO também fica guardado: sem ele a página não abre nem para mostrar "acordando o servidor"
const SHELL = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/i18n.js', '/socket.io/socket.io.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/socket.io/socket.io.js') { /* script do cliente: guarda como os outros */ } else if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api/')) return;
  // rede primeiro; se falhar (servidor dormindo ou sem internet), usa o cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
