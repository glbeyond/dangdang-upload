/* FEST7 库位查询 · Service Worker（模板；build.js 写入版本号和预缓存列表后生成 dist/sw.js）
   作用范围：只限本目录（注册时 scope './'），不影响仓库根目录的其他应用。
   - 页面外壳（index.html、manifest、图标）：版本化缓存，离线也能打开。
   - 扫码引擎 zxing-wasm（CDN，版本锁定 3.1.6）：首次成功下载后放入运行时缓存。
   - data.json：Service Worker 完全不处理（直接走网络，不缓存、不兜底）。
     离线时由页面自己的本机缓存兜底，并显示红色「本机缓存」警告。 */
'use strict';
var BUILD = "e83d12368afc";
var PREFIX = 'fest7-kw-';
var SHELL_CACHE = PREFIX + 'shell-' + BUILD;
var CDN_CACHE = PREFIX + 'zxing-3.1.6';
var SHELL = ["./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/apple-touch-icon-180.png","./icons/favicon-32.png"];
var CDN_PREFIXES = ['https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.6/', 'https://unpkg.com/zxing-wasm@3.1.6/'];

function scopeUrl(rel) { return new URL(rel, self.registration.scope).href; }
function isData(url) { return /\/data\.json$/.test(url.pathname); }
function isCdn(href) { return CDN_PREFIXES.some(function (p) { return href.indexOf(p) === 0; }); }

self.addEventListener('install', function (e) {
  // 不自动 skipWaiting：已有旧版本在用时，由页面横幅「有新版本，点此更新」触发
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf(PREFIX) === 0 && k !== SHELL_CACHE && k !== CDN_CACHE;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'GET_VERSION' && e.source) e.source.postMessage({ type: 'VERSION', build: BUILD });
});

function shellResponse(req) {
  return caches.open(SHELL_CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      });
    });
  });
}

function navResponse(req) {
  var index = scopeUrl('./index.html');
  return caches.open(SHELL_CACHE).then(function (c) {
    return c.match(index).then(function (hit) {
      return hit || fetch(req);
    });
  });
}

function cdnResponse(req) {
  return caches.open(CDN_CACHE).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      // 用 CORS 方式取，得到可检查状态的响应再缓存（不缓存 opaque / 出错的响应）
      return fetch(req.url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
        if (res && res.ok) c.put(req.url, res.clone());
        return res;
      }, function () { return fetch(req); });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isData(url)) return;                       // data.json：不拦截，浏览器直接请求网络
  if (url.origin === self.location.origin) {
    if (url.href.indexOf(self.registration.scope) !== 0) return; // 本目录以外：不管
    if (req.mode === 'navigate') {
      var p = url.pathname, sp = new URL(self.registration.scope).pathname;
      if (p === sp || p === sp + 'index.html') return e.respondWith(navResponse(req));
      return;
    }
    if (SHELL.some(function (u) { return scopeUrl(u) === url.origin + url.pathname; })) return e.respondWith(shellResponse(req));
    return;
  }
  if (isCdn(req.url)) return e.respondWith(cdnResponse(req));
});
