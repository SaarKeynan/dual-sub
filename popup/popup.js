let settings;
let defaults;
let saveTimer;

const ids = [
  "enabled", "showSource", "showTranslation", "hideNativeCaptions", "wholeLiveLines", "selectionTranslation", "preloadVideoWords",
  "hoverLookup", "wordAlignment", "colorFrenchWordGroups", "pauseOnLookup", "recallMode", "autoPause", "skipCaptionGaps", "hoverDelay", "studyMode",
  "captionHoldMs", "translationBufferSeconds", "translationBatchSize",
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

const settingDestinations = [
  ["Type text to translate", "manual translation paste incorrect subtitles", "openTranslator", "general"],
  ["Capture text with OCR", "screen image video French text recognition", "captureText", "general"],
  ["French and English subtitle rows", "French row English row subtitles captions", "showSource", "general"],
  ["Learning mode", "watch focus study shadow mode", "studyMode", "general"],
  ["YouTube native captions", "hide regular native captions", "hideNativeCaptions", "general"],
  ["Keep live lines together", "whole line auto generated timing", "wholeLiveLines", "general"],
  ["Subtitle synchronization", "timing offset early late delay sync", "captionOffsetMs", "general"],
  ["Hold captions between lines", "duration disappear hold lines", "captionHoldMs", "general"],
  ["Translation engine", "provider azure deepl google mymemory libretranslate api key", "translationProvider", "general"],
  ["Translation preload", "buffer ahead batch loading speed", "translationBufferSeconds", "general"],
  ["French subtitle style", "French font size text color background opacity italic", "sourceFontSize", "appearance", "source"],
  ["English subtitle style", "English translation font size text color background opacity italic", "targetFontSize", "appearance", "target"],
  ["Color French words by grammar", "word group part speech toggle", "colorFrenchWordGroups", "appearance", "source"],
  ["Word-group color palette", "customize noun verb adjective adverb pronoun determiner preposition conjunction interjection colors", "wordGroupColorNoun", "appearance", "source"],
  ["Subtitle position and width", "bottom offset maximum width layout", "bottomOffset", "appearance", "source"],
  ["Lookup card position", "popup card cursor upper right subtitles", "lookupCardPosition", "tools", "lookup"],
  ["Hover word lookup", "dictionary definition translate hover delay", "hoverLookup", "tools", "lookup"],
  ["Translated-word matching", "alignment matching English French words", "wordAlignment", "tools", "lookup"],
  ["Phrase selection", "multiple words drag selection sentence", "selectionTranslation", "tools", "lookup"],
  ["Lookup pauses", "pause card open auto pause each line", "pauseOnLookup", "tools", "lookup"],
  ["Reveal English on demand", "recall hide English hover", "recallMode", "tools", "lookup"],
  ["Skip silent gaps", "silence gap skip playback", "skipCaptionGaps", "tools", "lookup"],
  ["French pronunciation", "voice speech speed pronounce", "pronunciationVoiceURI", "tools", "pronunciation"],
  ["Diagnostics and shortcuts", "copy diagnostics keyboard keys customize", "copyDiagnostics", "tools", "lookup"]
].map(([label, keywords, id, panel, subpanel]) => ({ label, keywords, id, panel, subpanel }));

function element(id) {
  return document.getElementById(id);
}

function normalizeSearch(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
}

function navigateToSetting(destination) {
  activatePanel(destination.panel);
  if (destination.panel === "appearance") activateAppearance(destination.subpanel || "source");
  if (destination.panel === "tools") activateToolPane(destination.subpanel || "lookup");
  const target = element(destination.id);
  target?.closest("details")?.setAttribute("open", "");
  const settingRow = target?.closest("label, .service-actions") || target;
  element("settingsSearchResults").hidden = true;
  requestAnimationFrame(() => {
    settingRow?.scrollIntoView({ behavior: "smooth", block: "center" });
    settingRow?.classList.add("setting-flash");
    target?.focus?.({ preventScroll: true });
    setTimeout(() => settingRow?.classList.remove("setting-flash"), 950);
  });
}

function renderSettingsSearch() {
  const query = normalizeSearch(element("settingsSearch").value);
  const results = element("settingsSearchResults");
  element("clearSettingsSearch").hidden = !query;
  if (!query) {
    results.hidden = true;
    results.replaceChildren();
    return;
  }
  const terms = query.split(/\s+/u).filter(Boolean);
  const matches = settingDestinations.filter((destination) => {
    const haystack = normalizeSearch(`${destination.label} ${destination.keywords}`);
    return terms.every((term) => haystack.includes(term));
  }).slice(0, 7);
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "settings-search-empty";
    empty.textContent = "No matching setting. Try a shorter word.";
    results.replaceChildren(empty);
  } else {
    results.replaceChildren(...matches.map((destination) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const title = document.createElement("strong");
      title.textContent = destination.label;
      const category = document.createElement("small");
      category.textContent = destination.panel === "tools" ? "Tools" : destination.panel[0].toUpperCase() + destination.panel.slice(1);
      button.append(title, category);
      button.addEventListener("click", () => navigateToSetting(destination));
      return button;
    }));
  }
  results.hidden = false;
}

