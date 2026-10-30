// The ERP's and the Employee Portal's service worker (owner, 2026-10-30;
// docs/modules/PWA.md, Q332-Q334). It makes both installable and keeps the
// shell on the device; it never touches data.
//   - The pages, styles, manifests and Help (same origin, GET): from the
//     network first, so a deploy shows at once; the copy kept here when the
//     network is slow (over 4 s) or gone. Hosting sends them no-cache, so a
//     network answer is a quick "unchanged" when nothing changed.
//   - Font Awesome and the Firebase SDK (versioned addresses): from here
//     once fetched.
//   - Everything else, and every request that isn't a GET (the functions,
//     sign-in, Firestore): not touched, always the network.
// Screens are never kept: they come through getModuleFragment, a function
// call (Q332).
const CACHE = 'erp-shell-v1';
const SHELL = ['/', '/ess.html', '/css/erp.css', '/css/ess.css', '/manifest.webmanifest', '/ess.webmanifest',
  '/icons/erp-192.png', '/icons/erp-512.png', '/icons/ess-192.png', '/icons/ess-512.png'];
const VERSIONED = [/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\//, /^https:\/\/www\.gstatic\.com\/firebasejs\/\d/];
const OFFLINE = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>' +
  '<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:1rem;text-align:center}button{margin-top:1rem;padding:.6rem 1.2rem;border:0;border-radius:.5rem;background:#2563eb;color:#fff;font-size:1rem}</style></head>' +
  '<body><div><h1 style="font-size:1.25rem">You\'re offline</h1><p>Connect to the internet to use the app. Nothing is saved without a connection.</p><button onclick="location.reload()">Try again</button></div></body></html>';

self.addEventListener('install', e => {
  // One missing file never stops the worker installing.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const isShell = url => url.origin === self.location.origin &&
  (url.pathname === '/' || /\.(html|css|webmanifest)$/.test(url.pathname) || url.pathname.startsWith('/help/') || url.pathname.startsWith('/icons/'));

// The network first, the kept copy if it is slow or fails, else the offline page (for a page).
async function networkFirst(req, page) {
  const cache = await caches.open(CACHE);
  const kept = () => cache.match(req, { ignoreSearch: page }).then(r => r || (page ? new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : Response.error()));
  const net = fetch(req).then(res => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; });
  net.catch(() => {}); // a late failure after the kept copy answered is nobody's error
  const slow = new Promise(resolve => setTimeout(() => resolve('slow'), 4000));
  try {
    const first = await Promise.race([net, slow]);
    return first === 'slow' ? ((await cache.match(req, { ignoreSearch: page })) || net) : first;
  } catch (err) {
    return kept();
  }
}
async function keptFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' || isShell(url)) e.respondWith(networkFirst(req, req.mode === 'navigate'));
  else if (VERSIONED.some(re => re.test(req.url))) e.respondWith(keptFirst(req));
});
