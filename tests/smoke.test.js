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
  const contentCss = fs.readFileSync(path.join(projectRoot, "content.css"), "utf8");
  const popupCss = fs.readFileSync(path.join(projectRoot, "popup", "popup.css"), "utf8");
  const popupHtml = fs.readFileSync(path.join(projectRoot, "popup", "popup.html"), "utf8");
  const bridgeSource = fs.readFileSync(path.join(projectRoot, "page-bridge.js"), "utf8");
  const helpers = extract(source, "  function joinCaptionParts", "  function requestCaptionFromPage");
  const parser = extract(source, "  function parseCaptionPayload", "  async function loadCaptionCues");
  const cueTools = extract(source, "  function cueAt", "  function startAheadTranslation");
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

  const separateWordPayload = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: "je pense que cette idée fonctionne" }] },
    { tStartMs: 3800, dDurationMs: 1400, segs: [{ utf8: "Vraiment" }] },
    { tStartMs: 4600, dDurationMs: 2600, segs: [{ utf8: "je ne crois pas" }] }
  ] });
  const separateWordCues = context.parseCaptionPayload(separateWordPayload);
  assert.strictEqual(separateWordCues.length, 3, "A short overlapping caption must keep its own boundary");
  assert.strictEqual(separateWordCues[1].text, "Vraiment");

  const standaloneConnectorPayload = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 2400, segs: [{ utf8: "on en parle souvent avec" }] },
    { tStartMs: 3400, dDurationMs: 1800, segs: [{ utf8: "Marie" }] },
    { tStartMs: 5400, dDurationMs: 2200, segs: [{ utf8: "elle est experte" }] }
  ] });
  const standaloneConnectorCues = context.parseCaptionPayload(standaloneConnectorPayload);
  assert.strictEqual(standaloneConnectorCues.length, 3, "Grammar alone must not erase a caption boundary");

  const explicitAppendPayload = JSON.stringify({ events: [
    { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "c'est vraiment" }] },
    { tStartMs: 2500, dDurationMs: 1200, aAppend: 1, segs: [{ utf8: "important" }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: "pour nous" }] }
  ] });
  const explicitAppendCues = context.parseCaptionPayload(explicitAppendPayload);
  assert.strictEqual(explicitAppendCues.length, 2);
  assert.strictEqual(explicitAppendCues[0].text, "c'est vraiment important");

  const overlaps = [
    { start: 1000, end: 5000, text: "old" },
    { start: 3000, end: 6000, text: "new" }
  ];
  assert.strictEqual(context.cueAt(overlaps, 3500).text, "new");
  assert.strictEqual(context.cueIndexAt(overlaps, 3500), 1);
  const prefetchCues = [
    { start: 0, end: 2000 },
    { start: 2500, end: 4500 },
    { start: 5000, end: 7000 },
    { start: 7500, end: 9500 },
    { start: 10000, end: 12000 },
    { start: 12500, end: 14500 }
  ];
  assert.deepStrictEqual(
    Array.from(context.translationPrefetchOrder(prefetchCues, 7800, 6000, 5000)),
    [3, 1, 2, 4, 5],
    "Translate the current cue first, then recent context and upcoming cues"
  );
  assert.strictEqual(context.translationPrefetchOrder(prefetchCues, 7200, 1000, 1000)[0], 3);
  assert(source.includes("video.currentTime * 1000 + Number(settings.captionOffsetMs || 0)"));
  assert(!source.includes("Math.max(0, Number(settings.subtitleLeadMs)"));
  assert(source.includes('recoverTracksFromNativePlayer(nativeSourceTrack, result.url || "")'));
  assert(source.indexOf("startNativeSourceCapture(sourceTrack);") < source.indexOf("transcriptCues = await requestFullTranscript();"));
  assert(source.includes("timedTrackUpgradePending"));
  assert(source.includes("timedTrackRecoveryLastError"));
  assert(source.includes("attempt < 120"), "Precise timing recovery should outlast the old ten-second window");
  assert(!bridgeSource.includes('url.searchParams.get("pot")'), "Native caption detection must not require an optional pot parameter");
  assert(source.includes("still loading precise timed tracks"));

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
  for (const action of ["pin", "copy", "previous", "next", "slow", "loop", "phrase"]) {
    assert(source.includes(`data-action="${action}"`), `Lookup action ${action} should be present`);
  }
  assert(!source.includes('data-action="sentence"'));
  assert(!source.includes("Translate line"));
  assert(source.includes("chooseFrenchVoice"));
  assert(source.includes("colorFrenchWordGroups"));
  assert(source.includes('class="dualsub-card-translation"'));
  assert(source.includes("How this verb works"));
  assert(source.includes("lookupTranslationCache"));
  assert(source.includes('cacheMode: "word"'));
  assert(popupCss.includes("overflow-y: auto"), "The settings popup should scroll vertically");
  assert(popupCss.includes("overflow-x: hidden"), "The settings popup should not scroll horizontally");
  const frenchAppearanceStart = popupHtml.indexOf('data-appearance-content="source"');
  const englishAppearanceStart = popupHtml.indexOf('data-appearance-content="target"');
  const colorSettingIndex = popupHtml.indexOf('id="colorFrenchWordGroups"');
  assert(
    frenchAppearanceStart < colorSettingIndex && colorSettingIndex < englishAppearanceStart,
    "The French word-group coloring toggle should live in Appearance → French"
  );
  for (const group of ["Unknown", "Noun", "Verb", "Adjective", "Adverb", "Pronoun", "Determiner", "Preposition", "Conjunction", "Interjection"]) {
    const settingIndex = popupHtml.indexOf(`id="wordGroupColor${group}"`);
    assert(
      frenchAppearanceStart < settingIndex && settingIndex < englishAppearanceStart,
      `${group} should have an editable color under Appearance → French`
    );
  }
  assert(contentCss.includes("--dualsub-group-unknown: #ffffff"));
  assert(contentCss.includes("--dualsub-group-verb: #a78bfa"));
  assert(contentCss.includes("var(--dualsub-group-adverb, #facc15)"));
  assert(contentCss.includes('.dualsub-card-translation[data-group="verb"]'));
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
  assert(context.DualSubFrench.describe(suis).includes("normally used with “je”"));
  assert(context.DualSubFrench.describe(suis).includes("happening now"));
  const feraient = analyze("feraient");
  assert.strictEqual(feraient.lemma, "faire");
  assert.strictEqual(feraient.mood, "conditional");
  assert.strictEqual(feraient.tense, "present");
  assert(context.DualSubFrench.describe(feraient).includes("would or could happen"));
  assert(context.DualSubFrench.describe(feraient).includes("ils or elles"));
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
  const psychee = analyze("psychée", "une psychée");
  assert.strictEqual(psychee.partOfSpeech, "nominal");
  assert(psychee.verbReadings.some((reading) => reading.lemma === "psycher"));
  assert.strictEqual(analyze("psychée").lemma, "psycher");
  assert.strictEqual(context.DualSubFrench.classifyWord("psychée", "une psychée", psychee).group, "noun");
}

