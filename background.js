const DEFAULT_SETTINGS = DualSubSettings.defaults;

const translationPending = new Map();
const VOCABULARY_KEY = "vocabulary";
const WORD_STATE_KEY = "wordStatesV1";
const CORRECTIONS_KEY = "translationCorrectionsV1";
const VIDEO_PROFILES_KEY = "videoProfilesV1";

const mutationQueues = new Map();
function serializeMutation(key, operation) {
  const result = (mutationQueues.get(key) || Promise.resolve()).then(operation);
  const settled = result.catch(() => {});
  mutationQueues.set(key, settled);
  settled.then(() => { if (mutationQueues.get(key) === settled) mutationQueues.delete(key); });
  return result;
}
function setWordState(...args) { return serializeMutation(WORD_STATE_KEY, () => setWordStateUnlocked(...args)); }
function saveTranslationCorrection(...args) { return serializeMutation(CORRECTIONS_KEY, () => saveTranslationCorrectionUnlocked(...args)); }
function saveVideoProfile(...args) { return serializeMutation(VIDEO_PROFILES_KEY, () => saveVideoProfileUnlocked(...args)); }
function addVocabularyEntry(...args) { return serializeMutation(VOCABULARY_KEY, () => addVocabularyEntryUnlocked(...args)); }
function removeVocabularyEntry(...args) { return serializeMutation(VOCABULARY_KEY, () => removeVocabularyEntryUnlocked(...args)); }
function updateVocabularyEntry(...args) { return serializeMutation(VOCABULARY_KEY, () => updateVocabularyEntryUnlocked(...args)); }
function reviewVocabularyEntry(...args) { return serializeMutation(VOCABULARY_KEY, () => reviewVocabularyEntryUnlocked(...args)); }
function importVocabularyEntries(...args) { return serializeMutation(VOCABULARY_KEY, () => importVocabularyEntriesUnlocked(...args)); }

function vocabularyContexts(values) {
  const unique = new Map();
  for (const raw of (Array.isArray(values) ? values : []).slice(-100)) {
    if (!raw || typeof raw !== "object") continue;
    const context = {
      sentence: cleanVocabularyText(raw.sentence), sentenceTranslation: cleanVocabularyText(raw.sentenceTranslation),
      videoId: cleanVocabularyText(raw.videoId, 32), videoTitle: cleanVocabularyText(raw.videoTitle, 240),
      timeMs: Number.isFinite(Number(raw.timeMs)) ? Math.max(0, Number(raw.timeMs)) : 0
    };
    if (!context.sentence && !context.videoId) continue;
    unique.set(JSON.stringify([context.videoId, context.timeMs, context.sentence]), context);
  }
  return Array.from(unique.values()).slice(-20);
}

function withLearningData(operation) {
  return serializeMutation(VOCABULARY_KEY, () => serializeMutation(WORD_STATE_KEY,
    () => serializeMutation(CORRECTIONS_KEY, () => serializeMutation(VIDEO_PROFILES_KEY, operation))));
}

function exportLearningBackup() {
  return withLearningData(async () => {
    const stored = await browser.storage.local.get([VOCABULARY_KEY, WORD_STATE_KEY, CORRECTIONS_KEY, VIDEO_PROFILES_KEY]);
    return { version: 2, exportedAt: Date.now(), entries: stored[VOCABULARY_KEY] || [],
      wordStates: stored[WORD_STATE_KEY] || {}, corrections: stored[CORRECTIONS_KEY] || {}, profiles: stored[VIDEO_PROFILES_KEY] || {} };
  });
}

