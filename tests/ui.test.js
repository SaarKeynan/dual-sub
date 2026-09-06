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

function page(file) {
  const dom = new JSDOM(read(file), { url: "https://extension.test/" + file, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.alert = (message) => { throw new Error(message); };
  dom.window.eval(read("shared/settings.js"));
  return dom;
}

async function sidebar() {
  const dom = page("sidebar/sidebar.html"), w = dom.window;
  let practice = null;
  w.browser = {
    runtime: { getURL: (value) => "https://extension.test/" + value },
    tabs: { onActivated: event, onUpdated: event, query: async () => [{ id: 1, url: "https://www.youtube.com/watch?v=one" }],
      sendMessage: async (_id, message) => {
        if (message.type === "start-practice") { practice = { mode: message.mode, revealed: false }; return { ok: true }; }
        if (message.type === "stop-practice") { practice = null; return { ok: true }; }
        if (message.type === "reveal-dictation") { practice.revealed = true; return { ok: true, answer: "Je vais bien" }; }
        return { ok: true, videoId: "one", title: "French", revision: "one:1", currentCueIndex: 0, cues: [{ index: 0, text: "Je vais bien", translation: "I am well", start: 1000 }], practice,
          session: { encountered: 3, saved: 1, words: ["je", "vais", "bien"] } };
      }
    }
  };
  try {
    w.eval(read("shared/practice.js")); w.eval(read("sidebar/sidebar.js")); await settle();
    assert.equal(w.document.querySelectorAll(".cue").length, 1);
    w.document.getElementById("startDictation").click(); await settle();
    assert.equal(w.document.querySelector(".transcript-panel").hidden, true);
    assert.equal(w.document.getElementById("dictationPanel").hidden, false);
    w.document.getElementById("dictationAnswer").value = "je va bien";
    w.document.getElementById("checkDictation").click(); await settle();
    assert.equal(w.document.querySelector(".transcript-panel").hidden, false);
    assert.equal(w.document.querySelectorAll(".answer-replace").length, 1);
    w.document.getElementById("stopPractice").click(); await settle();
    assert.equal(w.document.getElementById("dictationPanel").hidden, true);
  } finally { w.close(); }
}

async function vocabulary() {
  const dom = page("vocabulary/vocabulary.html"), w = dom.window;
  const entries = ["vais", "allait"].map((word, index) => ({ id: String(index), sourceText: word, translatedText: "go", normalized: word,
    sourceLanguage: "fr", targetLanguage: "en", lemma: "aller", sentence: "Je vais", contexts: [{ videoId: "first", sentence: "Je vais", timeMs: 1000 }, { videoId: "second", sentence: "Il allait", timeMs: 2000 }] }));
  let reviews = 0;
  w.browser = { runtime: { async sendMessage(message) {
    if (message.type === "review-vocabulary") { reviews++; return { ok: true }; }
    return { ok: true, entries };
  } } };
  try {
    w.eval(read("vocabulary/vocabulary.js")); await settle();
    assert.equal(w.document.querySelectorAll(".word-card").length, 2);
    assert.equal(w.document.querySelectorAll('.word-context details a').length, 4);
    const group = w.document.getElementById("groupLemmas"); group.checked = true; group.dispatchEvent(new w.Event("change"));
    assert.equal(w.document.querySelectorAll("#wordList > section").length, 1);
    assert.equal(w.document.querySelector("#wordList h2").textContent, "aller");
    w.document.getElementById("reviewButton").click();
    const mode = w.document.getElementById("reviewMode"); mode.value = "reverse"; mode.dispatchEvent(new w.Event("change"));
    w.document.getElementById("revealAnswer").click();
    assert.equal(w.document.getElementById("reviewTranslation").textContent, "vais");
    const rating = w.document.querySelector('[data-rating="good"]'); rating.click(); rating.click(); await settle();
    assert.equal(reviews, 1, "Repeated clicks submit a review only once");
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

async function content(cachedSnapshot = null, frenchText = "Je vais bien") {
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
  const video = w.document.querySelector("video");
  video.getBoundingClientRect = () => ({ left: 0, top: 0, right: 640, bottom: 360 });
  w.HTMLElement.prototype.setPointerCapture = function () {};
  Object.defineProperty(video, "paused", { get: () => paused });
  video.play = async () => { paused = false; video.dispatchEvent(new w.Event("play")); };
  video.pause = () => { paused = true; video.dispatchEvent(new w.Event("pause")); };
  w.browser = {
    runtime: { getURL: (value) => "https://extension.test/" + value, onMessage: { addListener(fn) { listener = fn; } },
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
        if (message.type === "translate-batch") { translationBatches++; return { ok: true, results: [] }; }
        if (message.type === "translate-selection") return { ok: true, translatedText: message.lookupText === "tu l'as" ? "you have it" : "the ace", provider: "google" };
        if (message.type === "fetch-captions") {
          captionRequests++;
          return { ok: true, text: JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 1500, segs: [{ utf8: message.url.includes("lang=fr") ? frenchText : "I am well" }] }] }) };
        }
        return { ok: true, states: {}, profile: null };
      }
    },
    storage: { onChanged: event, sync: { async get() { return { settings: { preloadVideoWords: false } }; } } }
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
      assert.equal(translationBatches, 0, "Saved translations are seeded before scheduling provider requests");
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
  await sidebar(); await vocabulary(); await loader();
  const snapshot = await content();
  await content(snapshot);
  await content({ ...snapshot, targetCues: [], translations: [{ index: 0, text: "I am well" }] });
  await content(null, "Tu l'as");
  console.log("DualSub UI tests passed");
})()
  .catch((error) => { console.error(error); process.exitCode = 1; });
