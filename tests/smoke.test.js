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
  const readme = fs.readFileSync(path.join(projectRoot, "README.md"), "utf8");
  const architecture = fs.readFileSync(path.join(projectRoot, "docs", "ARCHITECTURE.md"), "utf8");
  const translationGuide = fs.readFileSync(path.join(projectRoot, "docs", "TRANSLATION_AND_ALIGNMENT.md"), "utf8");
  const contentCss = fs.readFileSync(path.join(projectRoot, "content.css"), "utf8");
  const popupCss = fs.readFileSync(path.join(projectRoot, "popup", "popup.css"), "utf8");
  const popupHtml = fs.readFileSync(path.join(projectRoot, "popup", "popup.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(projectRoot, "popup", "popup.js"), "utf8");
  const sidebarHtml = fs.readFileSync(path.join(projectRoot, "sidebar", "sidebar.html"), "utf8");
  const voiceHelpHtml = fs.readFileSync(path.join(projectRoot, "help", "pronunciation.html"), "utf8");
  const translatorHtml = fs.readFileSync(path.join(projectRoot, "tools", "translator.html"), "utf8");
  const translatorSource = fs.readFileSync(path.join(projectRoot, "tools", "translator.js"), "utf8");
  const bridgeSource = fs.readFileSync(path.join(projectRoot, "page-bridge.js"), "utf8");
  const helpers = extract(source, "  function joinCaptionParts", "  function requestCaptionFromPage");
  const parser = extract(source, "  function parseCaptionPayload", "  async function loadCaptionCues");
  const cueTools = extract(source, "  function cueAt", "  function startAheadTranslation");
  const wordMatching = extract(source, "  function normalizeLookupWord", "  function handleWordPointerOver");
  const elisionTools = extract(source, "  function splitFrenchElision", "  function tagFrenchWord");
  const nativeMessageFilter = extract(source, "  function isNativeCaptionSystemMessage", "  function readNativeCaptionText");
  const captureCrop = extract(translatorSource, "function captureCropPixels", "function loadImage");
  const context = { console };
  vm.createContext(context);
  vm.runInContext(`${helpers}\n${parser}\n${cueTools}\n${wordMatching}\n${elisionTools}\n${nativeMessageFilter}\nconst clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));\n${captureCrop}`, context);

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
  assert.strictEqual(explicitAppendCues[0].fragments.length, 2, "Display grouping must preserve both raw timed fragments");

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
  const warmupWords = Array.from(context.videoWordWarmupOrder([
    { start: 0, end: 2000, text: "je mange avec Marie" },
    { start: 3000, end: 5000, text: "je mange souvent" },
    { start: 6000, end: 8000, text: "Marie mange aussi" }
  ], 3500, 4));
  assert(warmupWords.includes("mange") && warmupWords.includes("je"), "Frequent video words should be prioritized for warm-up");
  assert(source.includes("video.currentTime * 1000 + effectiveCaptionOffsetMs()"));
  assert(readme.includes("docs/ARCHITECTURE.md"), "The architecture guide should be linked from the README");
  for (const documentedPart of ["content.js", "page-bridge.js", "background.js", "translation-engine.js", "language/french.js", "OCR and manual translation", "Persistent data"]) {
    assert(architecture.includes(documentedPart), `Architecture guide should cover ${documentedPart}`);
  }
  assert(readme.includes("docs/TRANSLATION_AND_ALIGNMENT.md"), "The translation and alignment guide should be linked from the README");
  for (const documentedDecision of ["Where an English subtitle comes from", "Lookup decision order", "How complete French and English cues are paired", "How a French word is analyzed", "Path A: Azure character alignment", "Path B: lookup translation evidence", "0.86"]) {
    assert(translationGuide.includes(documentedDecision), `Translation guide should cover ${documentedDecision}`);
  }
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
  const reflexiveElision = context.splitFrenchElision("s'habiller");
  assert.strictEqual(reflexiveElision.particle, "s'");
  assert.strictEqual(reflexiveElision.base, "habiller");
  assert.strictEqual(context.splitFrenchElision("d’accord").particle, "d’");
  assert.strictEqual(context.splitFrenchElision("l’homme").base, "homme");
  assert.strictEqual(context.splitFrenchElision("aujourd'hui"), null, "Lexical apostrophes must stay intact");
  assert(context.isNativeCaptionSystemMessage("French (auto-translated) Click for settings", 500));
  assert(context.isNativeCaptionSystemMessage("French (auto-generated)", 2000));
  assert(!context.isNativeCaptionSystemMessage("French (auto-generated)", 12000));
  assert(!context.isNativeCaptionSystemMessage("On parle des param\u00e8tres du t\u00e9l\u00e9phone", 1000));
  for (const action of ["pin", "copy", "correct", "previous", "next", "slow", "loop", "phrase"]) {
    assert(source.includes(`data-action="${action}"`), `Lookup action ${action} should be present`);
  }
  assert(!source.includes('data-action="sentence"'));
  assert(!source.includes("Translate line"));
  assert(source.includes("chooseFrenchVoice"));
  assert(source.includes("colorFrenchWordGroups"));
  assert(source.includes('class="dualsub-card-translation"'));
  assert(source.includes('class="dualsub-card-infinitive"'));
  assert(!source.includes('<div class="dualsub-card-label">Verb</div>'));
  assert(!source.includes("Elsewhere in this video"));
  assert(!source.includes("Example sentences"));
  assert(!source.includes("dualsub-caption-provenance"));
  assert(source.includes('aheadAlignmentKinds.get(currentSourceCueIndex) !== "character"'));
  assert(source.includes("lookupTranslationKey"));
  assert(source.includes("lookupTranslationCache"));
  assert(source.includes('cacheMode: "word"'));
  assert(source.includes('kind === "word" ? "word" : "phrase"'));
  assert(source.includes("dualsub-correction-form"));
  assert(source.includes("dualsub-card-provenance"), "Lookup cards should identify their translation source");
  assert(source.includes("translationProviderLink"), "Lookup cards should link to supported translation engines");
  assert(!source.includes("window.prompt(`Correct the English meaning"), "Corrections should use the inline editor");
  assert(source.includes("videoWordWarmupOrder"));
  assert(source.includes("dualsub-status-close"));
  assert(source.includes("dismissedStatusKeys"));
  assert(popupCss.includes("overflow-y: auto"), "The settings popup should scroll vertically");
  assert(popupCss.includes("overflow-x: hidden"), "The settings popup should not scroll horizontally");
  assert(popupHtml.includes('id="preloadVideoWords"'));
  assert(popupHtml.includes('id="settingsSearch"'), "Settings should be searchable by task");
  assert(popupHtml.includes('data-panel-content="home"'), "Learning actions should have a dedicated Home page");
  assert(popupHtml.includes('class="settings-search-shell"'), "Settings search should be scoped to the settings pages");
  assert(popupHtml.indexOf('data-panel-content="home"') < popupHtml.indexOf('data-panel-content="general"'));
  assert(popupSource.includes('document.body.dataset.activePanel = selected'), "Page changes should update Home/settings visibility");
  assert(popupSource.includes('activatePanel("home")'), "The toolbar should open on the workspace dashboard");
  assert(!popupHtml.includes('value="focus"') && !sidebarHtml.includes('value="focus"'), "Focus mode should not remain in either mode menu");
  assert(!source.includes('effectiveStudyMode() === "focus"'), "Focus mode should not secretly control English visibility");
  assert(popupSource.includes("browser.commands.openShortcutSettings()"), "Tools should open Firefox's shortcut editor directly");
  assert(popupHtml.includes(">Remap shortcuts</button>"), "Shortcut remapping should be discoverable in Tools");
  assert(popupHtml.includes("Caption behavior &amp; timing"), "Less-used caption controls should use progressive disclosure");
  assert(popupHtml.includes('data-tool-content="playback"') && popupHtml.includes('data-tool-content="support"'), "Tools should use clear task-based groups");
  assert(!popupHtml.includes('class="tool-tabs"'), "Tools should not add a second layer of tab navigation");
  assert(popupCss.includes(".sub-settings-group"), "Advanced lookup behavior should be visually subordinate");
  assert(popupHtml.includes('id="openSidebar"'), "The toolbar popup should expose the transcript sidebar");
  assert(popupHtml.includes('id="openTranslator"') && popupHtml.includes('id="captureText"'));
  assert(translatorHtml.includes('id="captureStage"') && translatorHtml.includes('id="sourceText"'));
  assert(translatorSource.includes('Tesseract.createWorker("fra"'));
  assert(translatorSource.includes('browser.storage.local.remove("ocrCaptureV1")'));
  assert(translatorSource.includes("scheduleAutomaticTranslation(80)"), "OCR output should translate automatically");
  assert(translatorSource.includes("Translating as you type"), "Typed text should translate after a debounce");
  assert(source.includes('message?.type === "start-video-ocr-selection"'), "The content script should start video-region selection");
  assert(source.includes("await completeOcrSelection()"), "Releasing a valid drag should submit the selected text region");
  assert(contentCss.includes(".dualsub-ocr-selector"), "OCR selection should have an in-player snipping overlay");
  assert(contentCss.includes(".dualsub-ocr-modal-frame"), "OCR results should use an in-page YouTube modal");
  assert(source.includes('message?.type === "show-video-ocr-popup"'), "The content script should mount the OCR result modal");
  assert(translatorSource.includes("dualsub:close-ocr-popup"), "The embedded translator should be closeable");
  assert(translatorSource.includes("capture.autoRun && await runOcr()"), "A confirmed video selection should start OCR automatically");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(context.captureCropPixels({ left: 100, top: 50, width: 800, height: 450, viewportWidth: 1000, viewportHeight: 600 }, 2000, 1200))),
    { x: 200, y: 100, width: 1600, height: 900 },
    "Video crop coordinates should scale from CSS pixels to screenshot pixels"
  );
  for (const asset of [
    "vendor/tesseract/tesseract.min.js",
    "vendor/tesseract/worker.min.js",
    "vendor/tesseract/tesseract-core-simd-lstm.wasm.js",
    "vendor/tesseract/tesseract-core-simd-lstm.wasm",
    "vendor/tesseract/lang/fra.traineddata.gz"
  ]) assert(fs.statSync(path.join(projectRoot, asset)).size > 10_000, `${asset} should be bundled`);
  assert(popupHtml.includes("Set up a French voice") || popupHtml.includes("Preview French voice"));
  assert(voiceHelpHtml.includes("Settings → Time &amp; language → Speech"));
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
  assert(contentCss.includes('.dualsub-status[data-state="error"] .dualsub-status-close'));
  assert(contentCss.includes("width: 22px"), "The status close button should remain compact");
  assert(contentCss.includes("background: #1d4ed8"), "The status close button should use a blue circle");
  assert(contentCss.includes("background: #93c5fd"), "The CSS-drawn close icon should use a contrasting blue");
  assert(contentCss.includes("touch-action: manipulation"));
  assert(source.includes('statusCloseNode.addEventListener("pointerdown", dismissStatus)'));
  assert(source.includes("dismissedStatusKeys.add(displayedStatusKey)"));
  assert(source.includes("!dismissedStatusKeys.has(statusKey)"));
  assert(source.includes('word.dataset.elisionParticle = "true"'));
  assert(source.includes("showElisionParticleCard"));
  assert(contentCss.includes(".dualsub-selection-card.is-particle-card"));
  assert(source.includes('sourceTrackState = "unavailable"'));
  assert(source.includes("useYouTubeNativeCaptions()"));
  assert(source.includes('sourceTrackConfirmed && settings.hideNativeCaptions'));
  assert(source.includes('sourceTrackState = "unknown"'));
  assert(source.includes('mode = usingNativeSource'));
  assert(source.includes('"youtube-native-captions"'));
  assert(!source.includes("This video has no French caption track."), "Missing French captions should not create an overlay error");
  assert(bridgeSource.includes('"dualsub:reset-native-caption-state"'));
  assert(source.includes('document.addEventListener("yt-navigate-start", handleNavigationStart)'));
}