function restoreLearningBackup(payload) {
  return withLearningData(async () => {
    if (!payload || ![1, 2].includes(payload.version)) throw new Error("Unsupported backup version.");
    const objects = {};
    for (const name of ["wordStates", "corrections", "profiles"]) {
      const value = payload[name] || {};
      if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 20000) throw new Error("Invalid backup " + name + ".");
      objects[name] = value;
    }
    const stored = await browser.storage.local.get([WORD_STATE_KEY, CORRECTIONS_KEY, VIDEO_PROFILES_KEY]);
    const states = { ...(stored[WORD_STATE_KEY] || {}) };
    for (const [word, value] of Object.entries(objects.wordStates)) {
      if (!["known", "learning", "ignored"].includes(value?.state)) throw new Error("Invalid word state.");
      Object.defineProperty(states, vocabularyKey(word), { value: { state: value.state, updatedAt: Date.now() }, enumerable: true, configurable: true, writable: true });
    }
    const corrections = { ...(stored[CORRECTIONS_KEY] || {}) };
    for (const [key, value] of Object.entries(objects.corrections)) {
      if (!/^[a-z-]+\|[a-z-]+\|.+$/i.test(key) || !cleanVocabularyText(value?.translatedText, 300)) throw new Error("Invalid correction.");
      corrections[key] = { translatedText: cleanVocabularyText(value.translatedText, 300), updatedAt: Date.now() };
    }
    const profiles = { ...(stored[VIDEO_PROFILES_KEY] || {}) };
    for (const [key, value] of Object.entries(objects.profiles)) {
      if (!/^[\w-]{1,32}$/.test(key) || !["watch", "study", "shadow"].includes(value?.studyMode) || !Number.isFinite(value.captionOffsetMs)) throw new Error("Invalid video profile.");
      Object.defineProperty(profiles, key, { value: { studyMode: value.studyMode, captionOffsetMs: Math.max(-5000, Math.min(5000, value.captionOffsetMs)), updatedAt: Date.now() }, enumerable: true, configurable: true, writable: true });
    }
    if (Object.keys(states).length > 12000 || Object.keys(profiles).length > 1000) throw new Error("Backup exceeds the learning-data limits. Nothing was restored.");
    const result = await importVocabularyEntriesUnlocked(payload.entries, false);
    await browser.storage.local.set({ [VOCABULARY_KEY]: result.entries, [WORD_STATE_KEY]: states, [CORRECTIONS_KEY]: corrections, [VIDEO_PROFILES_KEY]: profiles });
    return { imported: result.imported, updated: result.updated, total: result.total };
  });
}

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

// A correction is keyed by its source text, but vocabularyKey truncates at 160
// characters, so two long passages sharing an opening resolved to one key and
// the translator handed back the wrong saved meaning. Short sources, which is
// every word and phrase lookup, keep their existing key unchanged.
function correctionKey(sourceText, sourceLanguage = "fr", targetLanguage = "en") {
  const normalized = cleanVocabularyText(sourceText, 5000).normalize("NFKC").toLocaleLowerCase();
  let identity = vocabularyKey(sourceText);
  if (normalized.length > 160) {
    let hash = 2166136261;
    for (const character of normalized) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    identity += `#${normalized.length}.${(hash >>> 0).toString(36)}`;
  }
  return `${sourceLanguage}|${targetLanguage}|${identity}`;
}

async function getWordStates() {
  const stored = await browser.storage.local.get(WORD_STATE_KEY);
  return stored[WORD_STATE_KEY] && typeof stored[WORD_STATE_KEY] === "object" ? stored[WORD_STATE_KEY] : {};
}

