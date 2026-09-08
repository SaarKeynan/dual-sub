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
    async set(values) { Object.assign(data, clone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
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

async function backupMergeTests() {
  const { data, context: c } = background();
  await c.addVocabularyEntry({ sourceText: "chat", translatedText: "cat", sentence: "Un chat noir", videoId: "recent" });
  const entry = data.vocabulary[0];
  await c.updateVocabularyEntry(entry.id, { notes: "Sounds like shah" });
  await c.reviewVocabularyEntry(entry.id, "good");
  const studied = clone(data.vocabulary[0]);
  assert.equal(studied.reviews, 1, "The word has been studied once locally");

  // Restoring last week's backup must not undo this week's studying.
  await c.restoreLearningBackup({
    version: 2,
    entries: [{
      id: entry.id, sourceText: "chat", translatedText: "cat", sourceLanguage: "fr", targetLanguage: "en",
      sentence: "Le chat dort", videoId: "older", notes: "", stage: 0, reviews: 0,
      reviewIntervalDays: 0, easeFactor: 2.5, dueAt: 0, lastReviewedAt: 0, updatedAt: 1
    }],
    wordStates: {}, corrections: {}, profiles: {}
  });
  const merged = data.vocabulary[0];
  assert.equal(merged.notes, "Sounds like shah", "An empty backup note must not erase a local note");
  assert.equal(merged.reviews, studied.reviews, "An older backup must not reset the review count");
  assert.equal(merged.stage, studied.stage, "An older backup must not reset the review stage");
  assert.equal(merged.dueAt, studied.dueAt, "An older backup must not bring the due date forward");
  assert.equal(merged.contexts.length, 2, "Both example sentences survive the merge");

  // A backup from a device that studied more recently should win instead.
  await c.restoreLearningBackup({
    version: 2,
    entries: [{
      id: entry.id, sourceText: "chat", translatedText: "cat", sourceLanguage: "fr", targetLanguage: "en",
      notes: "Studied elsewhere", stage: 4, reviews: 9, reviewIntervalDays: 21, easeFactor: 2.6,
      dueAt: Date.now() + 86400000, lastReviewedAt: Date.now() + 1000, updatedAt: Date.now() + 1000
    }],
    wordStates: {}, corrections: {}, profiles: {}
  });
  assert.equal(data.vocabulary[0].reviews, 9, "A newer backup carries its review progress forward");
  assert.equal(data.vocabulary[0].notes, "Studied elsewhere");
}

async function palettePaletteTests() {
  const { merge, defaults } = background().context.DualSubSettings;
  const colors = defaults.wordGroupColors;
  // Simulated, the old noun and verb hues were 4 apart on a 441-point scale,
  // so the two groups a learner cares about most looked identical to a
  // deuteranope. Roles a learner does not distinguish now share a colour.
  assert.notEqual(colors.noun, colors.verb, "Noun and verb must not share a colour");
  assert.equal(colors.adjective, colors.adverb, "Modifiers read as one role");
  assert.equal(colors.determiner, colors.pronoun, "Function words read as one role");
  assert.equal(colors.preposition, colors.conjunction);
  assert.notEqual(colors.unknown, colors.determiner, "An unclassified word is not a function word");
  assert.equal(new Set(Object.values(colors)).size, 5, "Ten hues collapse to five roles");

  const legacy = {
    unknown: "#ffffff", noun: "#60a5fa", verb: "#a78bfa", adjective: "#fb7185", adverb: "#facc15",
    pronoun: "#22d3ee", determiner: "#4ade80", preposition: "#fb923c", conjunction: "#f472b6", interjection: "#94a3b8"
  };
  const untouched = merge({ wordGroupPaletteVersion: 2, wordGroupColors: { ...legacy } });
  assert.equal(untouched.wordGroupColors.verb, colors.verb, "A palette the reader never edited is migrated");
  assert.equal(untouched.wordGroupPaletteVersion, 3);

  const customised = merge({ wordGroupPaletteVersion: 2, wordGroupColors: { ...legacy, noun: "#ff0000" } });
  assert.equal(customised.wordGroupColors.noun, "#ff0000", "A chosen colour survives the migration");
  assert.equal(customised.wordGroupColors.verb, "#a78bfa", "and the rest of that palette is left alone");

  // The oldest palette swapped verb and adjective; it should end up on v3 too.
  const ancient = merge({ wordGroupColors: { ...legacy, verb: "#fb7185", adjective: "#c084fc" } });
  assert.equal(ancient.wordGroupColors.verb, colors.verb);
  assert.equal(ancient.wordGroupPaletteVersion, 3);
}

async function learningDataModelTests() {
  const { data, context: c } = background();
  const saved = await c.addVocabularyEntry({ sourceText: "chien", translatedText: "dog" });
  assert.equal(data.wordStatesV1.chien.state, "learning", "Saving a word marks it as being learned");
  // The two models drifted: removal cleared the entry but left the state, so a
  // deleted word still counted toward coverage and still drove smart pausing.
  await c.removeVocabularyEntry(saved.entry.id);
  assert.equal(data.wordStatesV1.chien, undefined, "Removing the entry clears the state it created");

  // A state the reader set deliberately is theirs, not ours to undo.
  const second = await c.addVocabularyEntry({ sourceText: "chat", translatedText: "cat" });
  await c.setWordState("chat", "known");
  await c.removeVocabularyEntry(second.entry.id);
  assert.equal(data.wordStatesV1.chat.state, "known", "A deliberate word state survives removal");
}

async function storageMigrationTests() {
  const { data, context: c } = background({
    lineTranslationCacheV1: { stale: { savedAt: 1, result: {} } },
    vocabulary: [{ id: "1", sourceText: "chat", translatedText: "cat", normalized: "chat" }]
  });
  // Keys carry version numbers but nothing ever removed the superseded ones,
  // so an upgraded profile kept the dead cache in local storage forever.
  await c.migrateStoredData();
  assert.equal(data.lineTranslationCacheV1, undefined, "A superseded cache key is removed on upgrade");
  assert.equal(data.vocabulary.length, 1, "Live data is untouched");
  assert(Number(data.storageSchemaV1?.version) >= 1, "The applied schema version is recorded");
}

async function cacheEpochTests() {
  const { data, context: c } = background();
  await c.clearTranslationCaches();
  assert.equal(data.videoCacheEpochV1, 1, "Clearing records an epoch outside the event page");
  await c.clearTranslationCaches();
  assert.equal(data.videoCacheEpochV1, 2);

  // The background is an event page the browser may terminate when idle. A
  // module-level counter would restart at zero, so a snapshot write still in
  // flight from a tab could pass the guard and restore the cache just cleared.
  const restarted = background({ videoCacheEpochV1: 2 });
  await restarted.context.clearTranslationCaches();
  assert.equal(restarted.data.videoCacheEpochV1, 3, "A restarted background continues from the stored epoch");
}

async function ocrCaptureTests() {
  const { data, context: c } = background();
  c.browser.tabs.captureVisibleTab = async () => "data:image/jpeg;base64,AAAA";
  const tab = { id: 1, windowId: 2, url: "https://www.youtube.com/watch?v=abc" };
  const crop = { left: 10, top: 10, width: 120, height: 40, viewportWidth: 1280, viewportHeight: 720 };
  await c.captureVideoSelectionForOcr(tab, crop);
  assert(data.ocrCaptureV1.dataUrl, "The translator reads the capture from storage");
  assert.equal(data.ocrCaptureV1.sourceUrl, undefined, "The watched page URL is not kept beside the screenshot");
  // The capture is a screenshot of the whole visible tab, so it must not
  // outlive the OCR window when the reader dismisses it without loading.
  await c.discardOcrCapture();
  assert.equal(data.ocrCaptureV1, undefined, "Closing the OCR window discards the screenshot");
}

async function wordBatchTests() {
  const c = background().context;
  let requests = 0;
  const answer = (query) => query === "avez"
    // MyMemory-style sentence answers also reach Google; the batch must not
    // lose every other word because one lookup is unusable.
    ? "her name is Anna and she lives in Paris with her whole family"
    : `${query}-en`;
  c.fetch = async (url) => {
    requests += 1;
    const lines = new URL(url).searchParams.getAll("q")[0].split("\n");
    return { ok: true, json: async () => [lines.map((line, index) => {
      const tail = index < lines.length - 1 ? "\n" : "";
      return [`${answer(line)}${tail}`, `${line}${tail}`];
    })] };
  };
  const batch = await c.translateBatchMessage({ items: [
    { text: "bonjour", cacheId: "word:bonjour" },
    { text: "avez", cacheId: "word:avez" },
    { text: "merci", cacheId: "word:merci" }
  ] });
  assert.equal(batch.results.length, 3);
  assert.equal(batch.results[0].translatedText, "bonjour-en");
  assert.equal(batch.results[2].translatedText, "merci-en", "One unusable word must not discard the rest of the batch");
  assert.equal(batch.results[1], null, "The unusable word is reported as missing, not as a wrong meaning");
  assert.equal(requests, 1, "Preloading a video's words costs one provider request, not one per word");

  // A saved correction still wins without contacting the provider.
  const corrected = background().context;
  let correctedRequests = 0;
  corrected.fetch = async (url) => {
    correctedRequests += 1;
    const queries = new URL(url).searchParams.getAll("q");
    return { ok: true, json: async () => queries.length === 1
      ? [[[`${queries[0]}-en`, queries[0]]]]
      : queries.map((query) => [[[`${query}-en`, query]]]) };
  };
  await corrected.saveTranslationCorrection("chien", "hound");
  const withCorrection = await corrected.translateBatchMessage({ items: [
    { text: "chien", cacheId: "word:chien" },
    { text: "chat", cacheId: "word:chat" }
  ] });
  assert.equal(withCorrection.results[0].translatedText, "hound");
  assert.equal(withCorrection.results[0].provider, "correction");
  assert.equal(withCorrection.results[1].translatedText, "chat-en");
  assert.equal(correctedRequests, 1, "Only the uncorrected word reaches the provider");
}

// Google's keyless endpoint is rate limited per request, so a caption batch
// that spends one request per line is what makes English lag behind French.
async function googleBatchTests() {
  const c = background().context;
  let requests = 0;
  const queriesPerRequest = [];
  // The live endpoint translates one q and silently ignores any others, so this
  // mock answers only the first, and returns one chunk per newline-separated
  // line, each repeating its own source text.
  const googleFetch = (onRequest) => async (url) => {
    onRequest(url);
    const query = new URL(url).searchParams.getAll("q")[0];
    const lines = query.split("\n");
    return { ok: true, json: async () => [lines.map((line, index) => [
      `${line} [en]${index < lines.length - 1 ? "\n" : ""}`,
      `${line}${index < lines.length - 1 ? "\n" : ""}`
    ])] };
  };
  c.fetch = googleFetch((url) => { requests += 1; queriesPerRequest.push(new URL(url).searchParams.getAll("q").length); });
  const lines = ["un", "deux", "trois", "quatre", "cinq"];
  const { results } = await c.DualSubTranslation.translateBatch(
    lines.map((text, index) => ({ text, cacheId: `line:${index}` })),
    { provider: "google", videoId: "batched" }
  );
  assert.equal(requests, 1, "A batch of caption lines costs one Google request");
  assert.equal(queriesPerRequest[0], 1, "and sends a single q, because extra q parameters are ignored");
  assert.equal(results.map((result) => result.translatedText).join("|"), lines.map((line) => `${line} [en]`).join("|"));

  // Google may merge or split sentences. A chunk whose own source text does not
  // match the line it should translate must not be trusted: pairing the wrong
  // English with a French caption is worse than spending more requests.
  const drifting = background().context;
  let driftingRequests = 0;
  drifting.fetch = async (url) => {
    driftingRequests += 1;
    const query = new URL(url).searchParams.getAll("q")[0];
    if (query.includes("\n")) return { ok: true, json: async () => [[["Everything at once", query]]] };
    return { ok: true, json: async () => [[[`${query} [en]`, query]]] };
  };
  const recovered = await drifting.DualSubTranslation.translateBatch(
    ["alpha", "beta", "gamma"].map((text, index) => ({ text, cacheId: `drift:${index}` })),
    { provider: "google", videoId: "drift" }
  );
  assert.equal(recovered.results.map((result) => result.translatedText).join("|"), "alpha [en]|beta [en]|gamma [en]",
    "A misaligned answer is discarded and the lines are translated individually");
  assert.equal(driftingRequests, 4, "One rejected join, then one request per line");

  const single = background().context;
  single.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    return { ok: true, json: async () => [[[`${query} [en]`, query], ["!", "!"]]] };
  };
  const one = await single.DualSubTranslation.translateBatch([{ text: "seul", cacheId: "one" }], { provider: "google" });
  assert.equal(one.results[0].translatedText, "seul [en]!", "Multi-part single answers are still joined");
}

async function correctionKeyTests() {
  const c = background().context;
  // Correction keys truncate the source text, so two long passages that share
  // an opening longer than the truncation limit collided.
  const shared = "Le chat noir dort paisiblement sur le canapé du salon pendant que la pluie tombe doucement sur les toits de la ville endormie et que personne ne pense à fermer la fenêtre du couloir";
  assert(shared.length > 160, "The shared opening must exceed the correction key length");
  const first = `${shared} et il rêve de poissons.`;
  const second = `${shared} et il rêve de souris.`;
  await c.saveTranslationCorrection(first, "A cat dreaming of fish");
  c.fetch = async (url) => {
    const query = new URL(url).searchParams.get("q");
    return { ok: true, json: async () => [[["a fresh provider translation", query]]] };
  };
  const exact = await c.translateSelectionWithEngine({ text: first, cacheMode: "phrase" });
  assert.equal(exact.translatedText, "A cat dreaming of fish", "An exact correction still wins");
  const other = await c.translateSelectionWithEngine({ text: second, cacheMode: "phrase" });
  assert.equal(other.translatedText, "a fresh provider translation", "A different passage must not inherit the correction");
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

// The word list fills itself from the cache before it is allowed to spend a
// request, and refuses to add a word the vocabulary already holds.
async function wordPeekTests() {
  const { data, context: c } = background();
  let calls = 0;
  c.fetch = async () => { calls++; return { ok: true, json: async () => [[["yet", "pourtant"]]] }; };
  const words = [{ text: "pourtant", lookupText: "pourtant", readingKey: "", context: "Pourtant, tout allait bien." }];
  const peek = () => c.peekWordMeanings({ words, sourceLanguage: "fr", targetLanguage: "en" });

  const cold = await peek();
  assert.equal(cold.meanings.length, 1, "A peek answers for every word it was given");
  assert.equal(cold.meanings[0].translatedText, "", "A cache miss is an empty meaning, never a missing entry");
  assert.equal(cold.meanings[0].saved, false);
  assert.equal(calls, 0, "A peek never contacts a provider");

  await c.translateSelectionWithEngine({ text: "pourtant", lookupText: "pourtant", cacheMode: "word", context: "Pourtant, tout allait bien." });
  assert.equal(calls, 1);
  const warm = await peek();
  assert.equal(warm.meanings[0].translatedText, "yet", "A peek reads what the lookup card cached");
  assert.equal(calls, 1, "A warm peek spends no request");

  await c.addVocabularyEntry({ sourceText: "Pourtant", translatedText: "yet" });
  const saved = await peek();
  assert.equal(saved.meanings[0].saved, true, "A word already in the vocabulary cannot be added again");
  assert.equal(data.wordStatesV1.pourtant.state, "learning", "Saving a new word marks it learning");

  // Importing does not mark word states, so imported words keep reading
  // "unknown" and would be offered for saving again. Word state cannot hide
  // them; only the vocabulary itself knows.
  await c.importVocabularyEntries([{ sourceText: "aussitôt", translatedText: "immediately" }]);
  assert.equal(data.wordStatesV1["aussitôt"], undefined, "Import leaves word state alone");
  const imported = await c.peekWordMeanings({
    words: [{ text: "aussitôt", lookupText: "aussitôt", readingKey: "", context: "" }],
    sourceLanguage: "fr", targetLanguage: "en"
  });
  assert.equal(imported.meanings[0].saved, true, "An imported word is already saved");

  // The stored key is NFKC and locale-less; a transcript token is NFC and
  // French-lowercased. A raw comparison would treat these as different words.
  const composed = "élan".normalize("NFC");
  await c.addVocabularyEntry({ sourceText: "élan".normalize("NFD"), translatedText: "momentum" });
  const accented = await c.peekWordMeanings({ words: [{ text: composed, lookupText: composed, readingKey: "", context: "" }], sourceLanguage: "fr", targetLanguage: "en" });
  assert.equal(accented.meanings[0].saved, true, "Normalisation differences must not defeat the guard");

  const blocked = background().context;
  blocked.fetch = async () => { throw new Error("A peek must not reach the network"); };
  const offline = await blocked.peekWordMeanings({ words, sourceLanguage: "fr", targetLanguage: "en" });
  assert.equal(offline.meanings[0].translatedText, "", "A peek degrades to empty rather than failing");
}

async function sidebarTests() {
  let tabId = 1, delayed;
  const text = source("sidebar/sidebar.js");
  const c = vm.createContext({ console, render() {}, URLSearchParams,
    // A panel has no followTab parameter, so it resolves the tab in front.
    location: { search: "" },
    // refresh() skips hidden pages and resets the view when the tab changes.
    document: { hidden: false, querySelectorAll: () => [] },
    browser: { tabs: {
      query: async () => [{ id: tabId, url: `https://www.youtube.com/watch?v=${tabId}` }],
      sendMessage: async (id, message) => {
        if (id === 3) return new Promise((resolve) => { delayed = resolve; });
        return { ok: true, videoId: String(id), revision: "1:1", cues: message.lastRevision === "1:1" ? null : [{ text: `tab ${id}` }] };
      }
    } } });
  vm.runInContext(text.slice(0, text.indexOf("function renderTabs")) + text.slice(text.indexOf("async function refresh()"), text.indexOf("async function startPractice")), c);
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
  await storageTests(); await backupMergeTests(); await palettePaletteTests();
  await learningDataModelTests(); await storageMigrationTests(); await cacheEpochTests(); await ocrCaptureTests();
  await wordBatchTests(); await googleBatchTests(); await correctionKeyTests();
  await translationTests(); await wordPeekTests(); await sidebarTests(); await practiceTests();
  console.log("DualSub regression tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
