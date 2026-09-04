const DEFAULT_SETTINGS = {
  enabled: true,
  showSource: true,
  showTranslation: true,
  sourceLanguage: "fr",
  targetLanguage: "en",
  hideNativeCaptions: true,
  selectionTranslation: true,
  wholeLiveLines: true,
  preloadVideoWords: true,
  hoverLookup: true,
  wordAlignment: true,
  colorFrenchWordGroups: false,
  wordGroupPaletteVersion: 2,
  wordGroupColors: {
    unknown: "#ffffff",
    noun: "#60a5fa",
    verb: "#a78bfa",
    adjective: "#fb7185",
    adverb: "#facc15",
    pronoun: "#22d3ee",
    determiner: "#4ade80",
    preposition: "#fb923c",
    conjunction: "#f472b6",
    interjection: "#94a3b8"
  },
  pauseOnLookup: false,
  recallMode: false,
  autoPause: false,
  studyMode: "watch",
  captionHoldMs: 350,
  smartPauseUnknownOnly: true,
  skipCaptionGaps: false,
  translationBufferSeconds: 90,
  translationBatchSize: 30,
  lookupCardPosition: "smart",
  hoverDelay: 420,
  pronunciationVoiceURI: "",
  pronunciationRate: 0.88,
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

const translationPending = new Map();
const VOCABULARY_KEY = "vocabulary";
const WORD_STATE_KEY = "wordStatesV1";
const CORRECTIONS_KEY = "translationCorrectionsV1";
const VIDEO_PROFILES_KEY = "videoProfilesV1";

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

async function getWordStates() {
  const stored = await browser.storage.local.get(WORD_STATE_KEY);
  return stored[WORD_STATE_KEY] && typeof stored[WORD_STATE_KEY] === "object" ? stored[WORD_STATE_KEY] : {};
}

async function setWordState(rawWord, state = "learning") {
  const word = vocabularyKey(rawWord);
  if (!word) throw new Error("Choose a word first.");
  const allowed = new Set(["known", "learning", "ignored", "unknown"]);
  const normalizedState = allowed.has(state) ? state : "learning";
  const states = await getWordStates();
  if (normalizedState === "unknown") delete states[word];
  else states[word] = { state: normalizedState, updatedAt: Date.now() };
  const compact = Object.fromEntries(Object.entries(states)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, 12_000));
  await browser.storage.local.set({ [WORD_STATE_KEY]: compact });
  return { word, state: normalizedState };
}

async function getTranslationCorrections() {
  const stored = await browser.storage.local.get(CORRECTIONS_KEY);
  return stored[CORRECTIONS_KEY] && typeof stored[CORRECTIONS_KEY] === "object" ? stored[CORRECTIONS_KEY] : {};
}

async function saveTranslationCorrection(sourceText, translatedText, sourceLanguage = "fr", targetLanguage = "en") {
  const source = vocabularyKey(sourceText);
  const translation = cleanVocabularyText(translatedText, 300);
  if (!source || !translation) throw new Error("A source word and correction are required.");
  const corrections = await getTranslationCorrections();
  const key = `${sourceLanguage}|${targetLanguage}|${source}`;
  corrections[key] = { translatedText: translation, updatedAt: Date.now() };
  await browser.storage.local.set({ [CORRECTIONS_KEY]: corrections });
  return corrections[key];
}

async function getVideoProfile(videoId) {
  const stored = await browser.storage.local.get(VIDEO_PROFILES_KEY);
  const profile = stored[VIDEO_PROFILES_KEY]?.[cleanVocabularyText(videoId, 32)] || null;
  return profile?.studyMode === "focus" ? { ...profile, studyMode: "watch" } : profile;
}

async function saveVideoProfile(videoId, profile = {}) {
  const id = cleanVocabularyText(videoId, 32);
  if (!id) throw new Error("Open a video first.");
  const stored = await browser.storage.local.get(VIDEO_PROFILES_KEY);
  const profiles = { ...(stored[VIDEO_PROFILES_KEY] || {}) };
  profiles[id] = {
    captionOffsetMs: Math.max(-5000, Math.min(5000, Number(profile.captionOffsetMs) || 0)),
    studyMode: ["watch", "study", "shadow"].includes(profile.studyMode) ? profile.studyMode : "watch",
    updatedAt: Date.now()
  };
  const compact = Object.fromEntries(Object.entries(profiles)
    .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0))
    .slice(0, 1000));
  await browser.storage.local.set({ [VIDEO_PROFILES_KEY]: compact });
  return compact[id];
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
  await setWordState(sourceText, "learning");
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
  if (Object.prototype.hasOwnProperty.call(updates, "translatedText")) {
    await saveTranslationCorrection(entry.sourceText, entry.translatedText, entry.sourceLanguage, entry.targetLanguage);
  }
  return { entry };
}