function activatePanel(name) {
  const available = Array.from(document.querySelectorAll("[data-panel-content]"));
  const selected = available.some((panel) => panel.dataset.panelContent === name) ? name : "general";
  document.querySelectorAll(".tab-button").forEach((button) => {
    const active = button.dataset.panel === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  available.forEach((panel) => { panel.hidden = panel.dataset.panelContent !== selected; });
  sessionStorage.setItem("dualsub-settings-panel", selected);
}

function activateAppearance(name) {
  const selected = name === "target" ? "target" : "source";
  document.querySelectorAll(".appearance-button").forEach((button) => {
    const active = button.dataset.appearance === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-appearance-content]").forEach((panel) => {
    panel.hidden = panel.dataset.appearanceContent !== selected;
  });
  sessionStorage.setItem("dualsub-appearance-language", selected);
}

function enableTabKeyboardNavigation(selector, activate) {
  const buttons = Array.from(document.querySelectorAll(selector));
  buttons.forEach((button, index) => button.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    activate(buttons[nextIndex]);
  }));
}

function activateToolPane(name) {
  const selected = document.querySelector(`[data-tool-content="${name}"]`) ? name : "lookup";
  document.querySelectorAll(".tool-button").forEach((button) => {
    const active = button.dataset.toolPane === selected;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-tool-content]").forEach((pane) => {
    pane.hidden = pane.dataset.toolContent !== selected;
  });
  sessionStorage.setItem("dualsub-tools-pane", selected);
}

function updateProviderFields() {
  const provider = element("translationProvider").value;
  document.querySelectorAll("[data-provider-config]").forEach((group) => {
    group.hidden = group.dataset.providerConfig !== provider;
  });
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
  element("preloadVideoWords").checked = settings.preloadVideoWords;
  element("selectionTranslation").checked = settings.selectionTranslation;
  element("hoverLookup").checked = settings.hoverLookup;
  element("wordAlignment").checked = settings.wordAlignment;
  element("colorFrenchWordGroups").checked = settings.colorFrenchWordGroups;
  element("pauseOnLookup").checked = settings.pauseOnLookup;
  element("recallMode").checked = settings.recallMode;
  element("autoPause").checked = settings.autoPause;
  element("skipCaptionGaps").checked = settings.skipCaptionGaps;
  element("studyMode").value = settings.studyMode || "watch";
  element("captionHoldMs").value = settings.captionHoldMs ?? 350;
  element("translationBufferSeconds").value = settings.translationBufferSeconds || 90;
  element("translationBatchSize").value = settings.translationBatchSize || 30;
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
  settings.preloadVideoWords = element("preloadVideoWords").checked;
  settings.selectionTranslation = element("selectionTranslation").checked;
  settings.hoverLookup = element("hoverLookup").checked;
  settings.wordAlignment = element("wordAlignment").checked;
  settings.colorFrenchWordGroups = element("colorFrenchWordGroups").checked;
  settings.pauseOnLookup = element("pauseOnLookup").checked;
  settings.recallMode = element("recallMode").checked;
  settings.autoPause = element("autoPause").checked;
  settings.skipCaptionGaps = element("skipCaptionGaps").checked;
  settings.studyMode = element("studyMode").value;
  settings.captionHoldMs = Number(element("captionHoldMs").value);
  settings.translationBufferSeconds = Number(element("translationBufferSeconds").value);
  settings.translationBatchSize = Number(element("translationBatchSize").value);
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
  element("captionHoldOutput").textContent = `${element("captionHoldMs").value}ms`;
  element("pronunciationRateOutput").textContent = `${Number(element("pronunciationRate").value).toFixed(2)}×`;
  document.body.classList.toggle("is-disabled", !element("enabled").checked);
  updatePreview("source");
  updatePreview("target");
  updateContrastWarning();
}

