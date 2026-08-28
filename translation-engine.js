(function initializeDualSubTranslation(globalScope) {
  "use strict";

  const DB_NAME = "dualsub-translation-cache";
  const DB_VERSION = 1;
  const STORE_NAME = "translations";
  const FALLBACK_CACHE_KEY = "lineTranslationCacheV2";
  const FALLBACK_CACHE_LIMIT = 2400;
  const MAX_CACHE_AGE_MS = 180 * 24 * 60 * 60_000;
  const SECRET_KEY = "translationProviderSecretsV1";
  const circuitState = new Map();
  const activeSessions = new Map();
  const metrics = {
    requests: 0,
    batches: 0,
    cacheHits: 0,
    failures: 0,
    rateLimits: 0,
    characters: 0,
    lastLatencyMs: 0,
    lastProvider: "",
    lastError: ""
  };
  let databasePromise;

  function normalizeProvider(value) {
    return ["azure", "deepl", "libretranslate", "mymemory"].includes(value) ? value : "google";
  }

  function cleanText(value, limit = 50_000) {
    return String(value || "").replace(/\u200b/g, "").trim().slice(0, limit);
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cacheKeyFor(item, options) {
    const identity = item.cacheId || `${item.start || 0}|${item.end || 0}|${hashText(item.text)}|${hashText(options.context)}`;
    return [
      "v2",
      options.provider,
      options.sourceLanguage,
      options.targetLanguage,
      options.providerVersion || "default",
      options.videoId || "lookup",
      identity
    ].join("|");
  }

  function parseRetryAfter(response, attempt = 0) {
    const header = Number(response?.headers?.get?.("retry-after"));
    if (Number.isFinite(header) && header > 0) return Math.min(300_000, header * 1000);
    return Math.min(120_000, 1500 * (2 ** Math.min(6, attempt)) + Math.floor(Math.random() * 800));
  }

  function providerError(message, code, response, retryAfterMs = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = Number(response?.status || 0);
    error.retryAfterMs = retryAfterMs;
    return error;
  }

  function circuitFor(provider) {
    if (!circuitState.has(provider)) {
      circuitState.set(provider, { failures: 0, blockedUntil: 0, reason: "" });
    }
    return circuitState.get(provider);
  }

  function assertCircuitAvailable(provider) {
    const circuit = circuitFor(provider);
    if (circuit.blockedUntil > Date.now()) {
      throw providerError(
        `${provider} is paused until ${new Date(circuit.blockedUntil).toLocaleTimeString()}.`,
        "PROVIDER_CIRCUIT_OPEN",
        null,
        circuit.blockedUntil - Date.now()
      );
    }
  }

  function recordProviderSuccess(provider) {
    const circuit = circuitFor(provider);
    circuit.failures = 0;
    circuit.blockedUntil = 0;
    circuit.reason = "";
  }

  function recordProviderFailure(provider, error) {
    const circuit = circuitFor(provider);
    circuit.failures += 1;
    circuit.reason = error.code || error.message;
    if (error.status === 429 || error.code === "MYMEMORY_RATE_LIMITED") {
      metrics.rateLimits += 1;
      circuit.blockedUntil = Date.now() + Math.max(60_000, error.retryAfterMs || 60_000);
    } else if (circuit.failures >= 3) {
      circuit.blockedUntil = Date.now() + Math.min(120_000, circuit.failures * 15_000);
    }
  }

  async function providerSecrets() {
    const stored = await browser.storage.local.get(SECRET_KEY);
    return {
      azureKey: "",
      azureRegion: "",
      deeplKey: "",
      libreEndpoint: "",
      libreApiKey: "",
      ...(stored[SECRET_KEY] || {})
    };
  }

  async function saveProviderSecrets(value = {}) {
    const current = await providerSecrets();
    const sanitized = {
      azureKey: cleanText(value.azureKey ?? current.azureKey, 256),
      azureRegion: cleanText(value.azureRegion ?? current.azureRegion, 80),
      deeplKey: cleanText(value.deeplKey ?? current.deeplKey, 256),
      libreEndpoint: cleanText(value.libreEndpoint ?? current.libreEndpoint, 500),
      libreApiKey: cleanText(value.libreApiKey ?? current.libreApiKey, 256)
    };
    await browser.storage.local.set({ [SECRET_KEY]: sanitized });
    return { ...sanitized, azureKey: sanitized.azureKey ? "saved" : "", deeplKey: sanitized.deeplKey ? "saved" : "", libreApiKey: sanitized.libreApiKey ? "saved" : "" };
  }

  async function fetchControlled(url, init, provider, sessionId, attempt = 0) {
    assertCircuitAvailable(provider);
    const controller = new AbortController();
    const session = activeSessions.get(sessionId) || new Set();
    session.add(controller);
    activeSessions.set(sessionId, session);
    const timeout = setTimeout(() => controller.abort("timeout"), 20_000);
    const started = performance.now();
    try {
      metrics.requests += 1;
      const response = await fetch(url, { ...init, signal: controller.signal, credentials: "omit" });
      metrics.lastLatencyMs = Math.round(performance.now() - started);
      const providerLabel = { google: "Google", mymemory: "MyMemory", azure: "Azure", deepl: "DeepL", libretranslate: "LibreTranslate" }[provider] || provider;
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response, attempt);
        throw providerError(`${providerLabel} rate limit reached. Translation will resume automatically.`, "PROVIDER_RATE_LIMITED", response, retryAfterMs);
      }
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 408;
        throw providerError(`${providerLabel} translation failed (HTTP ${response.status}).`, retryable ? "PROVIDER_TEMPORARY_FAILURE" : "PROVIDER_REQUEST_FAILED", response);
      }
      return response;
    } catch (error) {
      if (error?.name === "AbortError") throw providerError("Translation request cancelled.", "TRANSLATION_CANCELLED");
      throw error;
    } finally {
      clearTimeout(timeout);
      session.delete(controller);
      if (!session.size) activeSessions.delete(sessionId);
    }
  }

  function parseAzureAlignment(projection) {
    return String(projection || "").split(/\s+/u).map((entry) => {
      const match = entry.match(/^(\d+):(\d+)-(\d+):(\d+)$/u);
      return match ? {
        sourceStart: Number(match[1]), sourceEnd: Number(match[2]),
        targetStart: Number(match[3]), targetEnd: Number(match[4])
      } : null;
    }).filter(Boolean);
  }

  async function translateAzure(texts, options, secrets, sessionId) {
    if (!secrets.azureKey) throw providerError("Add an Azure Translator key in settings first.", "AZURE_KEY_REQUIRED");
    const url = new URL("https://api.cognitive.microsofttranslator.com/translate");
    url.searchParams.set("api-version", "3.0");
    url.searchParams.set("from", options.sourceLanguage);
    url.searchParams.set("to", options.targetLanguage);
    url.searchParams.set("includeAlignment", "true");
    url.searchParams.set("includeSentenceLength", "true");
    const headers = {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": secrets.azureKey,
      "X-ClientTraceId": crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
    };
    if (secrets.azureRegion) headers["Ocp-Apim-Subscription-Region"] = secrets.azureRegion;
    const response = await fetchControlled(url.toString(), {
      method: "POST", headers, body: JSON.stringify(texts.map((text) => ({ Text: text })))
    }, "azure", sessionId);
    const payload = await response.json();
    return payload.map((item, index) => {
      const translation = item?.translations?.[0] || {};
      return {
        sourceText: texts[index], translatedText: cleanText(translation.text), provider: "azure",
        alignment: parseAzureAlignment(translation.alignment?.proj),
        sentenceLengths: translation.sentLen || null,
        provenance: translation.alignment?.proj ? "Azure aligned" : "Azure neural"
      };
    });
  }

  async function translateDeepL(texts, options, secrets, sessionId) {
    if (!secrets.deeplKey) throw providerError("Add a DeepL API key in settings first.", "DEEPL_KEY_REQUIRED");
    const parameters = new URLSearchParams();
    texts.forEach((text) => parameters.append("text", text));
    parameters.set("source_lang", options.sourceLanguage.toUpperCase());
    parameters.set("target_lang", options.targetLanguage.toUpperCase());
    if (options.context) parameters.set("context", cleanText(options.context, 10_000));
    const response = await fetchControlled("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${secrets.deeplKey}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: parameters.toString()
    }, "deepl", sessionId);
    const payload = await response.json();
    return texts.map((text, index) => ({
      sourceText: text, translatedText: cleanText(payload?.translations?.[index]?.text),
      provider: "deepl", alignment: [], provenance: "DeepL contextual"
    }));
  }

  async function translateLibre(texts, options, secrets, sessionId) {
    let endpoint;
    try {
      endpoint = new URL(secrets.libreEndpoint || "");
    } catch (_error) {
      throw providerError("Add a valid LibreTranslate endpoint in settings first.", "LIBRE_ENDPOINT_REQUIRED");
    }
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
      throw providerError("LibreTranslate must use HTTPS or localhost.", "LIBRE_ENDPOINT_INVALID");
    }
    const results = [];
    for (const text of texts) {
      const response = await fetchControlled(new URL("translate", endpoint.href.endsWith("/") ? endpoint : `${endpoint.href}/`).toString(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: text, source: options.sourceLanguage, target: options.targetLanguage, api_key: secrets.libreApiKey || undefined })
      }, "libretranslate", sessionId);
      const payload = await response.json();
      results.push({ sourceText: text, translatedText: cleanText(payload?.translatedText), provider: "libretranslate", alignment: [], provenance: "LibreTranslate" });
    }
    return results;
  }

  async function translateGoogle(texts, options, _secrets, sessionId) {
    const results = new Array(texts.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < texts.length) {
        const index = cursor;
        cursor += 1;
        const text = texts[index];
        const url = new URL("https://translate.googleapis.com/translate_a/single");
        url.searchParams.set("client", "gtx");
        url.searchParams.set("sl", options.sourceLanguage);
        url.searchParams.set("tl", options.targetLanguage);
        url.searchParams.set("dt", "t");
        url.searchParams.set("q", text);
        const response = await fetchControlled(url.toString(), {}, "google", sessionId);
        const payload = await response.json();
        const parts = Array.isArray(payload?.[0]) ? payload[0] : [];
        const translatedText = parts.map((part) => part?.[0] || "").join("").trim();
        if (!translatedText) throw providerError("Google returned no translation.", "PROVIDER_EMPTY_RESPONSE");
        const segmented = [];
        let sourceCursor = 0;
        let targetCursor = 0;
        for (const part of parts) {
          const targetPart = String(part?.[0] || "");
          const sourcePart = String(part?.[1] || "");
          const sourceStart = sourcePart ? text.indexOf(sourcePart, sourceCursor) : -1;
          const targetStart = targetPart ? translatedText.indexOf(targetPart.trim(), targetCursor) : -1;
          if (sourceStart >= 0 && targetStart >= 0 && sourcePart.trim() && targetPart.trim()) {
            segmented.push({
              sourceStart,
              sourceEnd: sourceStart + sourcePart.length - 1,
              targetStart,
              targetEnd: targetStart + targetPart.trim().length - 1
            });
            sourceCursor = sourceStart + sourcePart.length;
            targetCursor = targetStart + targetPart.trim().length;
          }
        }
        const informativeAlignment = segmented.length > 1 ? segmented : [];
        results[index] = {
          sourceText: text,
          translatedText,
          provider: "google",
          alignment: informativeAlignment,
          provenance: informativeAlignment.length ? "Google segmented" : "Google web"
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
    return results;
  }

  async function translateMyMemory(texts, options, settings, sessionId) {
    const results = [];
    for (const text of texts) {
      const url = new URL("https://api.mymemory.translated.net/get");
      url.searchParams.set("q", text.slice(0, 490));
      url.searchParams.set("langpair", `${options.sourceLanguage}|${options.targetLanguage}`);
      if (settings.mymemoryEmail?.trim()) url.searchParams.set("de", settings.mymemoryEmail.trim());
      let response;
      try {
        response = await fetchControlled(url.toString(), {}, "mymemory", sessionId);
      } catch (error) {
        if (error.status === 429) {
          error.code = "MYMEMORY_RATE_LIMITED";
          error.message = "MyMemory's free translation limit has been reached. It will not be used automatically.";
        }
        throw error;
      }
      const payload = await response.json();
      if (Number(payload?.responseStatus) === 429) {
        throw providerError("MyMemory's free limit is exhausted. It will not be used automatically.", "MYMEMORY_RATE_LIMITED", { status: 429 }, 120_000);
      }
      const translatedText = cleanText(payload?.responseData?.translatedText);
      if (!translatedText) throw providerError(payload?.responseDetails || "MyMemory returned no translation.", "PROVIDER_EMPTY_RESPONSE");
      results.push({ sourceText: text, translatedText, provider: "mymemory", alignment: [], provenance: "MyMemory" });
    }
    return results;
  }

  function openDatabase() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("savedAt", "savedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return databasePromise;
  }

  async function cachedResults(keys) {
    const database = await openDatabase();
    if (database) {
      return Promise.all(keys.map((key) => new Promise((resolve) => {
        const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
        request.onsuccess = () => {
          const entry = request.result;
          resolve(entry && Date.now() - entry.savedAt < MAX_CACHE_AGE_MS ? entry.result : null);
        };
        request.onerror = () => resolve(null);
      })));
    }
    const stored = await browser.storage.local.get(FALLBACK_CACHE_KEY);
    const entries = stored[FALLBACK_CACHE_KEY] || {};
    return keys.map((key) => entries[key] && Date.now() - entries[key].savedAt < MAX_CACHE_AGE_MS ? entries[key].result : null);
  }

  async function cacheResults(entries) {
    const database = await openDatabase();
    if (database) {
      await new Promise((resolve) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        entries.forEach((entry) => store.put(entry));
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      });
      await pruneDatabase(database);
      return;
    }
    const stored = await browser.storage.local.get(FALLBACK_CACHE_KEY);
    const cache = { ...(stored[FALLBACK_CACHE_KEY] || {}) };
    entries.forEach((entry) => { cache[entry.key] = entry; });
    const compact = Object.fromEntries(Object.entries(cache)
      .sort((left, right) => Number(right[1].savedAt) - Number(left[1].savedAt))
      .slice(0, FALLBACK_CACHE_LIMIT));
    await browser.storage.local.set({ [FALLBACK_CACHE_KEY]: compact });
  }

  async function pruneDatabase(database, maximum = 5000) {
    await new Promise((resolve) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const request = transaction.objectStore(STORE_NAME).index("savedAt").openCursor(null, "prev");
      let retained = 0;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        retained += 1;
        if (retained > maximum || Date.now() - Number(cursor.value?.savedAt || 0) > MAX_CACHE_AGE_MS) cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
  }

  async function cacheStats() {
    const database = await openDatabase();
    let entries = 0;
    if (database) {
      entries = await new Promise((resolve) => {
        const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).count();
        request.onsuccess = () => resolve(request.result || 0);
        request.onerror = () => resolve(0);
      });
    } else {
      const stored = await browser.storage.local.get(FALLBACK_CACHE_KEY);
      entries = Object.keys(stored[FALLBACK_CACHE_KEY] || {}).length;
    }
    let estimate = null;
    try {
      if (globalThis.navigator?.storage?.estimate) estimate = await globalThis.navigator.storage.estimate();
    } catch (_error) {
      // Storage estimates are optional and do not affect cache operation.
    }
    return { entries, usageBytes: Number(estimate?.usage || 0), quotaBytes: Number(estimate?.quota || 0) };
  }

  async function clearCache() {
    const database = await openDatabase();
    if (database) {
      await new Promise((resolve) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = resolve;
        transaction.onerror = resolve;
      });
    }
    await browser.storage.local.set({ [FALLBACK_CACHE_KEY]: {} });
  }

  async function translateBatch(rawItems, rawOptions = {}, settings = {}) {
    const items = (Array.isArray(rawItems) ? rawItems : []).map((item, index) => ({
      ...item, index, text: cleanText(item?.text)
    })).filter((item) => item.text).slice(0, 1000);
    if (!items.length) return { results: [], health: health() };
    const options = {
      provider: normalizeProvider(rawOptions.provider || settings.translationProvider),
      sourceLanguage: rawOptions.sourceLanguage || "fr",
      targetLanguage: rawOptions.targetLanguage || "en",
      videoId: cleanText(rawOptions.videoId, 64),
      context: cleanText(rawOptions.context, 10_000),
      providerVersion: cleanText(rawOptions.providerVersion, 40),
      sessionId: cleanText(rawOptions.sessionId, 120) || `lookup-${Date.now()}`
    };
    assertCircuitAvailable(options.provider);
    metrics.batches += 1;
    metrics.lastProvider = options.provider;
    const keys = items.map((item) => cacheKeyFor(item, options));
    const cached = await cachedResults(keys);
    const results = new Array(items.length);
    const missing = [];
    items.forEach((item, index) => {
      if (cached[index]?.translatedText) {
        results[index] = { ...cached[index], cacheHit: true };
        metrics.cacheHits += 1;
      } else {
        missing.push({ item, index, key: keys[index] });
      }
    });
    if (missing.length) {
      const texts = missing.map(({ item }) => item.text);
      const secrets = await providerSecrets();
      const translators = {
        azure: translateAzure,
        deepl: translateDeepL,
        libretranslate: translateLibre,
        mymemory: translateMyMemory,
        google: translateGoogle
      };
      try {
        metrics.characters += texts.reduce((total, text) => total + text.length, 0);
        const translated = await translators[options.provider](texts, options, options.provider === "mymemory" ? settings : secrets, options.sessionId);
        const savedAt = Date.now();
        const cacheEntries = [];
        missing.forEach(({ item, index, key }, translatedIndex) => {
          const result = { ...translated[translatedIndex], sourceText: item.text, cacheHit: false };
          results[index] = result;
          cacheEntries.push({ key, savedAt, result });
        });
        await cacheResults(cacheEntries);
        recordProviderSuccess(options.provider);
      } catch (error) {
        metrics.failures += 1;
        metrics.lastError = error.message;
        recordProviderFailure(options.provider, error);
        throw error;
      }
    }
    return { results, health: health() };
  }

  function cancelSession(sessionId) {
    const session = activeSessions.get(sessionId);
    session?.forEach((controller) => controller.abort("session-cancelled"));
    activeSessions.delete(sessionId);
  }

  function health() {
    return {
      ...metrics,
      circuits: Object.fromEntries(Array.from(circuitState, ([provider, state]) => [provider, { ...state }])),
      activeSessions: activeSessions.size
    };
  }

  globalScope.DualSubTranslation = Object.freeze({
    translateBatch,
    cancelSession,
    health,
    providerSecrets,
    saveProviderSecrets,
    cacheStats,
    clearCache,
    parseAzureAlignment,
    cacheKeyFor,
    normalizeProvider
  });
})(globalThis);