async function reviewVocabularyEntry(id, rating) {
  const vocabulary = await getVocabulary();
  const entry = vocabulary.find((item) => item.id === id);
  if (!entry) throw new Error("Vocabulary entry not found.");
  const legacyIntervals = [0, 1, 3, 7, 14, 30, 90];
  const previousInterval = Math.max(0, Number(entry.reviewIntervalDays) || legacyIntervals[Math.max(0, Math.min(6, Number(entry.stage) || 0))]);
  let easeFactor = Math.max(1.3, Number(entry.easeFactor) || 2.5);
  let intervalDays;
  if (rating === "again") {
    intervalDays = 10 / 1440;
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    entry.reviewLapses = (Number(entry.reviewLapses) || 0) + 1;
  } else if (rating === "hard") {
    intervalDays = Math.max(0.5, previousInterval * 1.2 || 0.5);
    easeFactor = Math.max(1.3, easeFactor - 0.15);
  } else {
    intervalDays = previousInterval < 1 ? 1 : previousInterval < 3 ? 3 : previousInterval * easeFactor;
    easeFactor = Math.min(3.0, easeFactor + 0.05);
  }
  const stageThresholds = [0, 1, 3, 7, 21, 60, 150];
  entry.stage = rating === "again" ? 0 : stageThresholds.reduce((stage, threshold, index) => intervalDays >= threshold ? index : stage, 0);
  entry.reviewIntervalDays = Math.round(intervalDays * 100) / 100;
  entry.easeFactor = Math.round(easeFactor * 100) / 100;
  entry.reviews = (Number(entry.reviews) || 0) + 1;
  entry.lastReviewedAt = Date.now();
  entry.dueAt = Date.now() + intervalDays * 86400000;
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
      reviewIntervalDays: Math.max(0, Number(rawEntry.reviewIntervalDays) || 0),
      easeFactor: Math.max(1.3, Math.min(3, Number(rawEntry.easeFactor) || 2.5)),
      reviewLapses: Math.max(0, Number(rawEntry.reviewLapses) || 0),
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
  const wordGroupColors = { ...DEFAULT_SETTINGS.wordGroupColors, ...(value.wordGroupColors || {}) };
  if (!value.wordGroupPaletteVersion && wordGroupColors.verb === "#fb7185" && wordGroupColors.adjective === "#c084fc") {
    wordGroupColors.verb = DEFAULT_SETTINGS.wordGroupColors.verb;
    wordGroupColors.adjective = DEFAULT_SETTINGS.wordGroupColors.adjective;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    studyMode: ["watch", "study", "shadow"].includes(value.studyMode) ? value.studyMode : "watch",
    wordGroupPaletteVersion: 2,
    wordGroupColors,
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

async function translateBatchMessage(message) {
  const settings = await getSettings();
  return DualSubTranslation.translateBatch(message.items, {
    provider: message.provider || settings.translationProvider,
    sourceLanguage: message.sourceLanguage || settings.sourceLanguage,
    targetLanguage: message.targetLanguage || settings.targetLanguage,
    videoId: message.videoId,
    context: message.context,
    providerVersion: message.providerVersion,
    sessionId: message.sessionId
  }, settings);
}

function suspiciousWordTranslation(sourceText, translatedText) {
  const source = cleanVocabularyText(sourceText, 160);
  const translation = cleanVocabularyText(translatedText, 1000);
  const sourceWords = source.match(/[\p{L}\p{N}]+/gu) || [];
  const translatedWords = translation.match(/[\p{L}\p{N}]+/gu) || [];
  if (!source || !translation || sourceWords.length > 3) return false;
  if (translatedWords.length > Math.max(8, sourceWords.length * 4)) return true;
  if (translation.length > Math.max(72, source.length * 10)) return true;
  const sentenceStops = translation.match(/[.!?](?:\s|$)/gu) || [];
  return sentenceStops.length > 1 && translatedWords.length > 6;
}

async function wrongLanguageWordTranslation(translatedText, targetLanguage, sourceLanguage) {
  if (!browser.i18n?.detectLanguage || !translatedText) return false;
  try {
    const detection = await browser.i18n.detectLanguage(translatedText);
    const strongest = Array.from(detection?.languages || [])
      .sort((left, right) => Number(right.percentage || 0) - Number(left.percentage || 0))[0];
    if (!strongest || (!detection.isReliable && Number(strongest.percentage || 0) < 70)) return false;
    const detected = String(strongest.language || "").split("-")[0].toLocaleLowerCase();
    const target = String(targetLanguage || "").split("-")[0].toLocaleLowerCase();
    const source = String(sourceLanguage || "").split("-")[0].toLocaleLowerCase();
    return Boolean(detected && detected !== "und" && detected !== target && detected !== source);
  } catch (_error) {
    return false;
  }
}

async function translateConciseWordFallback(message, settings, normalizedText) {
  const { results } = await DualSubTranslation.translateBatch([{
    text: normalizedText,
    cacheId: `concise-word:${normalizedText.normalize("NFC").toLocaleLowerCase()}`
  }], {
    provider: "google",
    sourceLanguage: message.sourceLanguage || settings.sourceLanguage,
    targetLanguage: message.targetLanguage || settings.targetLanguage,
    providerVersion: "concise-word-v1",
    sessionId: message.sessionId || `word-fallback-${Date.now()}`
  }, settings);
  const result = results[0];
  if (!result?.translatedText || suspiciousWordTranslation(normalizedText, result.translatedText)) {
    const error = new Error("No concise translation was found for this word.");
    error.code = "WORD_TRANSLATION_LOW_QUALITY";
    throw error;
  }
  return { ...result, provenance: "Google concise fallback", qualityFallback: true };
}

async function translateSelectionWithEngine(message) {
  const settings = await getSettings();
  const normalizedText = String(message.text || "").trim();
  const pendingKey = [
    settings.translationProvider,
    message.sourceLanguage || settings.sourceLanguage,
    message.targetLanguage || settings.targetLanguage,
    message.cacheMode === "word" ? normalizedText.normalize("NFC").toLocaleLowerCase() : normalizedText
  ].join("|");
  if (["word", "phrase"].includes(message.cacheMode)) {
    const corrections = await getTranslationCorrections();
    const correctionKey = `${message.sourceLanguage || settings.sourceLanguage}|${message.targetLanguage || settings.targetLanguage}|${vocabularyKey(normalizedText)}`;
    if (corrections[correctionKey]?.translatedText) {
      return {
        sourceText: normalizedText,
        translatedText: corrections[correctionKey].translatedText,
        provider: "correction",
        provenance: "Your correction",
        alignment: [],
        cacheHit: true
      };
    }
  }
  if (translationPending.has(pendingKey)) return translationPending.get(pendingKey);
  const request = (async () => {
    const { results } = await DualSubTranslation.translateBatch([{
      text: normalizedText,
      cacheId: message.cacheMode === "word" ? `word:${normalizedText.normalize("NFC").toLocaleLowerCase()}` : ""
    }], {
      provider: settings.translationProvider,
      sourceLanguage: message.sourceLanguage || settings.sourceLanguage,
      targetLanguage: message.targetLanguage || settings.targetLanguage,
      context: message.context,
      sessionId: message.sessionId || `lookup-${Date.now()}`
    }, settings);
    const result = results[0];
    const wrongLanguage = message.cacheMode === "word" && settings.translationProvider === "mymemory"
      ? await wrongLanguageWordTranslation(
          result?.translatedText,
          message.targetLanguage || settings.targetLanguage,
          message.sourceLanguage || settings.sourceLanguage
        )
      : false;
    if (message.cacheMode === "word" && (suspiciousWordTranslation(normalizedText, result?.translatedText) || wrongLanguage)) {
      if (settings.translationProvider === "google") {
        const error = new Error("The translation service returned an unreliable word meaning.");
        error.code = "WORD_TRANSLATION_LOW_QUALITY";
        throw error;
      }
      return translateConciseWordFallback(message, settings, normalizedText);
    }
    return result;
  })();
  translationPending.set(pendingKey, request);
  try {
    return await request;
  } finally {
    translationPending.delete(pendingKey);
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

async function openTranslatorWindow(mode = "type") {
  const suffix = mode === "ocr" ? "#ocr" : "";
  return browser.windows.create({
    url: browser.runtime.getURL(`tools/translator.html${suffix}`),
    type: "popup",
    width: 720,
    height: 780,
    focused: true
  });
}

async function startVideoOcrSelection() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.windowId || !tab.url?.includes("youtube.com/")) {
    throw new Error("Open a YouTube video first.");
  }
  const response = await browser.tabs.sendMessage(tab.id, { type: "start-video-ocr-selection" });
  if (!response?.ok) {
    throw new Error(response?.error || "Video text selection could not be started.");
  }
  return { ok: true };
}

async function captureVideoSelectionForOcr(tab, rawCrop) {
  if (!tab?.windowId || !tab.url?.includes("youtube.com/")) throw new Error("The YouTube tab is no longer available.");
  const crop = {
    left: Number(rawCrop?.left),
    top: Number(rawCrop?.top),
    width: Number(rawCrop?.width),
    height: Number(rawCrop?.height),
    viewportWidth: Number(rawCrop?.viewportWidth),
    viewportHeight: Number(rawCrop?.viewportHeight)
  };
  if (Object.values(crop).some((value) => !Number.isFinite(value)) || crop.width < 8 || crop.height < 8) {
    throw new Error("The selected text area was invalid.");
  }
  const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 94 });
  await browser.storage.local.set({
    ocrCaptureV1: { dataUrl, crop, autoRun: true, capturedAt: Date.now(), sourceUrl: tab.url }
  });
  const response = await browser.tabs.sendMessage(tab.id, { type: "show-video-ocr-popup" });
  if (!response?.ok) throw new Error("The OCR popup could not be shown on YouTube.");
  return { ok: true };
}

