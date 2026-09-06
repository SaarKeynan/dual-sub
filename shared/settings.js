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

function applyStudyMode(value, mode) {
  const settings = mergeSettings(value);
  settings.studyMode = ["watch", "study", "shadow"].includes(mode) ? mode : "watch";
  settings.recallMode = false;
  settings.autoPause = settings.studyMode === "shadow";
  if (settings.studyMode === "study") settings.hoverLookup = true;
  return settings;
}
globalThis.DualSubSettings = Object.freeze({ defaults: DEFAULT_SETTINGS, merge: mergeSettings, applyStudyMode });
})();