async function testAblautMorphology() {
  const context = { console, TextDecoder, TextEncoder, WebAssembly };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "vendor", "ablaut", "ablaut.js"), "utf8"), context);
  context.wasmBytes = fs.readFileSync(path.join(projectRoot, "vendor", "ablaut", "ablaut_bg.wasm"));
  vm.runInContext(`
    wasm_bindgen.initSync({ module: wasmBytes });
    morphologyResults = {
      suis: wasm_bindgen.reverseFrench("suis"),
      apercevais: wasm_bindgen.reverseFrench("apercevais"),
      mangeaient: wasm_bindgen.reverseFrench("mangeaient"),
      finissions: wasm_bindgen.reverseFrench("finissions"),
      recevront: wasm_bindgen.reverseFrench("recevront"),
      maintenant: wasm_bindgen.reverseFrench("maintenant")
    };
  `, context);
  const attested = new Set(JSON.parse(fs.readFileSync(
    path.join(projectRoot, "vendor", "lefff", "french-verb-lemmas.json"), "utf8"
  )));
  assert(attested.size > 7500, "The bundled Lefff derivative should cover thousands of verbs");
  const lemmas = (key) => Array.from(context.morphologyResults[key], (item) => item.infinitive)
    .filter((lemma) => attested.has(lemma));
  assert(lemmas("suis").includes("\u00eatre") && lemmas("suis").includes("suivre"));
  assert(lemmas("apercevais").includes("apercevoir"));
  assert(lemmas("mangeaient").includes("manger"));
  assert(lemmas("finissions").includes("finir"));
  assert(lemmas("recevront").includes("recevoir"));
  assert(lemmas("maintenant").includes("maintenir"), "The engine should retain the real participle reading");

  context.browser = { runtime: { getURL: (value) => value } };
  context.fetch = async (url) => ({
    ok: true,
    async json() {
      return String(url).includes("french-word-groups")
        ? { maison: "n", belle: "j", rapidement: "r", psyché: "n", psychée: "v", fait: "nv" }
        : Array.from(attested);
    }
  });
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "language", "french.js"), "utf8"), context);
  await context.DualSubFrench.ready;
  const received = context.DualSubFrench.analyzeWord("recevront", "ils recevront une lettre");
  assert.strictEqual(received.lemma, "recevoir");
  assert.strictEqual(context.DualSubFrench.analyzeWord("maintenant", "il parle maintenant"), null);
  assert.strictEqual(
    context.DualSubFrench.analyzeWord("maintenant", "en maintenant la pression").lemma,
    "maintenir"
  );
  assert.strictEqual(context.DualSubFrench.classifyWord("maison").group, "noun");
  assert.strictEqual(context.DualSubFrench.classifyWord("belle").group, "adjective");
  assert.strictEqual(context.DualSubFrench.classifyWord("rapidement").group, "adverb");
  assert.strictEqual(context.DualSubFrench.analyzeWord("psychée", "une psychée").lemma, "psyché");
  assert.strictEqual(context.DualSubFrench.analyzeWord("fait", "le fait est clair").partOfSpeech, "nominal");
  assert.strictEqual(context.DualSubFrench.analyzeWord("fait", "il la fait souvent").partOfSpeech, "verb");
}