async function testFrenchConjugation() {
  const context = {};
  const frenchSource = fs.readFileSync(path.join(projectRoot, "language", "french.js"), "utf8");
  vm.createContext(context);
  vm.runInContext(frenchSource, context);
  assert(frenchSource.includes("fallbackRegularErLemmas"));
  assert(!frenchSource.includes("const regularErVerbs"));
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
  const mange = analyze("mange");
  assert.strictEqual(mange.lemma, "manger");
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
  const taime = analyze("t'aime", "Je t'aime");
  assert.strictEqual(taime.lemma, "aimer");
  assert.strictEqual(taime.person, "1st");
  assert.strictEqual(taime.number, "singular");
  assert.strictEqual(taime.clitic.expanded, "te");
  assert.strictEqual(taime.clitic.role, "object pronoun");
  assert.strictEqual(Boolean(taime.pronominal), false, "je t'aime is not reflexive");
  const shabiller = analyze("s'habiller", "Il faut s'habiller");
  assert.strictEqual(shabiller.lemma, "habiller");
  assert.strictEqual(shabiller.pronominalLemma, "s’habiller");
  assert.strictEqual(shabiller.clitic.role, "reflexive pronoun");
  const particle = context.DualSubFrench.analyzeElisionParticle("d'");
  assert.strictEqual(particle.group, "preposition");
  assert.strictEqual(particle.meaning, "of / from");
  const sappelle = analyze("s'appelle", "Il s'appelle Louis");
  assert.strictEqual(sappelle.lemma, "appeler");
  assert.strictEqual(sappelle.person, "3rd");
  assert.strictEqual(sappelle.pronominalLemma, "s’appeler");
  assert.strictEqual(sappelle.clitic.role, "reflexive pronoun");
  const nousAppelons = analyze("appelons", "nous nous appelons souvent");
  assert.strictEqual(nousAppelons.pronominalLemma, "s’appeler");
  const vousAime = analyze("aime", "je vous aime");
  assert.strictEqual(vousAime.person, "1st", "an object vous must not replace the sentence subject");
  assert.strictEqual(vousAime.clitic.role, "object pronoun");
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
  const fullTaime = context.DualSubFrench.analyzeWord("t’aime", "je t’aime");
  assert.strictEqual(fullTaime.lemma, "aimer");
  assert.strictEqual(fullTaime.person, "1st");
  assert.strictEqual(fullTaime.clitic.role, "object pronoun");
  const fullSappelle = context.DualSubFrench.analyzeWord("s’appelle", "elle s’appelle Marie");
  assert.strictEqual(fullSappelle.pronominalLemma, "s’appeler");
  assert.strictEqual(fullSappelle.person, "3rd");
  const fullShabiller = context.DualSubFrench.analyzeWord("s’habiller", "il faut s’habiller");
  assert.strictEqual(fullShabiller.pronominalLemma, "s’habiller");
  assert.strictEqual(fullShabiller.mood, "infinitive");
}

