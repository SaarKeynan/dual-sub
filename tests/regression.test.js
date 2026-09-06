const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const clone = (value) => structuredClone(value);
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const event = { addListener() {} };

function background(initial = {}) {
  const data = clone(initial);
  const area = {
    async get(keys) { return clone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, data[key]]))); },
    async set(values) { Object.assign(data, clone(values)); }
  };
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, performance, TextEncoder,
    crypto: require("node:crypto").webcrypto,
    browser: { storage: { local: area, sync: area, onChanged: event },
      runtime: { onInstalled: event, onStartup: event, onMessage: event }, commands: { onCommand: event },
      tabs: { async query() { return [{ id: 1 }]; }, async sendMessage() { return { ok: true }; } } }
  });
  for (const file of ["shared/settings.js", "video-cache.js", "background.js", "translation-engine.js"]) vm.runInContext(source(file), context);
  return { data, context };
}

async function storageTests() {
  const { data, context: c } = background();
  await Promise.all([c.addVocabularyEntry({ sourceText: "chat", translatedText: "cat" }), c.addVocabularyEntry({ sourceText: "chien", translatedText: "dog" })]);
  assert.equal(data.vocabulary.length, 2, "Concurrent saves preserve both words");
  const entry = data.vocabulary.find((item) => item.sourceText === "chat");
  await c.updateVocabularyEntry(entry.id, { notes: "My mnemonic" });
  await c.addVocabularyEntry({ sourceText: "chat", translatedText: "cat", sentence: "Un chat", videoId: "first", timeMs: 1000 });
  await c.addVocabularyEntry({ sourceText: "chat", translatedText: "cat", sentence: "Le chat", videoId: "second", timeMs: 2000 });
  assert.equal(data.vocabulary.find((item) => item.id === entry.id).notes, "My mnemonic");
  assert.equal(data.vocabulary.find((item) => item.id === entry.id).contexts.length, 2);
  await Promise.all([c.setWordState("chat", "known"), c.setWordState("chien", "ignored")]);
  assert.equal(Object.keys(data.wordStatesV1).length, 2);
  await assert.rejects(c.addVocabularyEntry({}), /required/);
  await c.updateVocabularyEntry(entry.id, { notes: "Queue still works" });
  const full = Array.from({ length: 2000 }, (_, index) => ({ id: String(index), normalized: `word${index}`, sourceText: `word${index}`, translatedText: "meaning", sourceLanguage: "fr", targetLanguage: "en", notes: "keep", createdAt: index + 1 }));
  data.vocabulary = clone(full);
  await assert.rejects(c.addVocabularyEntry({ sourceText: "extra", translatedText: "extra" }), /full/);
  await assert.rejects(c.importVocabularyEntries([{ sourceText: "extra", translatedText: "extra" }]), /exceeds/);
  assert.deepEqual(data.vocabulary, full, "Capacity failures do not mutate existing data");
  data.vocabulary = [];
  await c.addVocabularyEntry({ sourceText: "vais", translatedText: "go", lemma: "aller", sentence: "Je vais", videoId: "video" });
  await c.saveTranslationCorrection("vais", "go");
  await c.saveVideoProfile("video", { studyMode: "shadow", captionOffsetMs: 250 });
  const backup = await c.exportLearningBackup();
  const restored = background();
  await restored.context.restoreLearningBackup(backup);
  assert.equal(restored.data.vocabulary[0].lemma, "aller");
  assert.equal(restored.data.vocabulary[0].contexts[0].sentence, "Je vais");
  assert.equal(restored.data.wordStatesV1.chat.state, "known");
  assert.equal(restored.data.translationCorrectionsV1["fr|en|vais"].translatedText, "go");
  assert.equal(restored.data.videoProfilesV1.video.captionOffsetMs, 250);
  const before = clone(restored.data);
  await assert.rejects(restored.context.restoreLearningBackup({ ...backup, profiles: { video: { studyMode: "invalid" } } }), /Invalid/);
  assert.deepEqual(restored.data, before, "Invalid restore is atomic");
}

