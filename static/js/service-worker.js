const cacheName = 'mtgtools-studio-v2';
const assets = [
  "/",
  "/mana",
  "/krenko",
  "/animpakal",
  "/valet",
  "/scuteswarm",
  "/import",
  "/static/manifest.json",
  "/static/js/studio.js",
  "/static/img/colorless.png",
  "/static/img/forest.png",
  "/static/img/icon-192.png",
  "/static/img/icon-512.png",
  "/static/img/island.png",
  "/static/img/krenko.jpg",
  "/static/img/lands.jpg",
  "/static/img/mountain.png",
  "/static/img/mtg.ico",
  "/static/img/mtg.png",
  "/static/img/plains.png",
  "/static/img/portals.jpg",
  "/static/img/portals.png",
  "/static/img/portalsbanner.png",
  "/static/img/scuteswarm.png",
  "/static/img/swamp.png",
  "/static/img/valet.jpg",
  "/static/img/valetbutton.jpg",
  "/static/img/valetbutton.png",
  "/static/img/wubrg.png",
  "/static/css/studio.css",
  "/static/css/valet.css",
  "/static/css/krenko.css",
  "/static/css/animpakal.css",
  "/static/css/mana.css"
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key =>
    key === 'scuteswarm-cache-v1' || (key.startsWith('mtgtools-studio-') && key !== cacheName)
  ).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || !assets.includes(url.pathname)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const cached = await cache.match(url.pathname);
    return cached || fetch(event.request);
  }));
});