async function testWordGroupResource() {
  const groups = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "vendor", "lexique", "french-word-groups.json"), "utf8"
  ));
  assert(Object.keys(groups).length > 120000, "The offline word-group index should cover common French forms");
  assert(groups.maison?.includes("n"));
  assert(groups.rapidement?.includes("r"));
  const info = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "vendor", "lexique", "french-lexical-info.json"), "utf8"
  ));
  assert.strictEqual(Object.keys(info).length, 50000, "The enriched Lexique index should retain the most useful 50,000 forms");
  assert(Array.isArray(info.maison) && info.maison[1] === "mEz§");

  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "manifest.json"), "utf8"));
  assert.strictEqual(manifest.version, "0.8.9");
  assert.strictEqual(manifest.commands["toggle-translation-reveal"].suggested_key.default, "Alt+Shift+L");
  assert(manifest.web_accessible_resources[0].resources.includes("tools/translator.html"), "The in-page OCR frame must be web-accessible");
  assert.strictEqual(manifest.commands["open-video-ocr"].suggested_key.default, "Alt+Shift+O");
  assert.strictEqual(manifest.sidebar_action.default_panel, "sidebar/sidebar.html");
  assert(manifest.commands["open-transcript"], "The transcript sidebar should have a keyboard command");
  assert(manifest.background.scripts.includes("translation-engine.js"));
  assert(manifest.browser_specific_settings.gecko.data_collection_permissions.required.includes("websiteContent"));
}