async function translationTests() {
  const memory = background({ settings: { translationProvider: "mymemory" } }).context;
  let fallbackCalls = 0;
  memory.fetch = async (url) => {
    if (String(url).includes("mymemory")) return { ok: true, json: async () => ({
      responseStatus: 200, responseData: { translatedText: "her name is Anna", match: 0.99 },
      matches: [{ segment: "avez", translation: "her name is Anna", quality: "100", match: 0.99 }]
    }) };
    fallbackCalls++;
    return { ok: true, json: async () => [[["have", "avez"]]] };
  };
  const repaired = await memory.translateSelectionWithEngine({ text: "avez", cacheMode: "word" });
  assert.equal(repaired.translatedText, "have");
  assert.equal(repaired.qualityFallback, true);
  const preloaded = await memory.translateBatchMessage({ items: [{ text: "avez", cacheId: "word:avez" }] });
  assert.equal(preloaded.results[0].translatedText, "have", "Preloading applies the same quality checks as clicking");
  assert.equal(fallbackCalls, 1, "The validated fallback is cached");
  assert.equal(memory.DualSubTranslation.suspiciousMyMemoryWordResult("bonjour", "good morning"), false);
  const readingContext = background().context;
  const queries = [];
  readingContext.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q"); queries.push(query);
    return { ok: true, json: async () => [[[query === "tu l'as" ? "you have it" : "the ace"]]] };
  };
  await readingContext.translateSelectionWithEngine({ text: "l'as", cacheMode: "word" });
  const verb = await readingContext.translateSelectionWithEngine({ text: "l'as", lookupText: "tu l'as", readingKey: "verb:avoir:tu l'as", cacheMode: "word" });
  assert.equal(verb.translatedText, "you have it", "A cached noun meaning cannot contaminate the verb reading");
  assert.equal(verb.sourceText, "l'as");
  assert.deepEqual(queries, ["l'as", "tu l'as"]);
  const { context: c } = background();
  let calls = 0;
  c.fetch = async () => { calls++; return { ok: true, json: async () => [[["hello", "bonjour"]]] }; };
  await c.DualSubTranslation.translateBatch([{ text: "bonjour" }]);
  c.fetch = async () => { calls++; return { ok: false, status: 429, headers: { get: () => "60" } }; };
  await assert.rejects(c.DualSubTranslation.translateBatch([{ text: "salut" }]), { code: "PROVIDER_RATE_LIMITED" });
  const cached = await c.DualSubTranslation.translateBatch([{ text: "bonjour" }]);
  assert.equal(cached.results[0].translatedText, "hello");
  assert.equal(cached.results[0].cacheHit, true);
  assert.equal(calls, 2, "Cached lookup does not contact a blocked provider");
  const scope = { videoId: "one", sourceLanguage: "fr", targetLanguage: "en", provider: "google", sourceTrack: "fr", targetTrack: "en" };
  await c.DualSubVideoCache.save(scope, { sourceCues: [{ start: 0, end: 1000, text: "bonjour" }], targetCues: [], translations: [] });
  await c.clearTranslationCaches();
  assert.equal(await c.DualSubVideoCache.get(scope), null);
  assert.equal((await c.DualSubTranslation.cacheStats()).entries, 0);
  const next = background().context;
  next.fetch = async () => { throw new Error("Cancelled work must not fetch"); };
  next.DualSubTranslation.cancelSession("navigation");
  await assert.rejects(next.DualSubTranslation.translateBatch([{ text: "salut" }], { sessionId: "navigation" }), { code: "TRANSLATION_CANCELLED" });
  assert.equal(next.DualSubTranslation.health().failures, 0);
  for (let index = 0; index < 3; index++) {
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    next.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
      started();
    });
    const pending = next.DualSubTranslation.translateBatch([{ text: "bonjour" }], { sessionId: `active-${index}` });
    await ready;
    next.DualSubTranslation.cancelSession(`active-${index}`);
    await assert.rejects(pending, { code: "TRANSLATION_CANCELLED" });
  }
  assert.equal(next.DualSubTranslation.health().failures, 0, "Navigation cancellation never opens the provider circuit");
}

async function sidebarTests() {
  let tabId = 1, delayed;
  const text = source("sidebar/sidebar.js");
  const c = vm.createContext({ console, render() {}, browser: { tabs: {
    query: async () => [{ id: tabId, url: `https://www.youtube.com/watch?v=${tabId}` }],
    sendMessage: async (id, message) => {
      if (id === 3) return new Promise((resolve) => { delayed = resolve; });
      return { ok: true, videoId: String(id), revision: "1:1", cues: message.lastRevision === "1:1" ? null : [{ text: `tab ${id}` }] };
    }
  } } });
  vm.runInContext(text.slice(0, text.indexOf("function unknownWordsInCue")) + text.slice(text.indexOf("async function refresh()"), text.indexOf('element("transcript").addEventListener')), c);
  await c.refresh(); tabId = 2; await c.refresh();
  assert.equal(vm.runInContext("state.cues[0].text", c), "tab 2");
  tabId = 3; const stale = c.refresh(); await new Promise((resolve) => setImmediate(resolve));
  tabId = 4; await c.refresh(); delayed({ ok: true, videoId: "3", cues: [{ text: "stale" }] }); await stale;
  assert.equal(vm.runInContext("state.videoId", c), "4", "Late tab response cannot overwrite current transcript");
}

async function practiceTests() {
  let hidden = false;
  const video = { currentTime: 0, paused: true, async play() { this.paused = false; }, pause() { this.paused = true; } };
  const c = vm.createContext({ console, setTimeout, clearTimeout });
  vm.runInContext(source("shared/practice.js"), c);
  const practice = c.DualSubPractice.createController({ getVideo: () => video, getCues: () => [{ start: 1000, end: 2000, text: "Je vais" }, { start: 2200, end: 3000, text: "bien" }], getOffset: () => 250, hideCaptions: (value) => { hidden = value; }, requestRender() {} });
  await practice.start("dictation", 0, 1);
  assert.equal(video.currentTime, 0.75); assert.equal(hidden, true);
  assert.equal(practice.snapshot().answer, undefined);
  video.currentTime = 2.8; practice.tick(); assert.equal(video.paused, true);
  assert.equal(practice.reveal(), "Je vais bien"); assert.equal(hidden, false);
  const diff = c.DualSubPractice.compareWords("Je vais très bien", "je va bien");
  assert.equal(diff.filter((word) => word.type === "correct").length, 2);
  assert.equal(diff.some((word) => word.type === "missing"), true);
  await practice.start("shadow", 0, 1, 0.01);
  video.currentTime = 3; practice.tick(); practice.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(video.paused, true, "Stopping a waiting loop never resumes the video");
  await assert.rejects(practice.start("shadow", 1, 0), /valid/);
}

(async () => {
  await storageTests(); await translationTests(); await sidebarTests(); await practiceTests();
  console.log("DualSub regression tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
