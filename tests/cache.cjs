const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const assert = require('node:assert/strict');
const original = JSON.parse(fs.readFileSync(path.join(root, 'duas.json'), 'utf8'));
const stores = new Map();
let response = new Response(JSON.stringify(original));
let failed = false;
const context = vm.createContext({
  URL, Response, AbortController, setTimeout, clearTimeout,
  document: { baseURI: 'https://ammarabdulaziz.github.io/daily-duas/' },
  caches: { async open(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return { async match(key) { return store.get(key)?.clone(); }, async put(key, value) { store.set(key, value.clone()); } };
  } },
  async fetch(url, options) {
    assert.equal(url, 'https://ammarabdulaziz.github.io/daily-duas/duas.json');
    assert.equal(options.cache, 'no-store');
    if (failed) throw new Error('Network unavailable');
    return response.clone();
  },
});
vm.runInContext(fs.readFileSync(path.join(root, 'offline-data.js'), 'utf8'), context);
const api = context.DailyDuasOffline;
(async () => {
  assert.equal(await api.read(), null);
  assert.equal((await api.download()).saved, true);
  assert.equal((await api.read()).length, original.length);
  failed = true;
  await assert.rejects(api.download());
  assert.equal((await api.read()).length, original.length);
  failed = false;
  for (const invalid of ['{bad JSON', '[]', '[null]', '[{"title":"Missing Arabic"}]']) {
    response = new Response(invalid);
    await assert.rejects(api.download());
    assert.equal((await api.read()).length, original.length);
  }
  response = new Response('Server unavailable', { status: 503 });
  await assert.rejects(api.download());
  assert.equal((await api.read()).length, original.length);
  response = new Response(JSON.stringify([...original, {...original[0], id: 99}]));
  await api.download();
  assert.equal((await api.read()).length, original.length + 1);
  console.log('PASS: cache miss, initial save, offline fallback, malformed JSON, invalid entries, HTTP errors, and new dua persistence');
})().catch(error => { console.error(error); process.exitCode = 1; });
