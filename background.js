const DEFAULT_SETTINGS = {
  enabled: true,
  showSource: true,
  showTranslation: true,
  sourceLanguage: "fr",
  targetLanguage: "en",
  hideNativeCaptions: true,
  selectionTranslation: true,
  wholeLiveLines: true,
  hoverLookup: true,
  wordAlignment: true,
  pauseOnLookup: false,
  recallMode: false,
  autoPause: false,
  lookupCardPosition: "smart",
  hoverDelay: 420,
  captionOffsetMs: 0,
  translationProvider: "google",
  bottomOffset: 72,
  maxWidth: 88,
  mymemoryEmail: "",
  sourceStyle: {
    fontSize: 30,
    textColor: "#ffffff",
    backgroundColor: "#111827",
    backgroundOpacity: 82,
    fontFamily: "Arial, sans-serif",
    fontWeight: "700",
    italic: false
  },
  targetStyle: {
    fontSize: 25,
    textColor: "#fde68a",
    backgroundColor: "#111827",
    backgroundOpacity: 82,
    fontFamily: "Arial, sans-serif",
    fontWeight: "600",
    italic: false
  }
};

const translationCache = new Map();
const translationPending = new Map();
const VOCABULARY_KEY = "vocabulary";

async function getVocabulary() {
  const stored = await browser.storage.local.get(VOCABULARY_KEY);
  return Array.isArray(stored[VOCABULARY_KEY]) ? stored[VOCABULARY_KEY] : [];
}

function cleanVocabularyText(value, limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function vocabularyKey(value) {
  return cleanVocabularyText(value, 160).normalize("NFKC").toLocaleLowerCase();
}

async function addVocabularyEntry(rawEntry = {}) {
  const sourceText = cleanVocabularyText(rawEntry.sourceText, 160);
  const translatedText = cleanVocabularyText(rawEntry.translatedText, 300);
  if (!sourceText || !translatedText) throw new Error("A word and translation are required.");
  const now = Date.now();
  const vocabulary = await getVocabulary();
  const sourceLanguage = cleanVocabularyText(rawEntry.sourceLanguage, 20) || "fr";
  const targetLanguage = cleanVocabularyText(rawEntry.targetLanguage, 20) || "en";
  const normalized = vocabularyKey(sourceText);
  const existing = vocabulary.find((item) => (
    item.normalized === normalized &&
    item.sourceLanguage === sourceLanguage &&
    item.targetLanguage === targetLanguage
  ));
  const context = {
    sentence: cleanVocabularyText(rawEntry.sentence),
    sentenceTranslation: cleanVocabularyText(rawEntry.sentenceTranslation),
    videoId: cleanVocabularyText(rawEntry.videoId, 32),
    videoTitle: cleanVocabularyText(rawEntry.videoTitle, 240),
    timeMs: Math.max(0, Number(rawEntry.timeMs) || 0),
    notes: cleanVocabularyText(rawEntry.notes, 600)
  };

  if (existing) {
    Object.assign(existing, context, {
      translatedText,
      updatedAt: now,
      encounters: (Number(existing.encounters) || 1) + 1
    });
    await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
    return { entry: existing, added: false };
  }

  const entry = {
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    normalized,
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    ...context,
    createdAt: now,
    updatedAt: now,
    encounters: 1,
    stage: 0,
    reviews: 0,
    dueAt: now
  };
  vocabulary.unshift(entry);
  await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary.slice(0, 2000) });
  return { entry, added: true };
}

async function removeVocabularyEntry(id) {
  const vocabulary = await getVocabulary();
  const filtered = vocabulary.filter((item) => item.id !== id);
  await browser.storage.local.set({ [VOCABULARY_KEY]: filtered });
  return { removed: filtered.length !== vocabulary.length };
}

async function updateVocabularyEntry(id, updates = {}) {
  const vocabulary = await getVocabulary();
  const entry = vocabulary.find((item) => item.id === id);
  if (!entry) throw new Error("Vocabulary entry not found.");
  if (Object.prototype.hasOwnProperty.call(updates, "translatedText")) {
    const translatedText = cleanVocabularyText(updates.translatedText, 300);
    if (!translatedText) throw new Error("The translation cannot be empty.");
    entry.translatedText = translatedText;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "notes")) {
    entry.notes = cleanVocabularyText(updates.notes, 600);
  }
  entry.updatedAt = Date.now();
  await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
  return { entry };
}

