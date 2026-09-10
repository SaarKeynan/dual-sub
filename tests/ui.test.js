const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const event = { addListener() {} };
const settle = () => new Promise((resolve) => setImmediate(resolve));
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => { throw error; });

function page(file, search = "") {
  const dom = new JSDOM(read(file), { url: "https://extension.test/" + file + search, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.alert = (message) => { throw new Error(message); };
  dom.window.eval(read("shared/settings.js"));
  dom.window.eval(read("shared/pronunciation.js"));
  return dom;
}

async function sidebar() {
  const dom = page("sidebar/sidebar.html"), w = dom.window;
  let practice = null;
  w.browser = {
    runtime: { getURL: (value) => "https://extension.test/" + value, async sendMessage() { return { ok: true, entries: [], meanings: [] }; } },
    storage: { onChanged: event, sync: { async get() { return {}; }, async set() {} } },
    tabs: { onActivated: event, onUpdated: event, query: async () => [{ id: 1, url: "https://www.youtube.com/watch?v=one" }],
      sendMessage: async (_id, message) => {
        if (message.type === "start-practice") { practice = { mode: message.mode, revealed: false }; return { ok: true }; }
        if (message.type === "stop-practice") { practice = null; return { ok: true }; }
        if (message.type === "reveal-dictation") { practice.revealed = true; return { ok: true, answer: "Je vais bien" }; }
        return { ok: true, videoId: "one", title: "French", revision: "one:1", currentCueIndex: 0, cues: [{ index: 0, text: "Je vais bien", translation: "I am well", start: 1000 }], practice,
          studyWords: [{ word: "bien", count: 1, cueIndex: 0, state: "unknown", lookupText: "bien", readingKey: "", label: "adverb" }],
          session: { encountered: 3, saved: 1, words: ["je", "vais", "bien"] } };
      }
    }
  };
  const tab = (view) => w.document.querySelector(`[role="tab"][data-view="${view}"]`);
  const pane = (view) => w.document.querySelector(`[data-pane="${view}"]`);
  try {
    w.eval(read("shared/practice.js")); w.eval(read("sidebar/word-list.js")); w.eval(read("sidebar/sidebar.js")); await settle();
    assert.equal(w.document.querySelectorAll(".cue").length, 1);

    // Views are mutually exclusive; the transcript is what you get first.
    assert.equal(pane("transcript").dataset.active, "true");
    assert.equal(pane("words").dataset.active, "false");
    tab("words").click();
    assert.equal(pane("words").dataset.active, "true");
    assert.equal(pane("transcript").dataset.active, "false");
    tab("transcript").click();

    // Dictation withholds the French. The word list gives the answer away just
    // as the transcript does, so neither is reachable until the answer is in.
    w.document.getElementById("startDictation").click(); await settle();
    assert.equal(pane("practice").dataset.active, "true");
    assert.equal(tab("transcript").disabled, true, "Dictation must not leave the transcript one click away");
    assert.equal(tab("words").disabled, true, "The word list spoils a dictation too");
    assert.equal(w.document.getElementById("dictationPanel").hidden, false);
    w.document.getElementById("dictationAnswer").value = "je va bien";
    w.document.getElementById("checkDictation").click(); await settle();
    assert.equal(tab("transcript").disabled, false);
    assert.equal(tab("words").disabled, false);
    assert.equal(w.document.querySelectorAll(".answer-replace").length, 1);
    w.document.getElementById("stopPractice").click(); await settle();
    assert.equal(w.document.getElementById("dictationPanel").hidden, true);
    tab("transcript").click();

    // The "no French captions" notice is about the video, not about the filter.
    assert.equal(w.document.getElementById("empty").hidden, true);
    const search = w.document.getElementById("search");
    search.value = "introuvable";
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
    await settle();
    assert.equal(w.document.querySelectorAll(".cue").length, 0);
    assert.equal(w.document.getElementById("empty").hidden, true, "A search with no match is not a video without captions");
    assert.equal(w.document.getElementById("noMatches").hidden, false, "A search with no match says so");
    search.value = "";
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
    await settle();
    assert.equal(w.document.getElementById("noMatches").hidden, true);

    // The transcript is browsable content, not a status. Announcing the whole
    // list on every keystroke and every arriving translation floods the buffer.
    assert.equal(w.document.getElementById("transcript").hasAttribute("aria-live"), false,
      "The transcript must not re-announce itself on every render");
    const count = w.document.getElementById("transcriptCount");
    assert(count, "A small status region should carry the result count instead");
    assert.equal(count.getAttribute("role"), "status");
    assert(/1\b/.test(count.textContent), "and report how many captions are shown");
  } finally { w.close(); }
}

// The word list has to be cheap to open and honest about what is already
// saved, because the old chips were neither.
async function wordList() {
  const dom = page("sidebar/sidebar.html"), w = dom.window;
  const sent = [];
  const saved = new Set(["connu"]);
  const words = [
    { word: "pourtant", count: 3, cueIndex: 0, state: "unknown", lookupText: "pourtant", readingKey: "", label: "adverb" },
    { word: "compris", count: 2, cueIndex: 1, state: "unknown", lookupText: "j'ai compris", readingKey: "verb:comprendre", label: "verb · comprendre" },
    { word: "connu", count: 2, cueIndex: 1, state: "unknown", lookupText: "connu", readingKey: "", label: "adjective" }
  ];
  w.browser = {
    runtime: {
      getURL: (value) => "https://extension.test/" + value,
      async sendMessage(payload) {
        sent.push(payload);
        if (payload.type === "peek-word-meanings") {
          return { ok: true, meanings: payload.words.map((item) => ({
            // "pourtant" was looked up before, so it costs nothing now.
            translatedText: item.text === "pourtant" ? "yet, however" : "",
            saved: saved.has(item.text)
          })) };
        }
        if (payload.type === "translate-selection") return { ok: true, translatedText: "understood" };
        if (payload.type === "add-vocabulary") { saved.add(payload.entry.sourceText); return { ok: true, entry: { id: "1" } }; }
        return { ok: true };
      }
    },
    storage: { onChanged: event, sync: { async get() { return {}; }, async set() {} } },
    tabs: { onActivated: event, onUpdated: event, query: async () => [{ id: 1, url: "https://www.youtube.com/watch?v=one" }],
      sendMessage: async () => ({ ok: true, videoId: "one", title: "French", revision: "one:1", currentCueIndex: 0, studyWords: words,
        cues: [{ index: 0, text: "Pourtant tout allait bien", translation: "Yet all was well", start: 0 },
               { index: 1, text: "Je n'ai pas compris", translation: "I did not understand", start: 2000 }] })
    }
  };
  try {
    w.eval(read("shared/practice.js")); w.eval(read("sidebar/word-list.js")); w.eval(read("sidebar/sidebar.js"));
    await settle(); await settle();
    const row = (word) => w.document.querySelector(`.word-row[data-word="${word}"]`);

    assert.equal(w.document.querySelectorAll(".word-row").length, 3);
    assert.equal(row("pourtant").querySelector(".word-meaning").textContent, "yet, however",
      "A word already in the cache reads immediately");
    assert.equal(sent.filter((item) => item.type === "translate-selection").length, 0,
      "Opening the list must not spend a request");

    // Already in the vocabulary: the add is withdrawn, not merely disabled.
    assert.equal(row("connu").querySelector(".word-saved").textContent, "Saved ✓");
    assert.equal(row("connu").querySelector(".word-save"), null,
      "A word already saved offers no way to save it again");
    assert.equal(w.document.getElementById("wordCount").textContent, "2",
      "The badge counts only what can still be added");

    // One click on a word never looked up: it resolves the meaning and saves.
    row("compris").querySelector(".word-save").click();
    await settle(); await settle();
    const order = sent.filter((item) => ["translate-selection", "add-vocabulary"].includes(item.type)).map((item) => item.type);
    assert.deepEqual(order, ["translate-selection", "add-vocabulary"],
      "Saving an unlooked-up word fetches its meaning first, in one action");
    const entry = sent.find((item) => item.type === "add-vocabulary").entry;
    assert.equal(entry.translatedText, "understood");
    assert.equal(entry.sentence, "Je n'ai pas compris", "A saved word carries the line it came from");
    assert.equal(entry.timeMs, 2000);
    assert.equal(row("compris").querySelector(".word-saved").textContent, "Saved ✓");
    assert.equal(row("compris").querySelector(".word-save"), null);

    // The context-aware query reaches the lookup, not the bare surface form.
    const lookup = sent.find((item) => item.type === "translate-selection");
    assert.equal(lookup.lookupText, "j'ai compris");
    assert.equal(lookup.readingKey, "verb:comprendre");
    assert.equal(lookup.context, "Je n'ai pas compris");
  } finally { w.close(); }
}

// A save that storage refuses must not look like a save that worked.
async function wordListSaveFailure() {
  const dom = page("sidebar/sidebar.html"), w = dom.window;
  w.browser = {
    runtime: {
      getURL: (value) => "https://extension.test/" + value,
      async sendMessage(payload) {
        if (payload.type === "peek-word-meanings") return { ok: true, meanings: payload.words.map(() => ({ translatedText: "yet", saved: false })) };
        if (payload.type === "add-vocabulary") return { ok: false, error: "Vocabulary is full (2,000 words)." };
        return { ok: true };
      }
    },
    storage: { onChanged: event, sync: { async get() { return {}; }, async set() {} } },
    tabs: { onActivated: event, onUpdated: event, query: async () => [{ id: 1, url: "https://www.youtube.com/watch?v=one" }],
      sendMessage: async () => ({ ok: true, videoId: "one", title: "French", revision: "one:1", currentCueIndex: 0,
        studyWords: [{ word: "pourtant", count: 3, cueIndex: 0, state: "unknown", lookupText: "pourtant", readingKey: "", label: "adverb" }],
        cues: [{ index: 0, text: "Pourtant tout allait bien", translation: "Yet all was well", start: 0 }] })
    }
  };
  try {
    w.eval(read("shared/practice.js")); w.eval(read("sidebar/word-list.js")); w.eval(read("sidebar/sidebar.js"));
    await settle(); await settle();
    const row = w.document.querySelector('.word-row[data-word="pourtant"]');
    row.querySelector(".word-save").click();
    await settle(); await settle();
    assert.equal(row.querySelector(".word-saved"), null, "A refused save must not report success");
    assert.equal(row.querySelector(".word-save").textContent, "Save");
    assert.match(row.querySelector(".word-meaning").textContent, /full/, "and must say why it failed");
  } finally { w.close(); }
}

// In a tab, "the active tab in this window" is this page, so asking that
// question would leave it permanently empty. It follows an explicit id.
async function sidebarTabMode() {
  const dom = page("sidebar/sidebar.html", "?followTab=7"), w = dom.window;
  let queried = 0;
  let living = true;
  const addressed = [];
  w.browser = {
    runtime: { getURL: (value) => "https://extension.test/" + value, async sendMessage() { return { ok: true, meanings: [] }; } },
    storage: { onChanged: event, sync: { async get() { return {}; }, async set() {} } },
    tabs: {
      onActivated: event, onUpdated: event,
      async query() { queried += 1; return [{ id: 1, url: "https://www.youtube.com/watch?v=other" }]; },
      async get(id) {
        if (!living) throw new Error("No tab with id " + id);
        return { id, url: "https://www.youtube.com/watch?v=followed" };
      },
      async sendMessage(id, message) {
        addressed.push(id);
        if (message.type !== "get-transcript-state") return { ok: true };
        return { ok: true, videoId: "followed", title: "Followed video", revision: "f:1", currentCueIndex: 0, studyWords: [],
          cues: [{ index: 0, text: "Bonjour", translation: "Hello", start: 0 }] };
      },
      async create() {}
    }
  };
  try {
    w.eval(read("shared/practice.js")); w.eval(read("sidebar/word-list.js")); w.eval(read("sidebar/sidebar.js"));
    await settle(); await settle();
    assert.equal(w.document.body.dataset.mode, "tab", "Tab mode lays itself out differently");
    assert.equal(queried, 0, "Tab mode must never ask which tab is in front");
    assert(addressed.every((id) => id === 7), "Tab mode talks only to the tab it was given");
    assert.equal(w.document.getElementById("videoTitle").textContent, "Followed video");
    assert.equal(w.document.getElementById("reconnect").hidden, true);

    // When the followed tab goes, say so rather than silently following another.
    living = false;
    await w.refresh();
    await settle();
    assert.equal(w.document.getElementById("reconnect").hidden, false, "A lost video tab is reported");
    assert.equal(queried, 0, "and is never replaced behind the user's back");
  } finally { w.close(); }
}

async function popup() {
  const dom = page("popup/popup.html"), w = dom.window;
  const stored = { settings: { enabled: true, bottomOffset: 72, pronunciationVoiceURI: "voice-from-other-device" } };
  const changeListeners = [];
  const writes = [];
  w.speechSynthesis = {
    // This machine has no French voice installed, unlike the one that chose it.
    getVoices: () => [],
    addEventListener() {}, removeEventListener() {}, cancel() {}, speak() {}
  };
  w.browser = {
    runtime: {
      getURL: (value) => "https://extension.test/" + value,
      async sendMessage(message) {
        if (message.type === "get-default-settings") return { settings: w.DualSubSettings.defaults };
        if (message.type === "get-provider-secrets") return { ok: true, secrets: { azureRegion: "", libreEndpoint: "" } };
        if (message.type === "get-translation-cache-stats") return { ok: true, cache: { entries: 0 } };
        if (message.type === "get-vocabulary") return { ok: true, entries: [] };
        return { ok: true };
      }
    },
    tabs: { async query() { return []; }, async sendMessage() { return { ok: true }; }, async create() {} },
    storage: {
      onChanged: { addListener(fn) { changeListeners.push(fn); } },
      sync: {
        async get() { return structuredClone(stored); },
        async set(values) { writes.push(structuredClone(values.settings)); Object.assign(stored, structuredClone(values)); }
      }
    }
  };
  try {
    w.eval(read("popup/popup.js"));
    await settle(); await settle();
    assert.equal(w.document.getElementById("enabled").checked, true);

    // The switch is drawn by an empty span, so without an explicit name a
    // screen reader announces only "checkbox, checked" for the main control.
    const master = w.document.getElementById("enabled");
    const accessibleName = master.getAttribute("aria-label")
      || w.document.querySelector(`label[for="${master.id}"]`)?.textContent.trim()
      || master.closest("label")?.textContent.trim();
    assert(accessibleName, "The master switch needs an accessible name");
    assert(/dualsub/i.test(accessibleName), "and it should say what it controls");

    // Alt+Shift+D on the YouTube tab turns DualSub off while this page is open.
    stored.settings = { ...stored.settings, enabled: false };
    changeListeners.forEach((fn) => fn({ settings: { newValue: structuredClone(stored.settings) } }, "sync"));
    await settle();
    assert.equal(w.document.getElementById("enabled").checked, false, "An external settings change is reflected in the form");

    const offset = w.document.getElementById("bottomOffset");
    offset.value = "90";
    offset.dispatchEvent(new w.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const written = writes[writes.length - 1];
    assert.equal(written.bottomOffset, 90, "The edited setting is saved");
    assert.equal(written.enabled, false, "Editing one setting must not revive a stale value for another");
    // The chosen voice lives in sync storage and belongs to another device, so
    // a machine that cannot offer it must not blank the preference.
    assert.equal(written.pronunciationVoiceURI, "voice-from-other-device", "An unavailable voice preference is preserved");
    const voiceSelect = w.document.getElementById("pronunciationVoiceURI");
    assert.equal(voiceSelect.value, "voice-from-other-device");
    assert.equal(voiceSelect.selectedOptions[0].disabled, true, "The unavailable voice is shown but cannot be chosen here");

    // Choosing the default explicitly must still be saved.
    voiceSelect.value = "";
    voiceSelect.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(writes[writes.length - 1].pronunciationVoiceURI, "", "Explicitly choosing the default voice is saved");

    // Falling back to another engine is one switch per translation location: a
    // subtitle is read once, but a word lookup is saved and studied.
    assert.equal(w.document.getElementById("fallbackSubtitles").checked, true, "Subtitles may finish on another engine by default");
    assert.equal(w.document.getElementById("fallbackTranslator").checked, true);
    const studiedWords = w.document.getElementById("fallbackLookups");
    assert.equal(studiedWords.checked, false, "Studied words stay on the chosen engine until this is switched on");
    studiedWords.checked = true;
    studiedWords.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(writes[writes.length - 1].translationFallback, { subtitles: true, lookups: true, translator: true },
      "Every location is written, so editing one switch cannot drop the others");

    // Cheapest first is only a default, so the order is a list the reader can
    // rearrange. Dragging cannot be exercised here — jsdom has no drag-and-drop
    // — so the buttons that exist for keyboard and touch carry the test, and the
    // rows are checked to be draggable at all.
    const engineOrder = () => Array.from(w.document.querySelectorAll("#fallbackOrder li")).map((row) => row.dataset.provider);
    assert.deepEqual(engineOrder(), ["google", "mymemory", "libretranslate", "azure", "deepl"], "The list starts cheapest first");
    assert.equal(w.document.querySelector("#fallbackOrder li").draggable, true, "Rows can be dragged");
    w.document.querySelector('#fallbackOrder li[data-provider="deepl"] [data-move="up"]').click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.deepEqual(engineOrder(), ["google", "mymemory", "libretranslate", "deepl", "azure"],
      "Moving an engine up swaps it with the one above");
    assert.deepEqual(writes[writes.length - 1].translationFallbackOrder, ["google", "mymemory", "libretranslate", "deepl", "azure"],
      "and the whole order is saved, not just the moved engine");

    // The engine at the top has nothing to swap with, so its up button must not
    // be offerable: a control that silently does nothing is worse than none.
    assert.equal(w.document.querySelector('#fallbackOrder li[data-provider="google"] [data-move="up"]').disabled, true);
    assert.equal(w.document.querySelector('#fallbackOrder li[data-provider="azure"] [data-move="down"]').disabled, true);
  } finally { w.close(); }
}

async function vocabulary() {
  const dom = page("vocabulary/vocabulary.html"), w = dom.window;
  const entries = ["vais", "allait"].map((word, index) => ({ id: String(index), sourceText: word, translatedText: "go", normalized: word,
    sourceLanguage: "fr", targetLanguage: "en", lemma: "aller", sentence: "Je vais", reviewLapses: index === 0 ? 5 : 1,
    contexts: [{ videoId: "first", sentence: "Je vais", timeMs: 1000 }, { videoId: "second", sentence: "Il allait", timeMs: 2000 }] }));
  let reviews = 0;
  w.browser = {
    runtime: { async sendMessage(message) {
      if (message.type === "review-vocabulary") { reviews++; return { ok: true }; }
      return { ok: true, entries };
    } },
    storage: { sync: { async get() { return { settings: { pronunciationVoiceURI: "fr-chosen", pronunciationRate: 0.6 } }; } } }
  };
  try {
    w.eval(read("vocabulary/vocabulary.js")); await settle();
    assert.equal(w.document.querySelectorAll(".word-card").length, 2);
    assert.equal(w.document.querySelectorAll('.word-context details a').length, 4);
    const group = w.document.getElementById("groupLemmas"); group.checked = true; group.dispatchEvent(new w.Event("change"));
    assert.equal(w.document.querySelectorAll("#wordList > section").length, 1);
    assert.equal(w.document.querySelector("#wordList h2").textContent, "aller");
    assert.equal(w.document.getElementById("wordList").hasAttribute("aria-live"), false,
      "The word list must not re-announce itself on every search keystroke");
    // Lapses were counted, persisted and merged, but never shown anywhere. A
    // word failed repeatedly is the most useful signal a review system has.
    const flagged = w.document.querySelectorAll(".word-lapses");
    assert.equal(flagged.length, 1, "A repeatedly failed word is flagged, an occasional lapse is not");
    assert(/5/.test(flagged[0].textContent), "and the flag says how many times");
    w.document.getElementById("reviewButton").click();
    const mode = w.document.getElementById("reviewMode"); mode.value = "reverse"; mode.dispatchEvent(new w.Event("change"));
    w.document.getElementById("revealAnswer").click();
    assert.equal(w.document.getElementById("reviewTranslation").textContent, "vais");
    // Reveal hides the button that was just pressed and disables the textarea,
    // both of which can hold focus, so focus fell out of the modal and the
    // Tab trap could no longer recognise it.
    assert(w.document.getElementById("reviewModal").contains(w.document.activeElement),
      "Focus stays inside the review dialog after revealing");
    assert.equal(w.document.activeElement.dataset.rating, "again", "and lands on the first rating");
    const rating = w.document.querySelector('[data-rating="good"]'); rating.click(); rating.click(); await settle();
    assert.equal(reviews, 1, "Repeated clicks submit a review only once");


    // Review pronunciation must honour the voice and speed chosen in settings
    // rather than always asking for a generic fr-FR voice at a fixed rate.
    let spoken = null;
    const frenchVoice = { voiceURI: "fr-chosen", name: "Amelie", lang: "fr-CA", localService: true };
    w.speechSynthesis = { getVoices: () => [frenchVoice], cancel() {}, speak: (utterance) => { spoken = utterance; },
      addEventListener() {}, removeEventListener() {} };
    w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    w.DualSubSettings = w.DualSubSettings || {};
    w.document.getElementById("speakReview").click();
    await settle();
    assert(spoken, "The review speaks the French word");
    assert.equal(spoken.voice, frenchVoice, "The installed French voice is used");
    assert.equal(spoken.rate, 0.6, "The configured pronunciation speed is used");

    const files = [];
    // The download link would make jsdom attempt a navigation.
    w.HTMLAnchorElement.prototype.click = function () {};
    const RealBlob = w.Blob;
    w.Blob = class extends RealBlob {
      constructor(parts, options) { super(parts, options); files.push(String(parts[0])); }
    };
    w.URL.createObjectURL = () => "blob:one";
    w.URL.revokeObjectURL = () => {};
    w.document.getElementById("exportCsv").click();
    const csv = files[files.length - 1];
    // Excel on Windows reads a BOM-less UTF-8 file as ANSI and mangles accents.
    assert.equal(csv.charCodeAt(0), 0xfeff, "The CSV starts with a byte-order mark");
    assert(csv.includes('"vais"'));

    // Rating a word "again" used to advance past it. The next due date is ten
    // minutes out, so the session always ended first and the corrective
    // repetition never happened, making "again" behave like "skip".
    mode.value = "forward";
    mode.dispatchEvent(new w.Event("change"));
    assert(w.document.getElementById("reviewProgress").textContent.endsWith("/ 2"), "Two words are queued");
    const failed = w.document.getElementById("reviewTitle").textContent;
    w.document.getElementById("revealAnswer").click();
    w.document.querySelector('[data-rating="again"]').click();
    await settle();
    assert(w.document.getElementById("reviewProgress").textContent.endsWith("/ 3"),
      "A failed word is added back to the session");
    assert.equal(w.document.getElementById("reviewTitle").textContent, failed,
      "and it is shown again before the session ends");
  } finally { w.close(); }
}

async function loader() {
  const dom = page("sidebar/sidebar.html"), w = dom.window;
  try {
    w.eval(read("content/caption-loader.js"));
    let calls = 0;
    const loader = w.DualSubCaptionLoader.create({ requestCaptionFromPage: async () => "", sendMessage: async () => { calls++; return { ok: true, text: "valid caption" }; } });
    assert.equal(await loader.requestCaptionPayload("test"), "valid caption");
    assert.equal(await loader.requestCaptionPayload("test"), "valid caption");
    assert.equal(calls, 1);
    w.eval(read("content/lookup-view.js"));
    const view = w.DualSubLookupView.create();
    assert.equal(view.querySelectorAll('[data-action="save"]').length, 1);
  } finally { w.close(); }
}

async function content(cachedSnapshot = null, frenchText = "Je vais bien", options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div class="html5-video-player"><video></video></div></body></html>', {
    url: "https://www.youtube.com/watch?v=one", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole
  });
  const w = dom.window;
  const observers = [];
  w.MutationObserver = class extends w.MutationObserver {
    constructor(callback) { super(callback); observers.push(this); }
  };
  let listener;
  let savedSnapshot = null;
  let snapshotWrites = 0;
  let captionRequests = 0;
  let translationBatches = 0;
  let paused = true;
  let captureFailed = false;
  let captures = 0;
  let batchFailure = options.batchFailure || null;
  const video = w.document.querySelector("video");
  video.getBoundingClientRect = () => ({ left: 0, top: 0, right: 640, bottom: 360 });
  w.HTMLElement.prototype.setPointerCapture = function () {};
  Object.defineProperty(video, "paused", { get: () => paused });
  video.play = async () => { paused = false; video.dispatchEvent(new w.Event("play")); };
  video.pause = () => { paused = true; video.dispatchEvent(new w.Event("pause")); };
  w.browser = {
    runtime: { getURL: (value) => "https://extension.test/" + value, onMessage: { addListener(fn) { listener = fn; } },
      getManifest: () => ({ version: "0.0.0-test" }),
      async sendMessage(message) {
        if (message.type === "complete-video-ocr-selection") {
          captures++;
          assert(w.document.documentElement.classList.contains("dualsub-ocr-active"), "Subtitles stay hidden through screenshot capture");
          if (captureFailed) return { ok: false, error: "Capture failed" };
          await listener({ type: "show-video-ocr-popup" });
          return { ok: true };
        }
        if (message.type === "get-video-caption-cache") return { ok: true, snapshot: cachedSnapshot };
        if (message.type === "save-video-caption-cache") { snapshotWrites++; savedSnapshot = structuredClone(message.snapshot); return { ok: true }; }
        if (message.type === "translate-batch") {
          translationBatches++;
          if (batchFailure) { const failure = batchFailure; batchFailure = null; return failure; }
          return { ok: true, results: (message.items || []).map((item) => ({ translatedText: `${item.text} [en]`, provider: "google" })) };
        }
        if (message.type === "translate-selection") return { ok: true, translatedText: message.lookupText === "tu l'as" ? "you have it" : "the ace", provider: "google" };
        if (message.type === "fetch-captions") {
          captionRequests++;
          return { ok: true, text: JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: message.url.includes("lang=fr") ? frenchText : "I am well" }] }] }) };
        }
        return { ok: true, states: {}, profile: null };
      }
    },
    storage: { onChanged: event, sync: { async get() { return { settings: { preloadVideoWords: false, ...options.settings } }; } } }
  };
  w.fetch = async () => ({ ok: true, json: async () => ({ as: "nv" }) });
  try {
    w.eval(read("language/french.js"));
    await w.DualSubFrench.ready;
    const manifest = JSON.parse(read("manifest.json"));
    for (const script of manifest.content_scripts[0].js.filter((file) => !file.startsWith("vendor/") && !file.startsWith("language/"))) w.eval(read(script));
    await settle();
    w.dispatchEvent(new w.CustomEvent("dualsub:tracks", { detail: JSON.stringify({ ok: true, videoId: "one", tracks: [
      { languageCode: "fr", baseUrl: "https://www.youtube.com/api/timedtext?lang=fr" },
      { languageCode: "en", baseUrl: "https://www.youtube.com/api/timedtext?lang=en" }
    ] }) }));
    await settle(); await settle();
    const state = await listener({ type: "get-transcript-state" });
    assert.equal(state.cues[0].text, frenchText);
    if (cachedSnapshot) {
      assert.equal(captionRequests, 0, "Refreshing a cached video skips caption downloads");
      if (cachedSnapshot.targetCues?.length || cachedSnapshot.translations?.length) {
        assert.equal(translationBatches, 0, "Saved translations are seeded before scheduling provider requests");
      }
    } else assert(captionRequests > 0);
    if (frenchText === "Tu l'as") {
      video.currentTime = 1.1;
      await video.play();
      await new Promise((resolve) => w.requestAnimationFrame(resolve));
      const word = w.document.querySelector('.dualsub-word[data-word="as"]');
      assert(word, "The elided verb token must be available for lookup");
      word.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await settle(); await settle();
      assert.equal(w.document.querySelector(".dualsub-card-group").textContent, "Verb");
      assert.equal(w.document.querySelector(".dualsub-card-result").textContent, "you have it");
      // Escape has to work from wherever focus actually is. The overlay-scoped
      // handler stopped working as soon as a caption change dropped focus to
      // the body, leaving the mouse as the only way out of the card.
      w.document.body.focus();
      w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await settle();
      assert.equal(w.document.querySelector(".dualsub-selection-card").classList.contains("is-visible"), false,
        "Escape closes the lookup card from anywhere on the page");
    }
    if (options.overlayScale) {
      const player = w.document.querySelector(".html5-video-player");
      const overlay = w.document.querySelector(".dualsub-root");
      const scale = () => Number(overlay.style.getPropertyValue("--dualsub-scale"));
      const setPlayerHeight = (value) => {
        Object.defineProperty(player, "clientHeight", { value, configurable: true });
        w.document.dispatchEvent(new w.Event("fullscreenchange"));
        return new Promise((resolve) => setTimeout(resolve, 80));
      };
      // Captions are authored against a 720px-tall player. A caption that is
      // right at that size is unreadably small on a 4K fullscreen player and
      // fills the frame in a mini player, so the overlay has to scale.
      await setPlayerHeight(720);
      assert.equal(scale(), 1, "The reference player size renders the authored size");
      await setPlayerHeight(1440);
      assert.equal(scale(), 2, "A player twice the reference height doubles the caption");
      await setPlayerHeight(225);
      assert(scale() > 0 && scale() < 1, "A mini player shrinks the caption");
      assert(scale() >= 0.6, "Shrinking stops before the caption becomes unreadable");
      await setPlayerHeight(4320);
      assert(scale() <= 2.2, "Growth is capped so the caption cannot swallow the frame");
      // The size must sit on the block, because the width cap is in ch units
      // and would otherwise resolve against YouTube's font size, not the
      // caption's, making every line about half as wide as intended.
      const block = w.document.querySelector(".dualsub-source");
      assert(block.style.fontSize.includes("--dualsub-scale"), "The caption size is set on the block that the width cap measures");
      assert.equal(w.document.querySelector(".dualsub-source .dualsub-line-text").style.fontSize, "",
        "and not duplicated onto the inline plate");
    }
    if (options.pauseOnLookup) {
      video.currentTime = 1.1;
      await video.play();
      await new Promise((resolve) => w.requestAnimationFrame(resolve));
      w.document.querySelector(".dualsub-source .dualsub-word").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await settle(); await settle();
      assert.equal(w.document.querySelector(".dualsub-selection-card").classList.contains("is-visible"), true);
      assert.equal(paused, true, "Opening a lookup pauses playback when that setting is on");
      // The reader resumes, then pauses again themselves. Closing the card must
      // not override a pause the card did not cause.
      await video.play();
      video.pause();
      await settle();
      w.document.querySelector('.dualsub-selection-card [data-action="close"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await settle(); await settle();
      assert.equal(paused, true, "Closing the lookup must not restart a video the reader paused");

      let voiceRequests = 0;
      let spoken = null;
      const voices = [];
      w.speechSynthesis = {
        getVoices: () => { voiceRequests++; return voices; },
        cancel() {},
        speak: (utterance) => { spoken = utterance; },
        addEventListener: (name, handler) => {
          // Firefox often reports an empty list on the first call and fills it
          // asynchronously, which sent readers to the voice-setup page.
          if (name === "voiceschanged") setTimeout(() => { voices.push({ voiceURI: "fr1", name: "Amelie", lang: "fr-FR", localService: true }); handler(); }, 0);
        },
        removeEventListener() {}
      };
      w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      w.document.querySelector(".dualsub-source .dualsub-word").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await settle(); await settle();
      w.document.querySelector('.dualsub-selection-card [data-action="speak"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await settle();
      assert(voiceRequests > 1, "An empty first voice list should be retried");
      assert(spoken, "The word is pronounced once the voice list arrives");
      assert.equal(spoken.voice.lang, "fr-FR");
    }
    if (options.aheadTranslation) {
      const lineText = (selector) => w.document.querySelector(`${selector} .dualsub-line-text`).textContent;
      const isVisible = (selector) => w.document.querySelector(selector).classList.contains("is-visible");
      video.currentTime = 1.5;
      await video.play();
      await new Promise((resolve) => w.requestAnimationFrame(resolve));
      assert.equal(lineText(".dualsub-source"), frenchText);
      assert.equal(lineText(".dualsub-target"), "I am well");
      // The French line is held for captionHoldMs past the cue end. English is
      // supplied separately in this mode and must be held for the same window.
      video.currentTime = 2.6;
      await new Promise((resolve) => w.requestAnimationFrame(resolve));
      assert.equal(isVisible(".dualsub-source"), true, "French is still held after the cue ends");
      assert.equal(lineText(".dualsub-target"), "I am well", "English must not blink off before French");
      video.pause();
    }
    if (options.recoverAfterFailedBatch) {
      video.currentTime = 1.2;
      await video.play();
      await new Promise((resolve) => w.requestAnimationFrame(resolve));
      await settle(); await settle();
      const afterFailure = (await listener({ type: "get-diagnostics" })).diagnostics;
      assert(afterFailure.translationLastError, "The failed batch is reported in diagnostics");
      assert.equal((await listener({ type: "get-transcript-state" })).cues[0].translation, "");

      // A provider that recovers must be allowed to fill the lines that failed
      // while it was down, instead of leaving them blank for the whole video.
      const realDateNow = w.Date.now;
      const realPerformanceNow = w.performance.now.bind(w.performance);
      w.Date.now = () => realDateNow() + 60_000;
      w.performance.now = () => realPerformanceNow() + 60_000;
      try {
        video.currentTime = 1.3;
        await new Promise((resolve) => w.requestAnimationFrame(resolve));
        await settle(); await settle();
      } finally {
        w.Date.now = realDateNow;
        w.performance.now = realPerformanceNow;
      }
      const recovered = (await listener({ type: "get-transcript-state" })).cues[0];
      assert.equal(recovered.translation, `${frenchText} [en]`, "A recovered provider refills previously failed lines");
      video.pause();
    }
    assert.equal((await listener({ type: "start-practice", mode: "dictation", first: 0, last: 0 })).ok, true);
    assert.equal(w.document.documentElement.classList.contains("dualsub-dictation"), true);
    const captionsHidden = () => w.document.documentElement.classList.contains("dualsub-ocr-active");
    assert.equal((await listener({ type: "start-video-ocr-selection" })).ok, true);
    assert.equal(captionsHidden(), true);
    w.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(captionsHidden(), false, "Escape restores captions");
    for (const fail of [false, true]) {
      captureFailed = fail;
      await listener({ type: "start-video-ocr-selection" });
      const overlay = w.document.querySelector(".dualsub-ocr-selector");
      overlay.dispatchEvent(new w.MouseEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
      overlay.dispatchEvent(new w.MouseEvent("pointerup", { clientX: 110, clientY: 60, button: 0 }));
      assert.equal(captionsHidden(), true);
      await new Promise((resolve) => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
      await settle();
      assert.equal(captionsHidden(), !fail, "Only the open result window keeps captions hidden");
      await listener({ type: "hide-video-ocr-popup" });
      assert.equal(captionsHidden(), false);
    }
    assert.equal(captures, 2);
    w.dispatchEvent(new w.Event("pagehide"));
    await settle();
    assert(savedSnapshot);
    const writesBeforeClear = snapshotWrites;
    await listener({ type: "invalidate-video-caption-cache" });
    w.dispatchEvent(new w.Event("pagehide"));
    await settle();
    assert.equal(snapshotWrites, writesBeforeClear, "Cleared snapshots are not restored by pagehide");
    w.document.dispatchEvent(new w.Event("yt-navigate-start"));
    assert.equal(captionsHidden(), false);
    assert.equal(w.document.documentElement.classList.contains("dualsub-dictation"), false);
    assert.equal((await listener({ type: "get-transcript-state" })).practice, null);
    assert(savedSnapshot, "Timed captions are persisted before navigation clears them");
    return savedSnapshot;
  } finally { observers.forEach((observer) => observer.disconnect()); w.close(); }
}

(async () => {
  await sidebar(); await wordList(); await wordListSaveFailure(); await sidebarTabMode(); await popup(); await vocabulary(); await loader();
  const snapshot = await content();
  await content(snapshot);
  await content({ ...snapshot, targetCues: [], translations: [{ index: 0, text: "I am well" }] });
  await content({ ...snapshot, targetCues: [], translations: [{ index: 0, text: "I am well" }] },
    "Je vais bien", { aheadTranslation: true });
  await content({ ...snapshot, targetCues: [], translations: [] }, "Je vais bien",
    { recoverAfterFailedBatch: true, batchFailure: { ok: false, error: "Google translation failed (HTTP 400).", errorCode: "PROVIDER_REQUEST_FAILED" } });
  await content(null, "Tu l'as");
  await content(snapshot, "Je vais bien", { pauseOnLookup: true, settings: { pauseOnLookup: true, hoverLookup: false } });
  await content(snapshot, "Je vais bien", { overlayScale: true });
  console.log("DualSub UI tests passed");
})()
  .catch((error) => { console.error(error); process.exitCode = 1; });