async function setWordStateUnlocked(rawWord, state = "learning") {
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

async function saveTranslationCorrectionUnlocked(sourceText, translatedText, sourceLanguage = "fr", targetLanguage = "en") {
  const source = vocabularyKey(sourceText);
  const translation = cleanVocabularyText(translatedText, 300);
  if (!source || !translation) throw new Error("A source word and correction are required.");
  const corrections = await getTranslationCorrections();
  const key = correctionKey(sourceText, sourceLanguage, targetLanguage);
  corrections[key] = { translatedText: translation, updatedAt: Date.now() };
  await browser.storage.local.set({ [CORRECTIONS_KEY]: corrections });
  return corrections[key];
}

async function getVideoProfile(videoId) {
  const stored = await browser.storage.local.get(VIDEO_PROFILES_KEY);
  const profile = stored[VIDEO_PROFILES_KEY]?.[cleanVocabularyText(videoId, 32)] || null;
  return profile?.studyMode === "focus" ? { ...profile, studyMode: "watch" } : profile;
}

async function saveVideoProfileUnlocked(videoId, profile = {}) {
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

async function addVocabularyEntryUnlocked(rawEntry = {}) {
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
    for (const key of Object.keys(context)) {
      if (!Object.prototype.hasOwnProperty.call(rawEntry, key)) delete context[key];
    }
    existing.contexts = vocabularyContexts([...(existing.contexts || [existing]), context]);
    if (rawEntry.lemma) existing.lemma = cleanVocabularyText(rawEntry.lemma, 160);
    Object.assign(existing, context, {
      translatedText,
      updatedAt: now,
      encounters: (Number(existing.encounters) || 1) + 1
    });
    await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
    return { entry: existing, added: false };
  }

  if (vocabulary.length >= 2000) throw new Error("Vocabulary is full (2,000 words). Export a backup and remove words before adding more.");
  const entry = {
    id: `${now}-${Math.random().toString(36).slice(2, 9)}`,
    normalized,
    sourceText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    ...context,
    contexts: vocabularyContexts([context]),
    lemma: cleanVocabularyText(rawEntry.lemma, 160),
    createdAt: now,
    updatedAt: now,
    encounters: 1,
    stage: 0,
    reviews: 0,
    dueAt: now
  };
  vocabulary.unshift(entry);
  await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
  await setWordState(sourceText, "learning");
  return { entry, added: true };
}

async function removeVocabularyEntryUnlocked(id) {
  const vocabulary = await getVocabulary();
  const removedEntry = vocabulary.find((item) => item.id === id);
  const filtered = vocabulary.filter((item) => item.id !== id);
  await browser.storage.local.set({ [VOCABULARY_KEY]: filtered });
  // Saving a word marks it "learning" on the reader's behalf, so removing it
  // should retract that. A state the reader chose themselves is theirs to keep,
  // and it still drives coverage and smart pausing either way.
  if (removedEntry) {
    const states = await getWordStates();
    const key = vocabularyKey(removedEntry.sourceText);
    if (states[key]?.state === "learning") {
      delete states[key];
      await browser.storage.local.set({ [WORD_STATE_KEY]: states });
    }
  }
  return { removed: filtered.length !== vocabulary.length };
}

async function updateVocabularyEntryUnlocked(id, updates = {}) {
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

async function reviewVocabularyEntryUnlocked(id, rating) {
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

async function importVocabularyEntriesUnlocked(rawEntries, commit = true) {
  if (!Array.isArray(rawEntries)) throw new Error("The backup does not contain a vocabulary list.");
  if (rawEntries.length > 5000) throw new Error("Import supports up to 5,000 entries at once.");
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
      notes: cleanVocabularyText(rawEntry.notes, 600),
      lemma: cleanVocabularyText(rawEntry.lemma, 160),
      contexts: vocabularyContexts(rawEntry.contexts || [rawEntry])
    };
    const existing = byKey.get(key);
    if (existing) {
      // Restoring an older backup must never undo studying done since it was
      // taken. Review counters only grow, so the side that has been reviewed
      // more (and most recently) owns the whole scheduling state.
      const reviewRank = (item) => [Number(item.reviews) || 0, Number(item.lastReviewedAt) || 0];
      const [existingReviews, existingReviewedAt] = reviewRank(existing);
      const [incomingReviews, incomingReviewedAt] = reviewRank(sanitized);
      const review = incomingReviews > existingReviews ||
        (incomingReviews === existingReviews && incomingReviewedAt > existingReviewedAt)
        ? sanitized
        : existing;
      Object.assign(existing, sanitized, {
        id: existing.id,
        createdAt: existing.createdAt || sanitized.createdAt,
        // A backup without notes is missing them, not clearing them.
        notes: sanitized.notes || existing.notes,
        contexts: vocabularyContexts([...(existing.contexts || []), ...(sanitized.contexts || [])]),
        encounters: Math.max(Number(existing.encounters) || 1, Number(sanitized.encounters) || 1),
        stage: review.stage,
        reviews: review.reviews,
        reviewIntervalDays: review.reviewIntervalDays,
        easeFactor: review.easeFactor,
        reviewLapses: Math.max(Number(existing.reviewLapses) || 0, Number(sanitized.reviewLapses) || 0),
        dueAt: review.dueAt,
        lastReviewedAt: Math.max(existingReviewedAt, incomingReviewedAt)
      });
      updated += 1;
    } else {
      vocabulary.push(sanitized);
      byKey.set(key, sanitized);
      usedIds.add(sanitized.id);
      imported += 1;
    }
  }
  if (vocabulary.length > 2000) throw new Error("This import exceeds the 2,000-word limit. No vocabulary was changed.");
  vocabulary.sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  if (commit) await browser.storage.local.set({ [VOCABULARY_KEY]: vocabulary });
  return { imported, updated, total: vocabulary.length, ...(commit ? {} : { entries: vocabulary }) };
}

async function getSettings() {
  const stored = await browser.storage.sync.get("settings");
  return mergeSettings(stored.settings);
}

const mergeSettings = DualSubSettings.merge;

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

async function translateWordsIndividually(items, message) {
  const results = new Array(items.length);
  let cursor = 0;
  let cancelled = null;
  const worker = async () => {
    while (cursor < items.length && !cancelled) {
      const index = cursor++;
      try {
        results[index] = await translateSelectionWithEngine({
          text: items[index].text, cacheMode: "word", provider: message.provider,
          sourceLanguage: message.sourceLanguage, targetLanguage: message.targetLanguage,
          context: message.context, sessionId: message.sessionId
        });
      } catch (error) {
        // Navigation cancellation ends the whole batch; a single unusable or
        // low-quality word must not discard the words that did translate.
        if (error.code === "TRANSLATION_CANCELLED") cancelled = error;
        else results[index] = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
  if (cancelled) throw cancelled;
  return { results, health: DualSubTranslation.health() };
}

// Preloading a video's frequent words used to translate them one at a time,
// which cost one provider request per word even on engines that accept a
// hundred texts at once. Translate them together, then apply exactly the same
// quality checks a hover lookup applies so a preloaded meaning can never be one
// the lookup card would have rejected.
async function translateWordBatch(items, message, settings, fallbackProviders = []) {
  const sourceLanguage = message.sourceLanguage || settings.sourceLanguage;
  const targetLanguage = message.targetLanguage || settings.targetLanguage;
  // A word with no usable meaning stays null so the caller can tell it apart
  // from one that translated.
  const results = new Array(items.length).fill(null);
  const corrections = await getTranslationCorrections();
  const pending = [];
  items.forEach((item, index) => {
    const text = String(item.text || "").trim();
    if (!text) return;
    const saved = corrections[correctionKey(text, sourceLanguage, targetLanguage)]?.translatedText;
    if (saved) {
      results[index] = {
        sourceText: text, translatedText: saved, provider: "correction",
        provenance: "Your correction", alignment: [], cacheHit: true
      };
      return;
    }
    pending.push({ index, text });
  });
  if (!pending.length) return { results, health: DualSubTranslation.health() };
  const batch = await DualSubTranslation.translateBatch(
    pending.map(({ text }) => ({ text, cacheId: `word:${text.normalize("NFC").toLocaleLowerCase()}` })),
    {
      provider: settings.translationProvider,
      sourceLanguage,
      targetLanguage,
      context: message.context,
      sessionId: message.sessionId || `word-batch-${Date.now()}`,
      fallbackProviders
    },
    settings
  );
  await Promise.all(pending.map(async ({ index, text }, position) => {
    const result = batch.results[position];
    if (!result?.translatedText) return;
    if (!suspiciousWordTranslation(text, result.translatedText)) {
      results[index] = { ...result, sourceText: text, lookupText: text };
      return;
    }
    // Google produced the suspect answer, so asking it again would not help.
    if (settings.translationProvider === "google") return;
    try {
      const fallback = await translateConciseWordFallback(message, settings, text);
      results[index] = { ...fallback, sourceText: text, lookupText: text };
    } catch (error) {
      if (error.code === "TRANSLATION_CANCELLED") throw error;
    }
  }));
  return { results, health: DualSubTranslation.health() };
}

// An engine whose credentials are missing is skipped rather than attempted,
// because a missing key fails identically every time. The order itself is the
// reader's, cheapest first until they change it.
//
// Anything that is not a subtitle or the translator page is treated as a lookup,
// so a caller that forgets to say where it is translating from gets the pinned
// behaviour rather than the substituting one.
function fallbackLocation(purpose) {
  return ["subtitles", "translator"].includes(purpose) ? purpose : "lookups";
}

async function fallbackProvidersFor(purpose, settings) {
  if (!settings.translationFallback?.[fallbackLocation(purpose)]) return [];
  const secrets = await DualSubTranslation.providerSecrets();
  const configured = {
    google: true,
    mymemory: true,
    libretranslate: Boolean(secrets.libreEndpoint?.trim()),
    azure: Boolean(secrets.azureKey?.trim()),
    deepl: Boolean(secrets.deeplKey?.trim())
  };
  return settings.translationFallbackOrder.filter((provider) => configured[provider]);
}

async function translateBatchMessage(message) {
  const settings = await getSettings();
  if (Array.isArray(message.items) && message.items.length && message.items.every((item) => String(item.cacheId || "").startsWith("word:"))) {
    const items = message.items.slice(0, 1000);
    // These are word meanings whatever asked for them, so they follow the lookup
    // switch: the card and the sidebar read preloaded and hovered words from the
    // same cache, and two switches could only drift apart.
    const fallbackProviders = await fallbackProvidersFor("lookups", settings);
    // MyMemory sends one request per text and rejects the whole call when a
    // single answer looks unreliable, so batching it would only waste requests.
    return settings.translationProvider === "mymemory"
      ? translateWordsIndividually(items, message)
      : translateWordBatch(items, message, settings, fallbackProviders);
  }
  return DualSubTranslation.translateBatch(message.items, {
    provider: message.provider || settings.translationProvider,
    sourceLanguage: message.sourceLanguage || settings.sourceLanguage,
    targetLanguage: message.targetLanguage || settings.targetLanguage,
    videoId: message.videoId,
    context: message.context,
    providerVersion: message.providerVersion,
    sessionId: message.sessionId,
    fallbackProviders: await fallbackProvidersFor(message.purpose || "subtitles", settings)
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

// The batch item and its options decide the cache key, and both the interactive
// lookup and the word list's cache-only peek have to derive them the same way.
// Built in one place so a peek cannot miss an entry the lookup would have hit.
function lookupBatchItem(message, settings) {
  const normalizedText = String(message.text || "").trim();
  const lookupText = cleanVocabularyText(message.lookupText, 1000) || normalizedText;
  const readingKey = cleanVocabularyText(message.readingKey, 1000);
  return {
    normalizedText,
    lookupText,
    readingKey,
    item: {
      text: lookupText,
      cacheId: message.cacheMode === "word"
        ? `word:${normalizedText.normalize("NFC").toLocaleLowerCase()}${readingKey ? `|reading:${readingKey}` : ""}`
        : ""
    },
    options: {
      provider: settings.translationProvider,
      sourceLanguage: message.sourceLanguage || settings.sourceLanguage,
      targetLanguage: message.targetLanguage || settings.targetLanguage,
      context: message.context,
      providerVersion: settings.translationProvider === "mymemory" && message.cacheMode === "word" ? "mymemory-word-v2" : ""
    }
  };
}

// Answers the sidebar word list without contacting a provider: corrections
// first, then the translation cache, in the order the interactive lookup uses.
// A word already in the vocabulary is reported so the list can withdraw its
// add button; word state cannot carry that, because saving from the in-video
// card writes a vocabulary entry and leaves wordStatesV1 untouched.
async function peekWordMeanings(message) {
  const settings = await getSettings();
  const words = Array.isArray(message.words) ? message.words.slice(0, 200) : [];
  const [corrections, vocabulary] = await Promise.all([getTranslationCorrections(), getVocabulary()]);
  const saved = new Set(vocabulary.map((entry) => entry.normalized || vocabularyKey(entry.sourceText)));
  const prepared = words.map((word) => lookupBatchItem({ ...word, cacheMode: "word" }, settings));
  const keys = prepared.map(({ item, options }) => DualSubTranslation.cacheKeyFor(item, options));
  // A cache read that throws must not cost the list its saved flags.
  const cached = await DualSubTranslation.cachedResults(keys).catch(() => keys.map(() => null));
  return {
    meanings: prepared.map(({ normalizedText }, index) => {
      const correction = corrections[correctionKey(
        normalizedText,
        message.sourceLanguage || settings.sourceLanguage,
        message.targetLanguage || settings.targetLanguage
      )];
      const result = correction?.translatedText
        ? { translatedText: correction.translatedText, provenance: "Your correction" }
        : { translatedText: cached[index]?.translatedText || "", provenance: cached[index]?.provenance || "" };
      return { ...result, saved: saved.has(vocabularyKey(normalizedText)) };
    })
  };
}

async function translateSelectionWithEngine(message) {
  const settings = await getSettings();
  const { normalizedText, lookupText, readingKey, item, options } = lookupBatchItem(message, settings);
  const pendingKey = [
    settings.translationProvider,
    readingKey,
    lookupText,
    message.sourceLanguage || settings.sourceLanguage,
    message.targetLanguage || settings.targetLanguage,
    message.cacheMode === "word" ? normalizedText.normalize("NFC").toLocaleLowerCase() : normalizedText
  ].join("|");
  if (["word", "phrase"].includes(message.cacheMode)) {
    const corrections = await getTranslationCorrections();
    const lookupCorrectionKey = correctionKey(
      normalizedText,
      message.sourceLanguage || settings.sourceLanguage,
      message.targetLanguage || settings.targetLanguage
    );
    if (corrections[lookupCorrectionKey]?.translatedText) {
      return {
        sourceText: normalizedText,
        translatedText: corrections[lookupCorrectionKey].translatedText,
        provider: "correction",
        provenance: "Your correction",
        alignment: [],
        cacheHit: true
      };
    }
  }
  if (translationPending.has(pendingKey)) return translationPending.get(pendingKey);
  const request = (async () => {
    let batch;
    try {
      // sessionId is added here rather than in lookupBatchItem: it controls
      // cancellation, and cacheKeyFor ignores it, so peek and fetch still agree.
      batch = await DualSubTranslation.translateBatch([item], {
        ...options,
        sessionId: message.sessionId || `lookup-${Date.now()}`,
        fallbackProviders: await fallbackProvidersFor(message.purpose || "lookups", settings)
      }, settings);
    } catch (error) {
      if (settings.translationProvider !== "mymemory" || message.cacheMode !== "word" || error.code !== "MYMEMORY_UNRELIABLE_RESULT") throw error;
      const fallback = await translateConciseWordFallback(message, settings, lookupText);
      return { ...fallback, sourceText: normalizedText, lookupText };
    }
    const result = batch.results[0];
    const wrongLanguage = message.cacheMode === "word" && settings.translationProvider === "mymemory"
      ? await wrongLanguageWordTranslation(
          result?.translatedText,
          message.targetLanguage || settings.targetLanguage,
          message.sourceLanguage || settings.sourceLanguage
        )
      : false;
    const suspiciousMemory = settings.translationProvider === "mymemory" && DualSubTranslation.suspiciousMyMemoryWordResult(lookupText, result?.translatedText);
    if (message.cacheMode === "word" && (suspiciousWordTranslation(normalizedText, result?.translatedText) || wrongLanguage || suspiciousMemory)) {
      if (settings.translationProvider === "google") {
        const error = new Error("The translation service returned an unreliable word meaning.");
        error.code = "WORD_TRANSLATION_LOW_QUALITY";
        throw error;
      }
      const fallback = await translateConciseWordFallback(message, settings, lookupText);
      return { ...fallback, sourceText: normalizedText, lookupText };
    }
    return { ...result, sourceText: normalizedText, lookupText };
  })();
  translationPending.set(pendingKey, request);
  try {
    return await request;
  } finally {
    translationPending.delete(pendingKey);
  }
}

browser.runtime.onInstalled.addListener(async () => {
  await migrateStoredData().catch(() => {});
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
  // captureVisibleTab photographs the whole visible tab, not just the selected
  // rectangle, so nothing beyond the image and the crop box is worth keeping.
  await browser.storage.local.set({
    ocrCaptureV1: { dataUrl, crop, autoRun: true, capturedAt: Date.now() }
  });
  const response = await browser.tabs.sendMessage(tab.id, { type: "show-video-ocr-popup" });
  if (!response?.ok) {
    await discardOcrCapture();
    throw new Error("The OCR popup could not be shown on YouTube.");
  }
  return { ok: true };
}

// The translator removes the capture once it loads, but the reader can dismiss
// the modal first. Without this the screenshot stayed in extension storage
// until the translator next opened.
async function discardOcrCapture() {
  await browser.storage.local.remove("ocrCaptureV1");
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

// The background is an event page the browser may terminate when idle, so this
// counter cannot live in module scope: a restart would reset it to zero and a
// snapshot write still in flight from a tab could restore a cache just cleared.
const VIDEO_CACHE_EPOCH_KEY = "videoCacheEpochV1";

async function videoCacheEpoch() {
  const stored = await browser.storage.local.get(VIDEO_CACHE_EPOCH_KEY);
  return Number(stored[VIDEO_CACHE_EPOCH_KEY]) || 0;
}

async function clearTranslationCaches() {
  await browser.storage.local.set({ [VIDEO_CACHE_EPOCH_KEY]: (await videoCacheEpoch()) + 1 });
  const tabs = await browser.tabs.query({ url: "*://www.youtube.com/*" }).catch(() => []);
  await Promise.all(tabs.map((tab) => browser.tabs.sendMessage(tab.id, { type: "invalidate-video-caption-cache" }).catch(() => {})));
  await Promise.all([DualSubTranslation.clearCache(), DualSubVideoCache.clear()]);
}

// Storage keys carry version numbers, but nothing ever removed the superseded
// ones, so an upgraded profile kept dead caches in local storage indefinitely.
const STORAGE_SCHEMA_KEY = "storageSchemaV1";
const STORAGE_SCHEMA_VERSION = 1;
const RETIRED_STORAGE_KEYS = ["lineTranslationCache", "lineTranslationCacheV1", "videoCaptionCache", "ocrCapture"];

async function migrateStoredData() {
  const stored = await browser.storage.local.get(STORAGE_SCHEMA_KEY);
  if (Number(stored[STORAGE_SCHEMA_KEY]?.version) >= STORAGE_SCHEMA_VERSION) return { migrated: false };
  await browser.storage.local.remove(RETIRED_STORAGE_KEYS);
  await browser.storage.local.set({
    [STORAGE_SCHEMA_KEY]: { version: STORAGE_SCHEMA_VERSION, updatedAt: Date.now() }
  });
  return { migrated: true };
}

async function videoCacheScope(scope = {}) {
  const settings = await getSettings();
  if (scope.provider !== settings.translationProvider) throw new Error("Translation provider changed.");
  const secrets = scope.provider === "libretranslate" ? await DualSubTranslation.providerSecrets() : {};
  return { ...scope, endpoint: secrets.libreEndpoint || "" };
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "get-video-caption-cache") return videoCacheScope(message.scope)
    .then((scope) => DualSubVideoCache.get(scope)).then((snapshot) => ({ ok: true, snapshot }))
    .catch(() => ({ ok: true, snapshot: null }));
  if (message?.type === "save-video-caption-cache") {
    // Read the epoch before and after resolving the scope, so a clear that
    // lands in that gap still discards the write.
    return videoCacheEpoch()
      .then((epoch) => videoCacheScope(message.scope)
        .then((scope) => videoCacheEpoch().then((current) => current === epoch
          ? DualSubVideoCache.save(scope, message.snapshot)
          : false)))
      .then((saved) => ({ ok: true, saved })).catch(() => ({ ok: false }));
  }
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
    if (!sender.tab?.id) return discardOcrCapture().then(() => ({ ok: false, error: "The YouTube tab is no longer available." }));
    return discardOcrCapture()
      .then(() => browser.tabs.sendMessage(sender.tab.id, { type: "hide-video-ocr-popup" }))
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "discard-ocr-capture") {
    return discardOcrCapture().catch((error) => ({ ok: false, error: error.message }));
  }
  if (message?.type === "fetch-captions") {
    return fetchCaptions(message.url)
      .then((text) => ({ ok: true, text }))
      .catch((error) => ({ ok: false, error: error.message, errorCode: "CAPTION_FETCH_FAILED" }));
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
  if (message?.type === "peek-word-meanings") {
    return peekWordMeanings(message)
      .then((result) => ({ ok: true, ...result }))
      .catch((error) => ({ ok: false, error: error.message }));
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
    return clearTranslationCaches()
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
  if (message?.type === "export-learning-backup") return exportLearningBackup().then((backup) => ({ ok: true, backup })).catch((error) => ({ ok: false, error: error.message }));
  if (message?.type === "restore-learning-backup") return restoreLearningBackup(message.backup).then((result) => ({ ok: true, ...result })).catch((error) => ({ ok: false, error: error.message }));
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
