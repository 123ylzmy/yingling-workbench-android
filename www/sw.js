// 自洽日程 Service Worker v4
const CACHE_NAME = 'yl-workbench-v5';
const ASSETS = [
  '/',
  '/index.html',
  '/index.min.css',
  '/index.min.js',
  '/data.json',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] 缓存核心资源...');
      return cache.addAll(ASSETS).catch(err => {
        // 某些资源可能不存在（如 PNG 图标），不阻塞安装
        console.warn('[SW] 部分资源缓存失败（可忽略）:', err.message);
      });
    }).then(() => {
      console.log('[SW] 安装完成，跳过等待');
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    }).then(() => {
      console.log('[SW] 激活完成');
      return self.clients.claim();
    })
  );
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', event => {
  // 跳过非 GET 请求和 Supabase API 请求
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.includes('/auth/') || url.pathname.includes('/rest/')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 后台更新缓存
        fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response);
            });
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(() => {
        // 离线时返回缓存首页
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
