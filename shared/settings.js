(() => {
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
  wordGroupPaletteVersion: 3,
  // Five roles, not ten hues. Simulated, the previous noun and verb colours
  // were 4 apart on a 441-point scale, so they were the same colour to a
  // deuteranope. These are separated by at least 105 under both deuteranopia
  // and protanopia, and roles a learner does not act on differently share one
  // colour rather than competing for recall against an invisible legend.
  wordGroupColors: {
    unknown: "#e5e7eb",
    noun: "#60a5fa",
    verb: "#facc15",
    adjective: "#4ade80",
    adverb: "#4ade80",
    pronoun: "#94a3b8",
    determiner: "#94a3b8",
    preposition: "#94a3b8",
    conjunction: "#94a3b8",
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
  // Which translation locations may continue on another engine when the selected
  // one runs out of requests. Subtitles and the translator page are read once, so
  // finishing the line matters more than which engine finished it. A word lookup
  // is saved into the vocabulary and studied, so it stays on the engine that was
  // chosen for it unless this is switched on deliberately.
  translationFallback: {
    subtitles: true,
    lookups: false,
    translator: true
  },
  // The order eligible engines are tried in, cheapest first by default so a free
  // engine absorbs an overflow before a paid key is spent. The reader reorders
  // this in settings; the selected engine is always tried before any of it.
  translationFallbackOrder: ["google", "mymemory", "libretranslate", "azure", "deepl"],
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
// The ten-hue palette shipped through version 2. Migration only replaces a
// palette that still matches it exactly, so a reader who picked their own
// colours keeps every one of them.
const WORD_GROUP_PALETTE_V2 = Object.freeze({
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
});

const TRANSLATION_ENGINES = ["google", "mymemory", "libretranslate", "azure", "deepl"];

// A stored order arrives from sync storage and may be older than this version,
// truncated, or corrupt, so it is repaired rather than trusted: spreading it
// wholesale would silently shorten the fallback chain. The reader's choices are
// kept in their order, and anything they never expressed a view on is appended.
function mergeFallbackOrder(value) {
  const stored = Array.isArray(value) ? value.filter((entry) => TRANSLATION_ENGINES.includes(entry)) : [];
  const chosen = [...new Set(stored)];
  return [...chosen, ...TRANSLATION_ENGINES.filter((engine) => !chosen.includes(engine))];
}

function mergeSettings(value = {}) {
  const storedColors = value.wordGroupColors || {};
  const wordGroupColors = { ...DEFAULT_SETTINGS.wordGroupColors, ...storedColors };
  const paletteVersion = Number(value.wordGroupPaletteVersion) || 0;
  if (paletteVersion < 2 && storedColors.verb === "#fb7185" && storedColors.adjective === "#c084fc") {
    Object.assign(wordGroupColors, WORD_GROUP_PALETTE_V2);
  }
  if (paletteVersion < 3 && Object.entries(WORD_GROUP_PALETTE_V2).every(([group, color]) => wordGroupColors[group] === color)) {
    Object.assign(wordGroupColors, DEFAULT_SETTINGS.wordGroupColors);
  }
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    studyMode: ["watch", "study", "shadow"].includes(value.studyMode) ? value.studyMode : "watch",
    wordGroupPaletteVersion: 3,
    wordGroupColors,
    translationFallback: { ...DEFAULT_SETTINGS.translationFallback, ...(value.translationFallback || {}) },
    translationFallbackOrder: mergeFallbackOrder(value.translationFallbackOrder),
    sourceStyle: { ...DEFAULT_SETTINGS.sourceStyle, ...(value.sourceStyle || {}) },
    targetStyle: { ...DEFAULT_SETTINGS.targetStyle, ...(value.targetStyle || {}) }
  };
}

function applyStudyMode(value, mode) {
  const settings = mergeSettings(value);
  settings.studyMode = ["watch", "study", "shadow"].includes(mode) ? mode : "watch";
  settings.recallMode = false;
  settings.autoPause = settings.studyMode === "shadow";
  if (settings.studyMode === "study") settings.hoverLookup = true;
  return settings;
}
globalThis.DualSubSettings = Object.freeze({ defaults: DEFAULT_SETTINGS, merge: mergeSettings, applyStudyMode, engines: TRANSLATION_ENGINES });
})();