async function testTranslationEngine() {
  const stores = { local: {} };
  let fetchCount = 0;
  const context = {
    console,
    URL,
    AbortController,
    performance,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "translation-test" },
    browser: { storage: { local: {
      async get(key) { return { [key]: stores.local[key] }; },
      async set(values) { Object.assign(stores.local, values); }
    } } },
    fetch: async (url) => {
      fetchCount += 1;
      const text = new URL(url).searchParams.get("q");
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async json() { return [[[`${text}-en`]]]; }
      };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "translation-engine.js"), "utf8"), context);
  assert.deepStrictEqual(
    Array.from(context.DualSubTranslation.parseAzureAlignment("0:1-0:2 3:5-4:8"), (entry) => ({ ...entry })),
    [
      { sourceStart: 0, sourceEnd: 1, targetStart: 0, targetEnd: 2 },
      { sourceStart: 3, sourceEnd: 5, targetStart: 4, targetEnd: 8 }
    ]
  );
  const options = { provider: "google", sourceLanguage: "fr", targetLanguage: "en", videoId: "video", sessionId: "test" };
  const first = await context.DualSubTranslation.translateBatch([
    { text: "bonjour", cacheId: "cue-1" }, { text: "merci", cacheId: "cue-2" }
  ], options, {});
  assert.deepStrictEqual(Array.from(first.results, (item) => item.translatedText), ["bonjour-en", "merci-en"]);
  const second = await context.DualSubTranslation.translateBatch([
    { text: "bonjour", cacheId: "cue-1" }, { text: "merci", cacheId: "cue-2" }
  ], options, {});
  assert(second.results.every((item) => item.cacheHit));
  assert.strictEqual(fetchCount, 2, "A repeated batch should be served entirely from the persistent line cache");
  context.fetch = async (url) => {
    fetchCount += 1;
    const text = new URL(url).searchParams.get("q");
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async json() { return text === "je mange" ? [[ ["I ", "je "], ["eat", "mange"] ]] : [[[`${text}-en`]]]; }
    };
  };
  const segmented = await context.DualSubTranslation.translateBatch([
    { text: "je mange", cacheId: "cue-3" }
  ], options, {});
  assert.strictEqual(segmented.results[0].alignment.length, 2, "Google segment boundaries should be retained when available");
  assert.strictEqual(segmented.results[0].provenance, "Google segmented");
}

