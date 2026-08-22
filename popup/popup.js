let settings;
let defaults;
let saveTimer;

const ids = [
  "enabled", "showSource", "showTranslation", "hideNativeCaptions", "wholeLiveLines", "selectionTranslation",
  "hoverLookup", "wordAlignment", "pauseOnLookup", "recallMode", "hoverDelay",
  "bottomOffset", "maxWidth", "mymemoryEmail", "translationProvider",
  "sourceFontSize", "sourceTextColor", "sourceBackgroundColor", "sourceBackgroundOpacity",
  "sourceFontFamily", "sourceFontWeight", "sourceItalic",
  "targetFontSize", "targetTextColor", "targetBackgroundColor", "targetBackgroundOpacity",
  "targetFontFamily", "targetFontWeight", "targetItalic"
];

function element(id) {
  return document.getElementById(id);
}

function setFormValues() {
  element("enabled").checked = settings.enabled;
  element("showSource").checked = settings.showSource;
  element("showTranslation").checked = settings.showTranslation;
  element("hideNativeCaptions").checked = settings.hideNativeCaptions;
  element("wholeLiveLines").checked = settings.wholeLiveLines;
  element("selectionTranslation").checked = settings.selectionTranslation;
  element("hoverLookup").checked = settings.hoverLookup;
  element("wordAlignment").checked = settings.wordAlignment;
  element("pauseOnLookup").checked = settings.pauseOnLookup;
  element("recallMode").checked = settings.recallMode;
  element("hoverDelay").value = settings.hoverDelay;
  element("bottomOffset").value = settings.bottomOffset;
  element("maxWidth").value = settings.maxWidth;
  element("mymemoryEmail").value = settings.mymemoryEmail || "";
  element("translationProvider").value = settings.translationProvider || "google";

  for (const prefix of ["source", "target"]) {
    const style = settings[`${prefix}Style`];
    element(`${prefix}FontSize`).value = style.fontSize;
    element(`${prefix}TextColor`).value = style.textColor;
    element(`${prefix}BackgroundColor`).value = style.backgroundColor;
    element(`${prefix}BackgroundOpacity`).value = style.backgroundOpacity;
    element(`${prefix}FontFamily`).value = style.fontFamily;
    element(`${prefix}FontWeight`).value = style.fontWeight;
    element(`${prefix}Italic`).checked = style.italic;
  }
  updateOutputs();
}

function readFormValues() {
  settings.enabled = element("enabled").checked;
  settings.showSource = element("showSource").checked;
  settings.showTranslation = element("showTranslation").checked;
  settings.hideNativeCaptions = element("hideNativeCaptions").checked;
  settings.wholeLiveLines = element("wholeLiveLines").checked;
  settings.selectionTranslation = element("selectionTranslation").checked;
  settings.hoverLookup = element("hoverLookup").checked;
  settings.wordAlignment = element("wordAlignment").checked;
  settings.pauseOnLookup = element("pauseOnLookup").checked;
  settings.recallMode = element("recallMode").checked;
  settings.hoverDelay = Number(element("hoverDelay").value);
  settings.bottomOffset = Number(element("bottomOffset").value);
  settings.maxWidth = Number(element("maxWidth").value);
  settings.mymemoryEmail = element("mymemoryEmail").value.trim();
  settings.translationProvider = element("translationProvider").value;

  for (const prefix of ["source", "target"]) {
    settings[`${prefix}Style`] = {
      fontSize: Number(element(`${prefix}FontSize`).value),
      textColor: element(`${prefix}TextColor`).value,
      backgroundColor: element(`${prefix}BackgroundColor`).value,
      backgroundOpacity: Number(element(`${prefix}BackgroundOpacity`).value),
      fontFamily: element(`${prefix}FontFamily`).value,
      fontWeight: element(`${prefix}FontWeight`).value,
      italic: element(`${prefix}Italic`).checked
    };
  }
}

function updateOutputs() {
  element("sourceSizeOutput").textContent = `${element("sourceFontSize").value}px`;
  element("targetSizeOutput").textContent = `${element("targetFontSize").value}px`;
  element("sourceOpacityOutput").textContent = `${element("sourceBackgroundOpacity").value}%`;
  element("targetOpacityOutput").textContent = `${element("targetBackgroundOpacity").value}%`;
  element("bottomOffsetOutput").textContent = `${element("bottomOffset").value}px`;
  element("maxWidthOutput").textContent = `${element("maxWidth").value}%`;
  element("hoverDelayOutput").textContent = `${element("hoverDelay").value}ms`;
  document.body.classList.toggle("is-disabled", !element("enabled").checked);
}

function scheduleSave() {
  readFormValues();
  updateOutputs();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => browser.storage.sync.set({ settings }), 90);
}

async function loadStatus() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes("youtube.com/")) return;
    const current = await browser.tabs.sendMessage(tab.id, { type: "get-status" });
    if (current?.message) element("playerStatus").textContent = current.message;
  } catch (_error) {
    // The content script may not exist yet on a newly opened tab.
  }
}

async function loadVocabularyCount() {
  try {
    const response = await browser.runtime.sendMessage({ type: "get-vocabulary" });
    element("vocabularyCount").textContent = response?.ok ? response.entries.length : "–";
  } catch (_error) {
    element("vocabularyCount").textContent = "–";
  }
}

async function initialize() {
  const defaultResponse = await browser.runtime.sendMessage({ type: "get-default-settings" });
  defaults = defaultResponse.settings;
  const stored = await browser.storage.sync.get("settings");
  settings = {
    ...defaults,
    ...(stored.settings || {}),
    sourceStyle: { ...defaults.sourceStyle, ...(stored.settings?.sourceStyle || {}) },
    targetStyle: { ...defaults.targetStyle, ...(stored.settings?.targetStyle || {}) }
  };
  setFormValues();
  ids.forEach((id) => {
    element(id).addEventListener("input", scheduleSave);
    element(id).addEventListener("change", scheduleSave);
  });
  element("reset").addEventListener("click", () => {
    const enabled = settings.enabled;
    settings = structuredClone(defaults);
    settings.enabled = enabled;
    setFormValues();
    browser.storage.sync.set({ settings });
  });
  element("openVocabulary").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
    window.close();
  });
  loadStatus();
  loadVocabularyCount();
}

initialize();
