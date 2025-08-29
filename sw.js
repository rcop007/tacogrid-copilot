const CACHE = 'tg-pages-v1';
const CORE = [
  './','./index.html','./styles.css','./app.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  './assets/rest_areas.json'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CORE.includes?CACHE:'tg').then(c=>c.addAll(CORE)));
});
self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE).map(k=> caches.delete(k)))));
});
self.addEventListener('fetch', e=>{
  e.respondWith(
    caches.match(e.request).then(hit=> hit || fetch(e.request).then(net=>{
      const copy=net.clone(); caches.open(CACHE).then(c=> c.put(e.request, copy)); return net;
    }).catch(()=> hit))
  );
});
