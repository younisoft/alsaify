/* DARK-CLOUD service worker — build __BUILD_ID__
 * Security policy:
 *  - Caches ONLY the public application shell (HTML, JS, CSS, icons, fonts). These contain no user data.
 *  - NEVER touches Firebase / Google API traffic (Firestore, Cloud Functions, Auth, Storage):
 *    those requests are not intercepted at all, so financial data, tokens and API responses are never stored here.
 *  - Never caches non-GET requests. Writes therefore cannot be queued offline or "succeed" offline.
 */
const VERSION = '__BUILD_ID__';
const SHELL = `dc-shell-${VERSION}`;
const RUNTIME = `dc-static-${VERSION}`;
const PRECACHE = __PRECACHE__;
const PUBLIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
  // do not skipWaiting automatically: the page asks the user before switching versions
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // writes always go straight to the network
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !PUBLIC_HOSTS.includes(url.hostname)) return;   // Firebase/Google APIs: not intercepted
  if (sameOrigin && (url.pathname.startsWith('/__/') || url.pathname.startsWith('/api'))) return; // Firebase reserved paths

  if (req.mode === 'navigate') {
    // network first so a fresh deploy is picked up; offline falls back to the cached shell (contains no data)
    e.respondWith(fetch(req).catch(async () => (await caches.match('/index.html')) || Response.error()));
    return;
  }
  // static assets: hashed file names → cache first
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    // Hosts with an SPA fallback (Cloudflare Pages, Firebase Hosting) answer a missing file with index.html + 200.
    // Only cache when the content type really matches the file, so an HTML fallback is never stored as JS/CSS.
    const ct = res.headers.get('content-type') || '';
    const typeOk = /\.js$/.test(url.pathname) ? /javascript/.test(ct) : /\.css$/.test(url.pathname) ? /text\/css/.test(ct) : !/text\/html/.test(ct);
    if (res.ok && typeOk && (res.type === 'basic' || res.type === 'cors') && /\.(js|css|png|svg|webp|woff2?|ttf|webmanifest)$|fonts\.googleapis\.com/.test(url.href))
      (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  })());
});