async function reviewVocabularyEntry(id, rating) {
  const vocabulary = await getVocabulary();
  const entry = vocabulary.find((item) => item.id === id);
  if (!entry) throw new Error("Vocabulary entry not found.");
  const currentStage = Math.max(0, Math.min(6, Number(entry.stage) || 0));
  const nextStage = rating === "again"
    ? 0
    : rating === "hard"
      ? Math.max(0, currentStage - 1)
      : Math.min(6, currentStage + 1);
  const intervals = [0, 1, 3, 7, 14, 30, 90];
  entry.stage = nextStage;
  entry.reviews = (Number(entry.reviews) || 0) + 1;
  entry.lastReviewedAt = Date.now();
  entry.dueAt = Date.now() + intervals[nextStage] * 86400000;
  await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
  return { entry };
}

async function importVocabularyEntries(rawEntries) {
  if (!Array.isArray(rawEntries)) throw new Error("The backup does not contain a vocabulary list.");
  const vocabulary = await getVocabulary();
  const byKey = new Map(vocabulary.map((entry) => [
    `${entry.sourceLanguage}|${entry.targetLanguage}|${entry.normalized}`,
    entry
  ]));
  const usedIds = new Set(vocabulary.map((entry) => entry.id));
  let imported = 0;
  let updated = 0;
  for (const rawEntry of rawEntries.slice(0, 5000)) {
    const sourceText = cleanVocabularyText(rawEntry?.sourceText, 160);
    const translatedText = cleanVocabularyText(rawEntry?.translatedText, 300);
    if (!sourceText || !translatedText) continue;
    const sourceLanguage = cleanVocabularyText(rawEntry.sourceLanguage, 20) || "fr";
    const targetLanguage = cleanVocabularyText(rawEntry.targetLanguage, 20) || "en";
    const normalized = vocabularyKey(sourceText);
    const key = `${sourceLanguage}|${targetLanguage}|${normalized}`;
    const now = Date.now();
    let importedId = cleanVocabularyText(rawEntry.id, 80);
    if (!importedId || usedIds.has(importedId)) importedId = `${now}-${Math.random().toString(36).slice(2, 9)}`;
    const sanitized = {
      id: importedId,
      normalized,
      sourceText,
      translatedText,
      sourceLanguage,
      targetLanguage,
      sentence: cleanVocabularyText(rawEntry.sentence),
      sentenceTranslation: cleanVocabularyText(rawEntry.sentenceTranslation),
      videoId: cleanVocabularyText(rawEntry.videoId, 32),
      videoTitle: cleanVocabularyText(rawEntry.videoTitle, 240),
      timeMs: Math.max(0, Number(rawEntry.timeMs) || 0),
      createdAt: Math.max(0, Number(rawEntry.createdAt) || now),
      updatedAt: now,
      encounters: Math.max(1, Number(rawEntry.encounters) || 1),
      stage: Math.max(0, Math.min(6, Number(rawEntry.stage) || 0)),
      reviews: Math.max(0, Number(rawEntry.reviews) || 0),
      dueAt: Math.max(0, Number(rawEntry.dueAt) || now),
      lastReviewedAt: Math.max(0, Number(rawEntry.lastReviewedAt) || 0),
      notes: cleanVocabularyText(rawEntry.notes, 600)
    };
    const existing = byKey.get(key);
    if (existing) {
      Object.assign(existing, sanitized, { id: existing.id, createdAt: existing.createdAt || sanitized.createdAt });
      updated += 1;
    } else {
      vocabulary.push(sanitized);
      byKey.set(key, sanitized);
      usedIds.add(sanitized.id);
      imported += 1;
    }
  }
  vocabulary.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary.slice(0, 2000) });
  return { imported, updated, total: Math.min(vocabulary.length, 2000) };
}

async function getSettings() {
  const stored = await browser.storage.sync.get("settings");
  return mergeSettings(stored.settings);
}

function mergeSettings(value = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    sourceStyle: { ...DEFAULT_SETTINGS.sourceStyle, ...(value.sourceStyle || {}) },
    targetStyle: { ...DEFAULT_SETTINGS.targetStyle, ...(value.targetStyle || {}) }
  };
}

async function saveSettings(settings) {
  await browser.storage.sync.set({ settings: mergeSettings(settings) });
}

function isAllowedCaptionUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const allowedHost = url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com");
    return url.protocol === "https:" && allowedHost && url.pathname === "/api/timedtext";
  } catch (_error) {
    return false;
  }
}

async function fetchCaptions(url) {
  if (!isAllowedCaptionUrl(url)) {
    throw new Error("Blocked an unexpected captions URL.");
  }

  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`YouTube captions request failed (${response.status}).`);
  }
  return response.text();
}

function trimToUtf8Bytes(text, limit = 490) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limit) return text;

  let result = "";
  for (const character of text) {
    if (encoder.encode(result + character).length > limit) break;
    result += character;
  }
  return result;
}

