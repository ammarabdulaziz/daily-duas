/* Shared by the page and service worker so validation and cache keys agree. */
(() => {
  const scope = globalThis.registration
    ? globalThis.registration.scope
    : new URL("./", document.baseURI).href;
  const url = new URL("duas.json", scope).href;
  // Keep data independent of shell versions. JSON-only edits need no SW change.
  const cacheName = `daily-duas-data:${scope}`;

  function validate(payload) {
    if (!Array.isArray(payload) || payload.length === 0 || !payload.every((dua) =>
      dua && typeof dua === "object" && !Array.isArray(dua) &&
      typeof dua.title === "string" && dua.title.trim() &&
      typeof dua.arabic_text === "string" && dua.arabic_text.trim()
    )) {
      throw new Error("The dua download is invalid. Your saved duas have been kept.");
    }
    return payload;
  }

  async function read() {
    try {
      const cache = await caches.open(cacheName);
      const response = await cache.match(url);
      return response ? validate(await response.json()) : null;
    } catch {
      return null;
    }
  }

  async function download() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      // A no-store request passes through the worker to the network.
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = validate(await response.clone().json());
      let saved = false;
      try {
        const cache = await caches.open(cacheName);
        await cache.put(url, response);
        saved = true;
      } catch {
        // Storage restrictions should not prevent online reading.
      }
      return { payload, saved };
    } finally {
      clearTimeout(timeout);
    }
  }

  globalThis.DailyDuasOffline = Object.freeze({ url, cacheName, validate, read, download });
})();
