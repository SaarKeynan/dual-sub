// Development-only: renders the overlay and the extension pages in the Chrome
// already installed on this machine, writes screenshots for visual review, and
// reports measurements a DOM-only test cannot produce.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const puppeteer = require("puppeteer-core");

const root = path.resolve(__dirname, "..");
const out = path.join(root, ".shots");
const CANDIDATES = [
  process.env.DUALSUB_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const chrome = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.error("No Chrome or Edge found. Set DUALSUB_CHROME to a browser executable.");
  process.exit(1);
}

const CAPTION = "Alors là, on fait un micro-trottoir sur TikTok et on demande aux gens.";
const TRANSLATION = "So here, we are doing a street interview about TikTok and asking people.";
const GROUPS = ["adverb", "unknown", "pronoun", "verb", "determiner", "noun", "preposition", "noun", "conjunction", "pronoun", "verb", "determiner", "noun"];

function overlayPage(css, settings) {
  const word = (text, index, extra = "") =>
    `<span class="dualsub-word${extra}" data-word-group="${GROUPS[index % GROUPS.length]}">${text}</span>`;
  return `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#000;font-family:Arial,sans-serif}
    .html5-video-player{position:relative;width:100%;height:100%;
      background:linear-gradient(135deg,#243347 0%,#7d93b4 40%,#efe0bd 100%)}
    ${css}
  </style>
  <div class="html5-video-player"><div class="dualsub-root"><div class="dualsub-stack">
    <div class="dualsub-status is-visible" data-state="${settings.state}"><span class="dualsub-status-text">${settings.status}</span></div>
    <div class="dualsub-line dualsub-source is-visible"><span class="dualsub-line-text">${
      CAPTION.split(" ").map((text, index) => word(text, index, index === 5 ? " is-hovered" : "")).join(" ")
    }</span></div>
    <div class="dualsub-line dualsub-target is-visible"><span class="dualsub-line-text">${
      TRANSLATION.split(" ").map((text, index) => index === 5
        ? `<span class="dualsub-word is-aligned" data-word-group="${GROUPS[5]}">${text}</span>`
        : `<span class="dualsub-word">${text}</span>`).join(" ")
    }</span></div>
  </div></div></div>
  <script>(() => {
    const overlay = document.querySelector(".dualsub-root");
    const player = document.querySelector(".html5-video-player");
    overlay.style.setProperty("--dualsub-bottom", "72px");
    overlay.style.setProperty("--dualsub-width", "${settings.maxWidth}%");
    overlay.style.setProperty("--dualsub-scale", String(Math.max(0.6, Math.min(2.2, player.clientHeight / 720))));
    const styles = { ".dualsub-source": ${JSON.stringify(settings.sourceStyle)}, ".dualsub-target": ${JSON.stringify(settings.targetStyle)} };
    for (const [selector, style] of Object.entries(styles)) {
      const block = document.querySelector(selector);
      const text = block.querySelector(".dualsub-line-text");
      block.style.fontSize = "calc(" + style.fontSize + "px * var(--dualsub-scale, 1))";
      if (selector === ".dualsub-source") document.querySelector(".dualsub-stack").style.fontSize = block.style.fontSize;
      const hex = style.backgroundColor.replace("#", "");
      text.style.color = style.textColor;
      text.style.backgroundColor = "rgba(" + parseInt(hex.slice(0,2),16) + "," + parseInt(hex.slice(2,4),16) + "," + parseInt(hex.slice(4,6),16) + "," + style.backgroundOpacity / 100 + ")";
      text.style.fontFamily = style.fontFamily;
      text.style.fontWeight = style.fontWeight;
    }
  })();</script>`;
}