function relativeLuminance(hex) {
  const channels = String(hex || "#000000").replace("#", "").match(/.{2}/g)?.map((value) => parseInt(value, 16) / 255) || [0, 0, 0];
  return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function updateContrastWarning() {
  const background = element("sourceBackgroundColor").value;
  const lowContrast = ["unknown", "noun", "verb", "adjective", "adverb", "pronoun", "determiner", "preposition", "conjunction", "interjection"].filter((group) => {
    const id = `wordGroupColor${group[0].toUpperCase()}${group.slice(1)}`;
    return contrastRatio(element(id).value, background) < 4.5;
  });
  element("contrastWarning").textContent = lowContrast.length
    ? `Low contrast: ${lowContrast.join(", ")}. Aim for 4.5:1 or higher.`
    : "All word-group colors meet 4.5:1 against the selected background.";
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
  preview.disabled = false;
  preview.dataset.missingVoice = String(voices.length === 0);
  preview.textContent = voices.length ? "Preview French voice" : "Set up a French voice";
}

function previewPronunciation() {
  const synthesis = window.speechSynthesis;
  if (!synthesis || typeof SpeechSynthesisUtterance !== "function") {
    browser.tabs.create({ url: browser.runtime.getURL("help/pronunciation.html") });
    return;
  }
  const voices = synthesis.getVoices();
  const preferred = element("pronunciationVoiceURI").value;
  const voice = voices.find((candidate) => candidate.voiceURI === preferred) || voices.find(isFrenchVoice);
  if (!voice) {
    browser.tabs.create({ url: browser.runtime.getURL("help/pronunciation.html") });
    return;
  }
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
  const saveStatus = element("saveStatus");
  saveStatus.textContent = "Saving…";
  saveStatus.dataset.state = "saving";
  saveTimer = setTimeout(async () => {
    try {
      await browser.storage.sync.set({ settings });
      saveStatus.textContent = "Saved";
      saveStatus.dataset.state = "saved";
    } catch (_error) {
      saveStatus.textContent = "Could not save changes";
      saveStatus.dataset.state = "error";
    }
  }, 140);
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
  element("settingsSearch").addEventListener("input", renderSettingsSearch);
  element("settingsSearch").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      element("settingsSearch").value = "";
      renderSettingsSearch();
    } else if (event.key === "ArrowDown") {
      const firstResult = element("settingsSearchResults").querySelector("button");
      if (firstResult) { event.preventDefault(); firstResult.focus(); }
    }
  });
  element("clearSettingsSearch").addEventListener("click", () => {
    element("settingsSearch").value = "";
    renderSettingsSearch();
    element("settingsSearch").focus();
  });
  element("settingsSearchResults").addEventListener("keydown", (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Escape") {
      element("settingsSearch").focus();
      return;
    }
    const results = Array.from(element("settingsSearchResults").querySelectorAll("button"));
    const index = results.indexOf(document.activeElement);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? results.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    results[nextIndex]?.focus();
  });
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => activatePanel(button.dataset.panel));
  });
  activatePanel(sessionStorage.getItem("dualsub-settings-panel") || "general");
  enableTabKeyboardNavigation(".tab-button", (button) => activatePanel(button.dataset.panel));
  document.querySelectorAll(".appearance-button").forEach((button) => {
    button.addEventListener("click", () => activateAppearance(button.dataset.appearance));
  });
  activateAppearance(sessionStorage.getItem("dualsub-appearance-language") || "source");
  enableTabKeyboardNavigation(".appearance-button", (button) => activateAppearance(button.dataset.appearance));
  document.querySelectorAll(".tool-button").forEach((button) => {
    button.addEventListener("click", () => activateToolPane(button.dataset.toolPane));
  });
  activateToolPane(sessionStorage.getItem("dualsub-tools-pane") || "lookup");
  enableTabKeyboardNavigation(".tool-button", (button) => activateToolPane(button.dataset.toolPane));
  const defaultResponse = await browser.runtime.sendMessage({ type: "get-default-settings" });
  defaults = defaultResponse.settings;
  const stored = await browser.storage.sync.get("settings");
  const storedWordGroupColors = { ...defaults.wordGroupColors, ...(stored.settings?.wordGroupColors || {}) };
  if (!stored.settings?.wordGroupPaletteVersion && storedWordGroupColors.verb === "#fb7185" && storedWordGroupColors.adjective === "#c084fc") {
    storedWordGroupColors.verb = defaults.wordGroupColors.verb;
    storedWordGroupColors.adjective = defaults.wordGroupColors.adjective;
  }
  settings = {
    ...defaults,
    ...(stored.settings || {}),
    wordGroupPaletteVersion: 2,
    wordGroupColors: storedWordGroupColors,
    sourceStyle: { ...defaults.sourceStyle, ...(stored.settings?.sourceStyle || {}) },
    targetStyle: { ...defaults.targetStyle, ...(stored.settings?.targetStyle || {}) }
  };
  loadPronunciationVoices();
  setFormValues();
  updateProviderFields();
  const providerResponse = await browser.runtime.sendMessage({ type: "get-provider-secrets" }).catch(() => null);
  if (providerResponse?.ok) {
    element("azureKey").placeholder = providerResponse.secrets.azureKey ? "Saved · enter a replacement" : "Paste an Azure Translator key";
    element("azureRegion").value = providerResponse.secrets.azureRegion || "";
    element("deeplKey").placeholder = providerResponse.secrets.deeplKey ? "Saved · enter a replacement" : "Paste a DeepL API key";
    element("libreEndpoint").value = providerResponse.secrets.libreEndpoint || "";
    element("libreApiKey").placeholder = providerResponse.secrets.libreApiKey ? "Saved · enter a replacement" : "Optional";
  }
  const cacheResponse = await browser.runtime.sendMessage({ type: "get-translation-cache-stats" }).catch(() => null);
  if (cacheResponse?.ok) element("cacheStatus").textContent = `${cacheResponse.cache.entries} cached translations`;
  ids.forEach((id) => {
    element(id).addEventListener("input", scheduleSave);
    element(id).addEventListener("change", scheduleSave);
  });
  element("translationProvider").addEventListener("change", updateProviderFields);
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
    updateProviderFields();
    browser.storage.sync.set({ settings });
  });
  element("openVocabulary").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
    window.close();
  });
  element("openVocabularyQuick").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") });
    window.close();
  });
  element("openTranslator").addEventListener("click", () => {
    browser.tabs.create({ url: browser.runtime.getURL("tools/translator.html") });
    window.close();
  });
  element("captureText").addEventListener("click", async () => {
    const button = element("captureText");
    button.disabled = true;
    button.textContent = "Capturing…";
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.windowId || !tab.url?.includes("youtube.com/")) throw new Error("Open a YouTube video first.");
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 92 });
      await browser.storage.local.set({
        ocrCaptureV1: { dataUrl, capturedAt: Date.now(), sourceUrl: tab.url }
      });
      await browser.tabs.create({ url: browser.runtime.getURL("tools/translator.html#ocr") });
      window.close();
    } catch (error) {
      const statusNode = element("playerStatus");
      statusNode.textContent = error.message || "Could not capture the visible tab.";
      statusNode.dataset.state = "error";
      button.disabled = false;
      button.textContent = "Capture text (OCR)";
    }
  });
  element("openSidebar").addEventListener("click", async () => {
    try {
      await browser.sidebarAction.open();
      window.close();
    } catch (_error) {
      const statusNode = element("playerStatus");
      statusNode.textContent = "Use View → Sidebar → DualSub transcript, or press Alt+Shift+T.";
      statusNode.dataset.state = "error";
    }
  });
  element("openShortcuts").addEventListener("click", () => {
    browser.tabs.create({ url: "about:addons" }).catch(() => {
      element("playerStatus").textContent = "Open about:addons → Extensions → Manage Extension Shortcuts.";
    });
  });
  element("previewPronunciation").addEventListener("click", previewPronunciation);
  element("saveVideoProfile").addEventListener("click", async () => {
    const button = element("saveVideoProfile");
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const response = tab?.id ? await browser.tabs.sendMessage(tab.id, {
        type: "save-current-video-profile",
        profile: { captionOffsetMs: Number(element("captionOffsetMs").value), studyMode: element("studyMode").value }
      }) : null;
      if (!response?.ok) throw new Error(response?.error || "Open a video first.");
      button.textContent = "Saved for this video";
    } catch (_error) {
      button.textContent = "Open a video first";
    }
    setTimeout(() => { button.textContent = "Remember timing and mode for this video"; }, 1800);
  });
  element("saveProvider").addEventListener("click", async () => {
    const statusNode = element("providerStatus");
    statusNode.textContent = "Saving…";
    try {
      const provider = element("translationProvider").value;
      let origin = "";
      if (provider === "azure") origin = "https://api.cognitive.microsofttranslator.com/*";
      if (provider === "deepl") origin = "https://api-free.deepl.com/*";
      if (provider === "libretranslate" && element("libreEndpoint").value) {
        origin = `${new URL(element("libreEndpoint").value).origin}/*`;
      }
      if (origin) {
        const granted = await browser.permissions.request({ origins: [origin] });
        if (!granted) throw new Error("Provider permission was not granted.");
      }
      const secrets = {
        azureRegion: element("azureRegion").value.trim(),
        libreEndpoint: element("libreEndpoint").value.trim()
      };
      if (element("azureKey").value.trim()) secrets.azureKey = element("azureKey").value.trim();
      if (element("deeplKey").value.trim()) secrets.deeplKey = element("deeplKey").value.trim();
      if (element("libreApiKey").value.trim()) secrets.libreApiKey = element("libreApiKey").value.trim();
      const response = await browser.runtime.sendMessage({ type: "save-provider-secrets", secrets });
      if (!response?.ok) throw new Error(response?.error || "Could not save provider access.");
      element("azureKey").value = "";
      element("deeplKey").value = "";
      element("libreApiKey").value = "";
      statusNode.textContent = "Saved locally";
    } catch (error) {
      statusNode.textContent = error.message;
    }
  });
  element("clearProvider").addEventListener("click", async () => {
    const statusNode = element("providerStatus");
    const response = await browser.runtime.sendMessage({
      type: "save-provider-secrets",
      secrets: { azureKey: "", azureRegion: "", deeplKey: "", libreEndpoint: "", libreApiKey: "" }
    });
    statusNode.textContent = response?.ok ? "Saved keys removed" : (response?.error || "Could not remove keys");
    if (response?.ok) {
      element("azureRegion").value = "";
      element("libreEndpoint").value = "";
    }
  });
  element("clearTranslationCache").addEventListener("click", async () => {
    const response = await browser.runtime.sendMessage({ type: "clear-translation-cache" });
    element("cacheStatus").textContent = response?.ok ? "Cache cleared" : (response?.error || "Could not clear cache");
  });
  window.speechSynthesis?.addEventListener?.("voiceschanged", loadPronunciationVoices);
  setTimeout(loadPronunciationVoices, 250);
  element("copyDiagnostics").addEventListener("click", async () => {
    const button = element("copyDiagnostics");
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const [response, health] = await Promise.all([
        tab?.id ? browser.tabs.sendMessage(tab.id, { type: "get-diagnostics" }) : null,
        browser.runtime.sendMessage({ type: "get-translation-health" })
      ]);
      if (!response?.ok) throw new Error("Open a YouTube video first.");
      await copyText(JSON.stringify({ ...response.diagnostics, translationHealth: health?.health || null }, null, 2));
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
