self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('scuteswarm-cache-v1').then(cache => {
      return cache.addAll([
        '/',
        '/static/img/lands.jpg',
        '/static/img/scuteswarm.jpg',
        '/static/img/scuteswarm.png',
        '/static/manifest.json'
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
