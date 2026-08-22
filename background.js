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
  hoverDelay: 420,
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
  if (translationCache.size > 250) {
    translationCache.delete(translationCache.keys().next().value);
  }
  return result;
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
  if (command !== "toggle-dualsub") return;
  const settings = await getSettings();
  settings.enabled = !settings.enabled;
  await saveSettings(settings);
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
  return undefined;
});
