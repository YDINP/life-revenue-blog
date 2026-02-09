const CACHE_NAME = 'lifeflow-v1';
const PRE_CACHE_URLS = ['/', '/blog/'];

// Install: 사전 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRE_CACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate: 구 캐시 삭제
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: Network-First 전략
self.addEventListener('fetch', (event) => {
  // navigation 및 same-origin 요청만 처리
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 정상 응답이면 캐시에 저장
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 반환
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // 캐시에도 없으면 오프라인 페이지 (navigation 요청만)
          if (event.request.mode === 'navigate') {
            return caches.match('/').then((fallback) => {
              return fallback || new Response('오프라인 상태입니다.', {
                status: 503,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              });
            });
          }
          return new Response('', { status: 503 });
        });
      })
  );
});