const ENTRIES = [
  { id: "1", sourceText: "micro-trottoir", translatedText: "street interview", normalized: "micro-trottoir", sourceLanguage: "fr", targetLanguage: "en",
    sentence: "Alors là, on fait un micro-trottoir sur TikTok.", sentenceTranslation: "So here, we are doing a street interview about TikTok.",
    videoId: "abc123", videoTitle: "Micro-trottoir à Paris", timeMs: 793000, encounters: 3, stage: 1, reviews: 2, reviewLapses: 5, dueAt: Date.now() - 1000, createdAt: Date.now() - 90000000 },
  { id: "2", sourceText: "s’habiller", translatedText: "to get dressed", normalized: "s’habiller", sourceLanguage: "fr", targetLanguage: "en",
    sentence: "Il faut s’habiller avant de sortir.", sentenceTranslation: "You have to get dressed before going out.",
    videoId: "def456", videoTitle: "Routine du matin", timeMs: 120000, encounters: 1, stage: 4, reviews: 6, reviewLapses: 0, dueAt: Date.now() + 400000000, createdAt: Date.now() - 4000000, notes: "Reflexive: se + habiller" }
];

const stub = (page) => page.evaluateOnNewDocument((entries) => {
  const settings = { enabled: true, showSource: true, showTranslation: true, hideNativeCaptions: true, translationProvider: "azure" };
  window.browser = {
    runtime: {
      getURL: (value) => value,
      getManifest: () => ({ version: "0.9.1" }),
      onMessage: { addListener() {} },
      async sendMessage(message) {
        if (message.type === "get-default-settings") return { settings: window.DualSubSettings?.defaults || settings };
        if (message.type === "get-vocabulary") return { ok: true, entries };
        if (message.type === "get-provider-secrets") return { ok: true, secrets: { azureRegion: "westeurope", libreEndpoint: "" } };
        if (message.type === "get-translation-cache-stats") return { ok: true, cache: { entries: 1284 } };
        if (message.type === "get-word-states") return { ok: true, states: {} };
        // Some rows are warm from the cache, one is already saved, and the rest
        // are misses. That mix is what the list actually looks like in use.
        if (message.type === "peek-word-meanings") {
          const known = { trottoir: "pavement, sidewalk", gens: "people", pensent: "think" };
          return { ok: true, meanings: message.words.map((item) => ({
            translatedText: known[item.text] || "",
            saved: item.text === "gens"
          })) };
        }
        if (message.type === "translate-selection") return { ok: true, translatedText: "asks for" };
        return { ok: true };
      }
    },
    tabs: {
      onActivated: { addListener() {} }, onUpdated: { addListener() {} },
      async query() { return [{ id: 1, url: "https://www.youtube.com/watch?v=abc123" }]; },
      async get(id) { return { id, url: "https://www.youtube.com/watch?v=abc123" }; },
      async create() {}, async sendMessage(_id, message) {
        if (message.type === "get-status") return { state: "ready", message: "French + English active · full tracks loaded" };
        if (message.type === "get-transcript-state") {
          return { ok: true, videoId: "abc123", title: "Micro-trottoir à Paris", revision: "abc:1", currentCueIndex: 1,
            provider: "azure", studyMode: "study", coveragePercent: 62, bufferAheadSeconds: 74,
            session: { encountered: 48, saved: 3, words: [] },
            studyWords: [
              { word: "trottoir", count: 4, cueIndex: 1, state: "unknown", lookupText: "trottoir", readingKey: "", label: "noun" },
              { word: "gens", count: 3, cueIndex: 2, state: "unknown", lookupText: "gens", readingKey: "", label: "noun" },
              { word: "demande", count: 2, cueIndex: 2, state: "unknown", lookupText: "on demande", readingKey: "verb:demander", label: "verb · demander" },
              { word: "pensent", count: 2, cueIndex: 2, state: "unknown", lookupText: "ils pensent", readingKey: "verb:penser", label: "verb · penser" },
              { word: "aujourd’hui", count: 1, cueIndex: 0, state: "unknown", lookupText: "aujourd’hui", readingKey: "", label: "adverb" }
            ],
            cues: [
              { index: 0, start: 780000, text: "On est dans la rue aujourd’hui.", translation: "We are in the street today.", provenance: "Azure aligned" },
              { index: 1, start: 793000, text: "Alors là, on fait un micro-trottoir sur TikTok.", translation: "So here, we are doing a street interview about TikTok.", provenance: "Azure aligned", active: true },
              { index: 2, start: 799000, text: "Et on demande aux gens ce qu’ils en pensent.", translation: "And we ask people what they think of it.", provenance: "Azure aligned" }
            ] };
        }
        return { ok: true };
      }
    },
    storage: { onChanged: { addListener() {} }, sync: { async get() { return { settings }; }, async set() {} }, local: { async get() { return {}; }, async set() {}, async remove() {} } }
  };
}, ENTRIES);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "shared/settings.js"), "utf8"), context);
  const defaults = context.DualSubSettings.defaults;
  const css = fs.readFileSync(path.join(root, "content.css"), "utf8");

  const browser = await puppeteer.launch({ executablePath: chrome, headless: "new", args: ["--force-color-profile=srgb"] });
  const report = [];

  for (const [name, width, height, state, status] of [
    ["overlay-inline", 854, 480, "ready", "French + English ready (native English track)."],
    ["overlay-fullscreen", 1920, 1080, "error", "Azure rate limit reached. Translation will resume automatically."],
    ["overlay-mini", 400, 225, "loading", "Preparing English around the current position…"]
  ]) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log(`PAGE ERROR ${name}:`, error.message));
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(overlayPage(css, { ...defaults, state, status }), { waitUntil: "load" });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    report.push([name, await page.evaluate(() => {
      const measure = (selector) => {
        const node = document.querySelector(`${selector} .dualsub-line-text`);
        const rect = node.getBoundingClientRect();
        return `${Math.round(rect.width)}px / ${Math.round(rect.height / parseFloat(getComputedStyle(node).lineHeight))} rows`;
      };
      const player = document.querySelector(".html5-video-player");
      return {
        player: `${player.clientWidth}x${player.clientHeight}`,
        captionSize: getComputedStyle(document.querySelector(".dualsub-source")).fontSize,
        stack: `${Math.round(document.querySelector(".dualsub-stack").getBoundingClientRect().width)}px`,
        french: measure(".dualsub-source"),
        english: measure(".dualsub-target"),
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })]);
    await page.close();
  }

  for (const [name, file, width, height, click, scrollTo] of [
    ["popup", "popup/popup.html", 400, 640],
    ["popup-wide", "popup/popup.html", 1200, 900],
    ["vocabulary", "vocabulary/vocabulary.html", 1280, 900],
    ["sidebar", "sidebar/sidebar.html", 340, 900],
    // The word list is the study surface now, so it needs its own look.
    ["sidebar-words", "sidebar/sidebar.html", 340, 900, '[data-view="words"]'],
    ["sidebar-tab", "sidebar/sidebar.html?followTab=1", 1100, 760],
    // The per-location fallback switches sit behind a tab and a disclosure, so
    // reaching them takes two clicks.
    ["popup-translation", "popup/popup.html", 400, 900, ['[data-panel="general"]', "#panel-general section details:nth-of-type(2) summary"], ".fallback-group"],
    // The explanations open on hover, so they appear in no other shot. The last
    // click pins one open the way a tap does.
    ["popup-fallback-info", "popup/popup.html", 400, 900, ['[data-panel="general"]', "#panel-general section details:nth-of-type(2) summary", '[aria-describedby="fallbackLookupsInfo"]'], ".fallback-group"],
    ["help", "help/pronunciation.html", 900, 820]
  ]) {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log(`PAGE ERROR ${name}:`, error.message));
    await stub(page);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto("file:///" + path.join(root, file).replace(/\\/g, "/"), { waitUntil: "load" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    for (const selector of [].concat(click || [])) {
      await page.click(selector);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (scrollTo) {
      await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ block: "center" }), scrollTo);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    report.push([name, await page.evaluate(() => ({
      bodyFont: getComputedStyle(document.body).fontFamily.split(",")[0],
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      tiny: Array.from(document.querySelectorAll("*"))
        .filter((node) => node.children.length === 0 && node.textContent.trim() && parseFloat(getComputedStyle(node).fontSize) < 10).length
    }))]);
    await page.close();
  }

  await browser.close();
  for (const [name, values] of report) console.log(name, JSON.stringify(values));
})();