async function translateWithMyMemory(cleanText, source, target, settings) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", cleanText);
  url.searchParams.set("langpair", `${source}|${target}`);
  if (settings.mymemoryEmail.trim()) {
    url.searchParams.set("de", settings.mymemoryEmail.trim());
  }

  const response = await fetch(url.toString(), { credentials: "omit" });
  if (!response.ok) throw new Error(`MyMemory failed (${response.status}).`);
  const payload = await response.json();
  const translatedText = payload?.responseData?.translatedText;
  if (!translatedText || Number(payload.responseStatus) >= 400) {
    throw new Error(payload?.responseDetails || "MyMemory returned no translation.");
  }
  return { translatedText, provider: "mymemory" };
}

async function translateWithGoogle(cleanText, source, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", source);
  url.searchParams.set("tl", target);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", cleanText);

  const response = await fetch(url.toString(), { credentials: "omit" });
  if (!response.ok) throw new Error(`Google translation failed (${response.status}).`);
  const payload = await response.json();
  const translatedText = Array.isArray(payload?.[0])
    ? payload[0].map((part) => part?.[0] || "").join("").trim()
    : "";
  if (!translatedText) throw new Error("Google returned no translation.");
  return { translatedText, provider: "google" };
}

async function translateSelection(text, sourceLanguage, targetLanguage) {
  const rawText = String(text || "").trim();
  if (!rawText) throw new Error("Select a word or sentence first.");
  const source = sourceLanguage || "fr";
  const target = targetLanguage || "en";
  const settings = await getSettings();
  const provider = settings.translationProvider === "mymemory" ? "mymemory" : "google";
  const cleanText = trimToUtf8Bytes(rawText, provider === "google" ? 4500 : 490);
  const cacheKey = `${provider}|${source}|${target}|${cleanText}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
  if (translationPending.has(cacheKey)) return translationPending.get(cacheKey);

  const request = (async () => {
    let translated;
    if (provider === "mymemory") {
      translated = await translateWithMyMemory(cleanText, source, target, settings);
    } else {
      try {
        translated = await translateWithGoogle(cleanText, source, target);
      } catch (_googleError) {
        translated = await translateWithMyMemory(trimToUtf8Bytes(cleanText, 490), source, target, settings);
      }
    }

    const result = { ...translated, sourceText: cleanText };
    translationCache.set(cacheKey, result);
    if (translationCache.size > 1500) {
      translationCache.delete(translationCache.keys().next().value);
    }
    return result;
  })();
  translationPending.set(cacheKey, request);
  try {
    return await request;
  } finally {
    translationPending.delete(cacheKey);
  }
}

browser.runtime.onInstalled.addListener(async () => {
  const stored = await browser.storage.sync.get("settings");
  if (!stored.settings) await saveSettings(DEFAULT_SETTINGS);
  const settings = mergeSettings(stored.settings);
  await browser.action.setBadgeText({ text: settings.enabled ? "ON" : "OFF" });
  await browser.action.setBadgeBackgroundColor({ color: settings.enabled ? "#16a34a" : "#64748b" });
});

browser.runtime.onStartup.addListener(async () => {
  const settings = await getSettings();
  await browser.action.setBadgeText({ text: settings.enabled ? "ON" : "OFF" });
  await browser.action.setBadgeBackgroundColor({ color: settings.enabled ? "#16a34a" : "#64748b" });
});

browser.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  const settings = mergeSettings(changes.settings.newValue);
  browser.action.setBadgeText({ text: settings.enabled ? "ON" : "OFF" });
  browser.action.setBadgeBackgroundColor({ color: settings.enabled ? "#16a34a" : "#64748b" });
});

browser.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-dualsub") {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await saveSettings(settings);
  } else if (command === "replay-current-caption") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) browser.tabs.sendMessage(tab.id, { type: "replay-current-cue" }).catch(() => {});
  } else if (command === "open-vocabulary") {
    await browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "fetch-captions") {
    return fetchCaptions(message.url).then((text) => ({ ok: true, text }));
  }
  if (message?.type === "translate-selection") {
    return translateSelection(message.text, message.sourceLanguage, message.targetLanguage)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "get-default-settings") {
    return Promise.resolve({ settings: DEFAULT_SETTINGS });
  }
  if (message?.type === "get-vocabulary") {
    return getVocabulary()
      .then((entries) => ({ ok: true, entries }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "add-vocabulary") {
    return addVocabularyEntry(message.entry)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "remove-vocabulary") {
    return removeVocabularyEntry(message.id)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "update-vocabulary") {
    return updateVocabularyEntry(message.id, message.updates)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "review-vocabulary") {
    return reviewVocabularyEntry(message.id, message.rating)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "import-vocabulary") {
    return importVocabularyEntries(message.entries)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  return undefined;
});
