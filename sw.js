// 앱 데이터가 index.html에 전부 내장되어 있어 캐시만으로 완전 오프라인 동작합니다.
const CACHE = 'lotto645-v12';
const ASSETS = [
  './', './index.html', './privacy.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-192.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 네트워크 우선, 실패 시 캐시 (배포 갱신이 바로 반영되면서 오프라인도 동작)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 성공 응답만 캐싱한다. 상태코드를 안 보면 404/500이 캐시에 눌러앉아
        // 다음 오프라인 접속 때 그 오류 응답이 그대로 재생된다.
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => {
        if (r) return r;
        // index.html 폴백은 페이지 이동에만 적용한다.
        // 이미지·아이콘 요청에 HTML을 돌려주면 깨진 리소스가 된다.
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
