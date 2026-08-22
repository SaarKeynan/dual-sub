let settings;
let defaults;
let saveTimer;

const ids = [
  "enabled", "showSource", "showTranslation", "hideNativeCaptions", "wholeLiveLines", "selectionTranslation",
  "hoverLookup", "wordAlignment", "colorFrenchWordGroups", "pauseOnLookup", "recallMode", "autoPause", "hoverDelay",
  "bottomOffset", "maxWidth", "captionOffsetMs", "mymemoryEmail", "translationProvider", "lookupCardPosition",
  "pronunciationVoiceURI", "pronunciationRate",
  "wordGroupColorUnknown", "wordGroupColorNoun", "wordGroupColorVerb", "wordGroupColorAdjective",
  "wordGroupColorAdverb", "wordGroupColorPronoun", "wordGroupColorDeterminer",
  "wordGroupColorPreposition", "wordGroupColorConjunction", "wordGroupColorInterjection",
  "sourceFontSize", "sourceTextColor", "sourceBackgroundColor", "sourceBackgroundOpacity",
  "sourceFontFamily", "sourceFontWeight", "sourceItalic",
  "targetFontSize", "targetTextColor", "targetBackgroundColor", "targetBackgroundOpacity",
  "targetFontFamily", "targetFontWeight", "targetItalic"
];

function element(id) {
  return document.getElementById(id);
}

function activatePanel(name) {
  const available = Array.from(document.querySelectorAll("[data-panel-content]"));
  const selected = available.some((panel) => panel.dataset.panelContent === name) ? name : "general";
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.panel === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  available.forEach((panel) => { panel.hidden = panel.dataset.panelContent !== selected; });
  sessionStorage.setItem("dualsub-settings-panel", selected);
}

function activateAppearance(name) {
  const selected = name === "target" ? "target" : "source";
  document.querySelectorAll(".appearance-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.appearance === selected);
  });
  document.querySelectorAll("[data-appearance-content]").forEach((panel) => {
    panel.hidden = panel.dataset.appearanceContent !== selected;
  });
  sessionStorage.setItem("dualsub-appearance-language", selected);
}

function activateToolPane(name) {
  const selected = document.querySelector(`[data-tool-content="${name}"]`) ? name : "lookup";
  document.querySelectorAll(".tool-button").forEach((button) => {
    const active = button.dataset.toolPane === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-tool-content]").forEach((pane) => {
    pane.hidden = pane.dataset.toolContent !== selected;
  });
  sessionStorage.setItem("dualsub-tools-pane", selected);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (_error) {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("Clipboard access unavailable.");
  }
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
  element("colorFrenchWordGroups").checked = settings.colorFrenchWordGroups;
  element("pauseOnLookup").checked = settings.pauseOnLookup;
  element("recallMode").checked = settings.recallMode;
  element("autoPause").checked = settings.autoPause;
  element("hoverDelay").value = settings.hoverDelay;
  element("bottomOffset").value = settings.bottomOffset;
  element("maxWidth").value = settings.maxWidth;
  element("captionOffsetMs").value = settings.captionOffsetMs;
  element("mymemoryEmail").value = settings.mymemoryEmail || "";
  element("translationProvider").value = settings.translationProvider || "google";
  element("lookupCardPosition").value = settings.lookupCardPosition || "smart";
  element("pronunciationVoiceURI").value = settings.pronunciationVoiceURI || "";
  element("pronunciationRate").value = settings.pronunciationRate || 0.88;
  for (const group of ["unknown", "noun", "verb", "adjective", "adverb", "pronoun", "determiner", "preposition", "conjunction", "interjection"]) {
    const id = `wordGroupColor${group[0].toUpperCase()}${group.slice(1)}`;
    element(id).value = settings.wordGroupColors[group];
  }

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
  settings.colorFrenchWordGroups = element("colorFrenchWordGroups").checked;
  settings.pauseOnLookup = element("pauseOnLookup").checked;
  settings.recallMode = element("recallMode").checked;
  settings.autoPause = element("autoPause").checked;
  settings.hoverDelay = Number(element("hoverDelay").value);
  settings.bottomOffset = Number(element("bottomOffset").value);
  settings.maxWidth = Number(element("maxWidth").value);
  settings.captionOffsetMs = Number(element("captionOffsetMs").value);
  settings.mymemoryEmail = element("mymemoryEmail").value.trim();
  settings.translationProvider = element("translationProvider").value;
  settings.lookupCardPosition = element("lookupCardPosition").value;
  settings.pronunciationVoiceURI = element("pronunciationVoiceURI").value;
  settings.pronunciationRate = Number(element("pronunciationRate").value);
  settings.wordGroupColors = {};
  for (const group of ["unknown", "noun", "verb", "adjective", "adverb", "pronoun", "determiner", "preposition", "conjunction", "interjection"]) {
    const id = `wordGroupColor${group[0].toUpperCase()}${group.slice(1)}`;
    settings.wordGroupColors[group] = element(id).value;
  }

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
  const captionOffset = Number(element("captionOffsetMs").value);
  element("captionOffsetOutput").textContent = captionOffset === 0
    ? "On time"
    : `${Math.abs(captionOffset)}ms ${captionOffset > 0 ? "earlier" : "later"}`;
  element("hoverDelayOutput").textContent = `${element("hoverDelay").value}ms`;
  element("pronunciationRateOutput").textContent = `${Number(element("pronunciationRate").value).toFixed(2)}×`;
  document.body.classList.toggle("is-disabled", !element("enabled").checked);
  updatePreview("source");
  updatePreview("target");
}

