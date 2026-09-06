const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { IDBFactory } = require("fake-indexeddb");
const source = fs.readFileSync(path.join(__dirname, "..", "video-cache.js"), "utf8");

async function run(useIndexedDB) {
  const storage = {};
  const indexedDB = useIndexedDB ? new IDBFactory() : undefined;
  let now = Date.now();
  function context() {
    const c = vm.createContext({ TextEncoder, indexedDB, Date: class extends Date { static now() { return now; } },
      browser: { storage: { local: {
        async get(key) { return structuredClone({ [key]: storage[key] }); },
        async set(values) { Object.assign(storage, structuredClone(values)); }
      } } }
    });
    vm.runInContext(source, c);
    return c.DualSubVideoCache;
  }
  const scope = { videoId: "one", sourceLanguage: "fr", targetLanguage: "en", provider: "google", sourceTrack: "fr-asr", targetTrack: "en" };
  const sourceCues = [{ start: 1000, end: 2000, text: "Bonjour", fragments: [{ start: 1000, end: 2000, text: "Bonjour", append: false }] }, { start: 2100, end: 3000, text: "Merci" }];
  let cache = context();
  assert.equal(await cache.get(scope), null);
  await cache.save(scope, { sourceCues, targetCues: [], capturedAt: now, translations: [{ index: 0, text: "Hello", alignmentKind: "character", alignment: [{ sourceStart: 0, sourceEnd: 6, targetStart: 0, targetEnd: 4 }] }] });
  cache = context(); // A new background instance must restore persisted data.
  const restored = await cache.get(scope);
  assert.equal(restored.sourceCues[0].fragments[0].start, 1000);
  assert.equal(restored.translations[0].text, "Hello");
  assert.equal(restored.translations[0].alignmentKind, "character");
  for (const change of [{ videoId: "two" }, { provider: "deepl" }, { sourceTrack: "fr-manual" }, { targetLanguage: "de" }, { endpoint: "https://another-server.test" }]) {
    assert.equal(await cache.get({ ...scope, ...change }), null);
  }
  await Promise.all([
    cache.save(scope, { sourceCues, targetCues: [], translations: [{ index: 0, text: "Hello" }] }),
    cache.save(scope, { sourceCues, targetCues: [], translations: [{ index: 1, text: "Thanks" }] })
  ]);
  assert.equal((await cache.get(scope)).translations.length, 2, "Disjoint translated portions merge without loss");
  await cache.save(scope, { sourceCues: [{ start: 1000, end: 2000, text: "Salut" }], targetCues: [], translations: [] });
  assert.equal((await cache.get(scope)).translations.length, 0, "Changed captions invalidate index-based translations");
  const targetCues = [{ start: 1000, end: 2000, text: "Hello" }];
  await cache.save(scope, { sourceCues, targetCues, translations: [] });
  await cache.save(scope, { sourceCues, targetCues: [], translations: [] });
  assert.equal((await cache.get(scope)).targetCues[0].text, "Hello", "Partial snapshots do not erase a complete English track");
  now += 31 * 86400000;
  assert.equal(await cache.get(scope), null, "Old caption snapshots expire");
  for (let index = 0; index < 31; index++) await cache.save({ ...scope, videoId: String(index) }, { sourceCues, targetCues, translations: [] });
  assert.equal(await cache.get(scope), null);
  let count = 0;
  for (let index = 0; index < 31; index++) if (await cache.get({ ...scope, videoId: String(index) })) count++;
  assert.equal(count, 30, "The cache retains at most 30 videos");
  await cache.clear();
  assert.equal(await cache.get({ ...scope, videoId: "30" }), null);
  await assert.rejects(cache.save(scope, { sourceCues: [{ start: 5, end: 1, text: "bad" }], targetCues: [] }), /Invalid/);
}

(async () => { await run(true); await run(false); console.log("Video cache tests passed (IndexedDB and fallback)"); })()
  .catch((error) => { console.error(error); process.exitCode = 1; });
