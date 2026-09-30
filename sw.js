importScripts("./offline-data.js");

const SCOPE = self.registration.scope;
const SHELL_PREFIX = `daily-duas-shell:${SCOPE}:`;
const SHELL_CACHE = `${SHELL_PREFIX}v1`;
const FONT_CACHE = `daily-duas-fonts:${SCOPE}`;
const SHELL_FILES = ["./", "index.html", "offline-data.js", "icon.png"];
const FONT_CSS = "https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@500;600;700&family=Sora:wght@400;500;600;700&display=swap";

async function warmFonts() {
  try {
    const cache = await caches.open(FONT_CACHE);
    const response = await fetch(FONT_CSS, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return;
    const css = await response.clone().text();
    await cache.put(FONT_CSS, response);
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)]
      .map((match) => match[1]);
    await Promise.allSettled([...new Set(urls)].map(async (url) => {
      const font = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (font.ok) await cache.put(url, font);
    }));
  } catch {
    // Fonts are optional; system fonts still allow offline reading.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES.map((path) => new Request(new URL(path, SCOPE), { cache: "reload" })));
    // A failed JSON download must never replace previously saved data.
    try { await DailyDuasOffline.download(); } catch { /* Retry from the page. */ }
    await warmFonts();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function navigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(request, { cache: "no-cache", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await cache.put(new URL("index.html", SCOPE).href, response.clone());
    return response;
  } catch {
    const saved = await cache.match(new URL("index.html", SCOPE).href);
    return saved || Response.error();
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.href.startsWith(SCOPE)) {
    if (url.pathname === new URL(DailyDuasOffline.url).pathname) {
      // The page owns JSON refresh and validation. Explicit refreshes must not
      // silently return stale data as if an online update had succeeded.
      if (request.cache === "no-store") return;
      event.respondWith((async () => {
        const cache = await caches.open(DailyDuasOffline.cacheName);
        return (await cache.match(DailyDuasOffline.url)) || fetch(request);
      })());
    } else if (request.mode === "navigate") {
      event.respondWith(navigation(request));
    } else if (SHELL_FILES.some((path) => new URL(path, SCOPE).pathname === url.pathname)) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
  }
});