function colorWithOpacity(hex, opacity) {
  const value = String(hex || "#000000").replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Number(opacity) / 100})`;
}

function updatePreview(prefix) {
  const preview = element(`${prefix}Preview`);
  preview.style.fontSize = `${Math.min(25, Number(element(`${prefix}FontSize`).value))}px`;
  preview.style.color = element(`${prefix}TextColor`).value;
  preview.style.backgroundColor = colorWithOpacity(
    element(`${prefix}BackgroundColor`).value,
    element(`${prefix}BackgroundOpacity`).value
  );
  preview.style.fontFamily = element(`${prefix}FontFamily`).value;
  preview.style.fontWeight = element(`${prefix}FontWeight`).value;
  preview.style.fontStyle = element(`${prefix}Italic`).checked ? "italic" : "normal";
}

function isFrenchVoice(voice) {
  return /^fr(?:[-_]|$)/i.test(voice.lang || "") || /french|fran[cç]ais|france/i.test(voice.name || "");
}

function frenchVoiceScore(voice) {
  return (/^fr-FR$/i.test(voice.lang || "") ? 500 : 300) +
    (/natural|neural|premium/i.test(voice.name || "") ? 120 : 0) +
    (voice.localService ? 30 : 0) +
    (voice.default ? 10 : 0);
}

function loadPronunciationVoices() {
  const select = element("pronunciationVoiceURI");
  const preferred = settings?.pronunciationVoiceURI || select.value || "";
  const voices = Array.from(window.speechSynthesis?.getVoices?.() || [])
    .filter(isFrenchVoice)
    .sort((left, right) => frenchVoiceScore(right) - frenchVoiceScore(left) || left.name.localeCompare(right.name));
  select.replaceChildren(new Option("Best available French voice", ""));
  voices.forEach((voice) => {
    const quality = /natural|neural|premium/i.test(voice.name) ? " · natural" : "";
    select.add(new Option(`${voice.name} — ${voice.lang}${quality}`, voice.voiceURI));
  });
  if (preferred && voices.some((voice) => voice.voiceURI === preferred)) select.value = preferred;
  const preview = element("previewPronunciation");
  preview.disabled = voices.length === 0;
  preview.textContent = voices.length ? "Preview French voice" : "No French system voice found";
}

function previewPronunciation() {
  const synthesis = window.speechSynthesis;
  if (!synthesis || typeof SpeechSynthesisUtterance !== "function") return;
  const voices = synthesis.getVoices();
  const preferred = element("pronunciationVoiceURI").value;
  const voice = voices.find((candidate) => candidate.voiceURI === preferred) || voices.find(isFrenchVoice);
  if (!voice) return;
  const utterance = new SpeechSynthesisUtterance("Bonjour, comment allez-vous aujourd’hui ?");
  utterance.lang = voice?.lang || "fr-FR";
  utterance.voice = voice || null;
  utterance.rate = Number(element("pronunciationRate").value) || 0.88;
  synthesis.cancel();
  synthesis.speak(utterance);
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
    if (current?.message) {
      const statusNode = element("playerStatus");
      statusNode.textContent = current.message;
      statusNode.dataset.state = current.state || "waiting";
    }
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
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activatePanel(button.dataset.panel));
  });
  activatePanel(sessionStorage.getItem("dualsub-settings-panel") || "general");
  document.querySelectorAll(".appearance-button").forEach((button) => {
    button.addEventListener("click", () => activateAppearance(button.dataset.appearance));
  });
  activateAppearance(sessionStorage.getItem("dualsub-appearance-language") || "source");
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("click", () => activateToolPane(button.dataset.toolPane));
  });
  activateToolPane(sessionStorage.getItem("dualsub-tools-pane") || "lookup");
  const defaultResponse = await browser.runtime.sendMessage({ type: "get-default-settings" });
  defaults = defaultResponse.settings;
  const stored = await browser.storage.sync.get("settings");
  settings = {
    ...defaults,
    ...(stored.settings || {}),
    wordGroupColors: { ...defaults.wordGroupColors, ...(stored.settings?.wordGroupColors || {}) },
    sourceStyle: { ...defaults.sourceStyle, ...(stored.settings?.sourceStyle || {}) },
    targetStyle: { ...defaults.targetStyle, ...(stored.settings?.targetStyle || {}) }
  };
  loadPronunciationVoices();
  setFormValues();
  ids.forEach((id) => {
    element(id).addEventListener("input", scheduleSave);
    element(id).addEventListener("change", scheduleSave);
  });
  element("reset").addEventListener("click", () => {
    settings = {
      ...settings,
      bottomOffset: defaults.bottomOffset,
      maxWidth: defaults.maxWidth,
      wordGroupColors: structuredClone(defaults.wordGroupColors),
      sourceStyle: structuredClone(defaults.sourceStyle),
      targetStyle: structuredClone(defaults.targetStyle)
    };
    setFormValues();
    browser.storage.sync.set({ settings });
  });
  element("openVocabulary").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
    window.close();
  });
  element("previewPronunciation").addEventListener("click", previewPronunciation);
  window.speechSynthesis?.addEventListener?.("voiceschanged", loadPronunciationVoices);
  setTimeout(loadPronunciationVoices, 250);
  element("copyDiagnostics").addEventListener("click", async () => {
    const button = element("copyDiagnostics");
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const response = tab?.id ? await browser.tabs.sendMessage(tab.id, { type: "get-diagnostics" }) : null;
      if (!response?.ok) throw new Error("Open a YouTube video first.");
      await copyText(JSON.stringify(response.diagnostics, null, 2));
      button.textContent = "Copied";
    } catch (_error) {
      button.textContent = "Unavailable";
    }
    setTimeout(() => { button.textContent = "Copy diagnostics"; }, 1600);
  });
  loadStatus();
  setInterval(loadStatus, 1200);
  loadVocabularyCount();
}

initialize();