async function testVocabularyStorage() {
  const stores = { sync: {}, local: {} };
  let messageListener;
  let commandListener;
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
    commands: { onCommand: { addListener(listener) { commandListener = listener; } } },
    i18n: {
      async detectLanguage(text) {
        return /creada/i.test(text)
          ? { isReliable: true, languages: [{ language: "es", percentage: 100 }] }
          : { isReliable: true, languages: [{ language: "en", percentage: 100 }] };
      }
    }
  };
  const context = {
    browser,
    console,
    URL,
    TextEncoder,
    AbortController,
    performance,
    crypto: { randomUUID: () => "test-request-id" },
    setTimeout,
    clearTimeout,
    fetch: async () => {
      fetchCount += 1;
      await Promise.resolve();
      return { ok: true, async json() { return [[ ["hello"] ]]; } };
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "translation-engine.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "background.js"), "utf8"), context);
  assert(messageListener, "Background message listener was not registered");
  assert.strictEqual(context.suspiciousWordTranslation("créées", "created"), false);
  assert.strictEqual(context.suspiciousWordTranslation(
    "créées",
    "Ownership of real estate in the border areas of 10 km by companies in which majority of capital belongs to foreign nationals is subject to special permission."
  ), true, "Unrelated translation-memory sentences must be rejected for word lookups");
  const defaultSettings = await messageListener({ type: "get-default-settings" });
  assert.strictEqual(defaultSettings.settings.captionOffsetMs, 0);
  assert.strictEqual(defaultSettings.settings.subtitleLeadMs, undefined);
  assert.strictEqual(defaultSettings.settings.colorFrenchWordGroups, false);
  assert.strictEqual(defaultSettings.settings.preloadVideoWords, true);
  assert.strictEqual(defaultSettings.settings.wordGroupColors.unknown, "#ffffff");
  assert.strictEqual(defaultSettings.settings.wordGroupColors.verb, "#a78bfa");
  assert.strictEqual(defaultSettings.settings.wordGroupColors.adverb, "#facc15");
  assert.strictEqual(Object.keys(defaultSettings.settings.wordGroupColors).length, 10);
  assert.strictEqual(defaultSettings.settings.pronunciationVoiceURI, "");
  assert.strictEqual(defaultSettings.settings.pronunciationRate, 0.88);
  assert.strictEqual(defaultSettings.settings.skipCaptionGaps, false);
  assert.strictEqual(context.mergeSettings({ studyMode: "focus" }).studyMode, "watch", "Legacy Focus settings should migrate to Watch");
  const migratedProfile = await messageListener({ type: "save-video-profile", videoId: "legacy-focus", profile: { studyMode: "focus" } });
  assert(migratedProfile.ok && migratedProfile.profile.studyMode === "watch", "Legacy per-video Focus profiles should migrate to Watch");
  assert(commandListener, "Background command listener was not registered");
  await commandListener("toggle-translation-reveal");
  assert.strictEqual(stores.sync.settings.recallMode, true, "The shortcut should hide passive English text");
  assert.strictEqual(stores.sync.settings.showTranslation, true, "Hover reveal should remain available");
  await commandListener("toggle-translation-reveal");
  assert.strictEqual(stores.sync.settings.recallMode, false, "A second shortcut press should restore the English line");

  const translations = await Promise.all([
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en", cacheMode: "word" }),
    messageListener({ type: "translate-selection", text: "bonjour", sourceLanguage: "fr", targetLanguage: "en", cacheMode: "word" })
  ]);
  assert(translations.every((result) => result.ok && result.translatedText === "hello"));
  assert.strictEqual(fetchCount, 1, "Concurrent identical translations should share one request");
  assert.strictEqual(Object.keys(stores.local.lineTranslationCacheV2 || {}).length, 1, "Word translations should persist locally");
  const persistentHit = await messageListener({
    type: "translate-selection",
    text: "BONJOUR",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "word"
  });
  assert(persistentHit.ok && persistentHit.translatedText === "hello");
  assert.strictEqual(fetchCount, 1, "A persistent case-insensitive word hit should avoid the network");

  context.fetch = async (url) => {
    fetchCount += 1;
    assert(String(url).startsWith("https://translate.googleapis.com/"), "Warm-up must not spill into MyMemory");
    return { ok: false, status: 503 };
  };
  const warmupFailure = await messageListener({
    type: "translate-selection",
    text: "indisponible",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "word",
    allowProviderFallback: false
  });
  assert.strictEqual(warmupFailure.ok, false);
  assert(warmupFailure.error.includes("Google translation failed"));
  assert.strictEqual(fetchCount, 2);

  stores.sync.settings = { ...defaultSettings.settings, translationProvider: "mymemory" };
  context.fetch = async (url) => {
    fetchCount += 1;
    if (String(url).startsWith("https://api.mymemory.translated.net/get")) {
      return { ok: true, status: 200, async json() { return {
        responseStatus: 200,
        responseData: { translatedText: "creada" }
      }; } };
    }
    assert(String(url).startsWith("https://translate.googleapis.com/"), "A bad word result should use the concise fallback");
    return { ok: true, status: 200, async json() { return [[ ["created", "créées"] ]]; } };
  };
  const conciseFallback = await messageListener({
    type: "translate-selection",
    text: "créées",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "word"
  });
  assert(conciseFallback.ok && conciseFallback.translatedText === "created");
  assert.strictEqual(conciseFallback.qualityFallback, true);

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
  const correctedLookup = await messageListener({
    type: "translate-selection",
    text: "bonjour",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "word"
  });
  assert(correctedLookup.ok && correctedLookup.translatedText === "hi" && correctedLookup.provider === "correction");
  const phraseCorrection = await messageListener({
    type: "save-translation-correction",
    sourceText: "bonjour tout le monde",
    translatedText: "hello everyone",
    sourceLanguage: "fr",
    targetLanguage: "en"
  });
  assert(phraseCorrection.ok);
  const correctedPhraseLookup = await messageListener({
    type: "translate-selection",
    text: "Bonjour tout le monde",
    sourceLanguage: "fr",
    targetLanguage: "en",
    cacheMode: "phrase"
  });
  assert(correctedPhraseLookup.ok && correctedPhraseLookup.translatedText === "hello everyone");
  assert.strictEqual(correctedPhraseLookup.provider, "correction");
  const loaded = await messageListener({ type: "get-vocabulary" });
  assert.strictEqual(loaded.entries.length, 1);
  const reviewed = await messageListener({ type: "review-vocabulary", id: first.entry.id, rating: "good" });
  assert(reviewed.ok && reviewed.entry.stage === 1 && reviewed.entry.reviews === 1);
  assert(reviewed.entry.reviewIntervalDays === 1 && reviewed.entry.easeFactor > 2.5, "Review intervals should adapt to recall quality");
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
  .then(testTranslationEngine)
  .then(testVocabularyStorage)
  .then(() => console.log("DualSub smoke tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
