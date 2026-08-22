const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const parentRoot = path.resolve(__dirname, "..");
const projectRoot = fs.existsSync(path.join(parentRoot, "content.js")) ? parentRoot : process.cwd();

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Could not extract ${startMarker}`);
  return source.slice(start, end);
}

async function testCaptionProcessing() {
  const source = fs.readFileSync(path.join(projectRoot, "content.js"), "utf8");
  const helpers = extract(source, "  function joinCaptionParts", "  function requestCaptionFromPage");
  const parser = extract(source, "  function parseCaptionPayload", "  async function loadCaptionCues");
  const cueTools = extract(source, "  function cueAt", "  function stopAheadTranslation");
  const wordMatching = extract(source, "  function normalizeLookupWord", "  function handleWordPointerOver");
  const nativeMessageFilter = extract(source, "  function isNativeCaptionSystemMessage", "  function readNativeCaptionText");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${helpers}\n${parser}\n${cueTools}\n${wordMatching}\n${nativeMessageFilter}`, context);

  const payload = JSON.stringify({ events: [
    { tStartMs: 793000, dDurationMs: 3000, segs: [{ utf8: "alors là on fait un micro trottoir sur" }] },
    { tStartMs: 796000, dDurationMs: 1800, segs: [{ utf8: "TikTok" }] },
    { tStartMs: 796600, dDurationMs: 3200, segs: [{ utf8: "et on demande aux gens" }] }
  ] });
  const cues = context.parseCaptionPayload(payload);
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].text, "alors là on fait un micro trottoir sur TikTok");

  const overlaps = [
    { start: 1000, end: 5000, text: "old" },
    { start: 3000, end: 6000, text: "new" }
  ];
  assert.strictEqual(context.cueAt(overlaps, 3500).text, "new");
  assert.strictEqual(context.cueIndexAt(overlaps, 3500), 1);

  vm.runInContext(`
    sourceCues = [
      { start: 1000, end: 3500, text: "bonjour tout le monde" },
      { start: 3600, end: 6000, text: "comment allez vous" }
    ];
    targetCues = [
      { start: 900, end: 3400, text: "hello everyone" },
      { start: 3500, end: 6100, text: "how are you" }
    ];
    alignedTargetCues = [];
    refreshCueAlignment();
  `, context);
  assert.deepStrictEqual(Array.from(context.alignedTargetCues, (cue) => cue.text), ["hello everyone", "how are you"]);
  assert(context.wordSimilarity("do", "doing") >= 0.78, "Inflected verbs should match");
  assert(context.wordSimilarity("thing", "things") >= 0.78, "Simple plurals should match");
  assert(context.wordSimilarity("chat", "cat") < 0.78, "Different words should not be selected");
  assert(context.isNativeCaptionSystemMessage("French (auto-translated) Click for settings", 500));
  assert(context.isNativeCaptionSystemMessage("French (auto-generated)", 2000));
  assert(!context.isNativeCaptionSystemMessage("French (auto-generated)", 12000));
  assert(!context.isNativeCaptionSystemMessage("On parle des param\u00e8tres du t\u00e9l\u00e9phone", 1000));
}

async function testFrenchConjugation() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "language", "french.js"), "utf8"), context);
  const analyze = context.DualSubFrench.analyzeWord;
  const suis = analyze("suis");
  assert.strictEqual(suis.lemma, "\u00eatre");
  assert.strictEqual(suis.tense, "present");
  assert.strictEqual(suis.person, "1st");
  assert.strictEqual(suis.number, "singular");
  const feraient = analyze("feraient");
  assert.strictEqual(feraient.lemma, "faire");
  assert.strictEqual(feraient.mood, "conditional");
  assert.strictEqual(feraient.tense, "present");
  const parlerai = analyze("parlerai");
  assert.strictEqual(parlerai.lemma, "parler");
  assert.strictEqual(parlerai.tense, "future");
  assert.strictEqual(analyze("parl\u00e9").lemma, "parler");
  assert.strictEqual(analyze("parlons").lemma, "parler");
  assert.strictEqual(analyze("finissons").lemma, "finir");
  assert.strictEqual(analyze("mangeons").lemma, "manger");
  assert(analyze("fait").alternatives.length, "fait should retain its participle alternative");
  assert.strictEqual(analyze("TikTok"), null);
  assert.strictEqual(analyze("maintenant"), null, "ordinary adverbs must not be guessed as verbs");
}

async function testVocabularyStorage() {
  const stores = { sync: {}, local: {} };
  let messageListener;
  let fetchCount = 0;
  const makeArea = (name) => ({
    async get(key) {
      if (typeof key === "string") return { [key]: stores[name][key] };
      return { ...stores[name] };
    },
    async set(values) { Object.assign(stores[name], values); }
  });
  const browser = {
    storage: {
      sync: makeArea("sync"),
      local: makeArea("local"),
      onChanged: { addListener() {} }
    },
    runtime: {
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    commands: { onCommand: { addListener() {} } }
  };
  const context = {
    browser,
    console,
    URL,
    TextEncoder,
    fetch: async () => {
      fetchCount += 1;
      await Promise.resolve();
      return { ok: true, async json() { return [[ ["hello"] ]]; } };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);
  assert(messageListener, "Background message listener was not registered");

  const translations = await Promise.all([
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en" }),
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en" })
  ]);
  assert(translations.every((result) => result.ok && result.translatedText === "hello"));
  assert.strictEqual(fetchCount, 1, "Concurrent identical translations should share one request");

  const entry = {
    sourceText: "bonjour",
    translatedText: "hello",
    sentence: "Bonjour tout le monde",
    sentenceTranslation: "Hello everyone",
    sourceLanguage: "fr",
    targetLanguage: "en",
    videoId: "video123",
    timeMs: 12000
  };
  const first = await messageListener({ type: "add-vocabulary", entry });
  assert(first.ok && first.added);
  const duplicate = await messageListener({ type: "add-vocabulary", entry: { ...entry, sentence: "Bonjour !" } });
  assert(duplicate.ok && !duplicate.added && duplicate.entry.encounters === 2);
  const edited = await messageListener({
    type: "update-vocabulary",
    id: first.entry.id,
    updates: { translatedText: "hi", notes: "Informal greeting" }
  });
  assert(edited.ok && edited.entry.translatedText === "hi" && edited.entry.notes === "Informal greeting");
  const loaded = await messageListener({ type: "get-vocabulary" });
  assert.strictEqual(loaded.entries.length, 1);
  const reviewed = await messageListener({ type: "review-vocabulary", id: first.entry.id, rating: "good" });
  assert(reviewed.ok && reviewed.entry.stage === 1 && reviewed.entry.reviews === 1);
  const imported = await messageListener({ type: "import-vocabulary", entries: [
    { ...entry, stage: 4, reviews: 8 },
    { ...entry, sourceText: "merci", translatedText: "thank you" }
  ] });
  assert(imported.ok && imported.imported === 1 && imported.updated === 1 && imported.total === 2);
  const removed = await messageListener({ type: "remove-vocabulary", id: first.entry.id });
  assert(removed.ok && removed.removed);
}

Promise.resolve()
  .then(testCaptionProcessing)
  .then(testFrenchConjugation)
  .then(testVocabularyStorage)
  .then(() => console.log("DualSub smoke tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