async function testWordGroupResource() {
  const groups = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "vendor", "lexique", "french-word-groups.json"), "utf8"
  ));
  assert(Object.keys(groups).length > 120000, "The offline word-group index should cover common French forms");
  assert(groups.maison?.includes("n"));
  assert(groups.rapidement?.includes("r"));
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
  const defaultSettings = await messageListener({ type: "get-default-settings" });
  assert.strictEqual(defaultSettings.settings.captionOffsetMs, 0);
  assert.strictEqual(defaultSettings.settings.subtitleLeadMs, undefined);
  assert.strictEqual(defaultSettings.settings.colorFrenchWordGroups, false);
  assert.strictEqual(defaultSettings.settings.wordGroupColors.unknown, "#ffffff");
  assert.strictEqual(defaultSettings.settings.wordGroupColors.verb, "#a78bfa");
  assert.strictEqual(defaultSettings.settings.wordGroupColors.adverb, "#facc15");
  assert.strictEqual(Object.keys(defaultSettings.settings.wordGroupColors).length, 10);
  assert.strictEqual(defaultSettings.settings.pronunciationVoiceURI, "");
  assert.strictEqual(defaultSettings.settings.pronunciationRate, 0.88);

  const translations = await Promise.all([
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en", cacheMode: "word" }),
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en", cacheMode: "word" })
  ]);
  assert(translations.every((result) => result.ok && result.translatedText === "hello"));
  assert.strictEqual(fetchCount, 1, "Concurrent identical translations should share one request");
  assert.strictEqual(stores.local.translationCacheV1.length, 1, "Word translations should persist locally");
  vm.runInContext("translationCache.clear(); persistentTranslationCache.clear(); persistentTranslationCacheLoadPromise = undefined;", context);
  const persistentHit = await messageListener({
    type: "translate-selection",
    text: "BONJOUR",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "word"
  });
  assert(persistentHit.ok && persistentHit.translatedText === "hello");
  assert.strictEqual(fetchCount, 1, "A persistent case-insensitive word hit should avoid the network");

  stores.sync.settings = { ...defaultSettings.settings, translationProvider: "mymemory" };
  context.fetch = async (url) => {
    fetchCount += 1;
    assert(String(url).startsWith("https://api.mymemory.translated.net/get"));
    return { ok: false, status: 429 };
  };
  const rateLimited = await messageListener({
    type: "translate-selection",
    text: "limite gratuite",
    sourceLanguage: "fr",
    targetLanguage: "en"
  });
  assert.strictEqual(rateLimited.ok, false);
  assert.strictEqual(rateLimited.errorCode, "MYMEMORY_RATE_LIMITED");
  assert(rateLimited.error.includes("free translation limit"));

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
  .then(testAblautMorphology)
  .then(testWordGroupResource)
  .then(testVocabularyStorage)
  .then(() => console.log("DualSub smoke tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