browser.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-dualsub") {
    const settings = await getSettings();
    settings.enabled = !settings.enabled;
    await saveSettings(settings);
  } else if (command === "toggle-translation-reveal") {
    const settings = await getSettings();
    settings.showTranslation = true;
    settings.recallMode = !settings.recallMode;
    await saveSettings(settings);
  } else if (command === "replay-current-caption") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) browser.tabs.sendMessage(tab.id, { type: "replay-current-cue" }).catch(() => {});
  } else if (command === "open-vocabulary") {
    await browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
  } else if (command === "open-transcript") {
    await browser.sidebarAction.open().catch(() => {});
  } else if (command === "open-video-ocr") {
    await startVideoOcrSelection().catch(() => {});
  } else if (["previous-caption", "next-caption"].includes(command)) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) browser.tabs.sendMessage(tab.id, { type: "navigate-cue", direction: command === "previous-caption" ? -1 : 1 }).catch(() => {});
  } else if (["caption-50ms-earlier", "caption-50ms-later"].includes(command)) {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) browser.tabs.sendMessage(tab.id, { type: "adjust-caption-offset", deltaMs: command === "caption-50ms-earlier" ? 50 : -50 }).catch(() => {});
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "open-translator-popup") {
    return openTranslatorWindow("type")
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "open-video-ocr-popup") {
    return startVideoOcrSelection()
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "complete-video-ocr-selection") {
    return captureVideoSelectionForOcr(sender.tab, message.crop)
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "close-embedded-translator") {
    if (!sender.tab?.id) return Promise.resolve({ ok: false, error: "The YouTube tab is no longer available." });
    return browser.tabs.sendMessage(sender.tab.id, { type: "hide-video-ocr-popup" })
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "fetch-captions") {
    return fetchCaptions(message.url).then((text) => ({ ok: true, text }));
  }
  if (message?.type === "translate-selection") {
    return translateSelectionWithEngine(message)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({
        ok: false,
        error: error.message,
        errorCode: error.code || "TRANSLATION_FAILED"
      }));
  }
  if (message?.type === "translate-batch") {
    return translateBatchMessage(message)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message, errorCode: error.code || "TRANSLATION_FAILED", retryAfterMs: error.retryAfterMs || 0 }));
  }
  if (message?.type === "cancel-translation-session") {
    DualSubTranslation.cancelSession(message.sessionId);
    return Promise.resolve({ ok: true });
  }
  if (message?.type === "get-translation-health") {
    return Promise.resolve({ ok: true, health: DualSubTranslation.health() });
  }
  if (message?.type === "get-translation-cache-stats") {
    return DualSubTranslation.cacheStats()
      .then((cache) => ({ ok: true, cache }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "clear-translation-cache") {
    return DualSubTranslation.clearCache()
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "get-provider-secrets") {
    return DualSubTranslation.providerSecrets().then((secrets) => ({
      ok: true,
      secrets: {
        azureKey: secrets.azureKey ? "saved" : "",
        azureRegion: secrets.azureRegion,
        deeplKey: secrets.deeplKey ? "saved" : "",
        libreEndpoint: secrets.libreEndpoint,
        libreApiKey: secrets.libreApiKey ? "saved" : ""
      }
    }));
  }
  if (message?.type === "save-provider-secrets") {
    return DualSubTranslation.saveProviderSecrets(message.secrets)
      .then((secrets) => ({ ok: true, secrets }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "open-pronunciation-help") {
    return browser.tabs.create({ url: browser.runtime.getURL("help/pronunciation.html") })
      .then(() => ({ ok: true }))
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
  if (message?.type === "get-word-states") {
    return getWordStates()
      .then((states) => ({ ok: true, states }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "set-word-state") {
    return setWordState(message.word, message.state)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "save-translation-correction") {
    return saveTranslationCorrection(message.sourceText, message.translatedText, message.sourceLanguage, message.targetLanguage)
      .then((correction) => ({ ok: true, correction }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "get-video-profile") {
    return getVideoProfile(message.videoId)
      .then((profile) => ({ ok: true, profile }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "save-video-profile") {
    return saveVideoProfile(message.videoId, message.profile)
      .then((profile) => ({ ok: true, profile }))
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
