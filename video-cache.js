(() => {
  const STORE = "videos";
  const FALLBACK = "videoCaptionCacheV1";
  const MAX_AGE = 30 * 86400000;
  const MAX_VIDEOS = 30;
  const MAX_ENTRY_BYTES = 2_000_000;
  const FALLBACK_BYTES = 3_000_000;
  let databasePromise;
  let queue = Promise.resolve();

  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  }

  function key(scope = {}) {
    const fields = [scope.videoId, scope.sourceLanguage, scope.targetLanguage, scope.provider,
      scope.sourceTrack, scope.targetTrack, scope.endpoint || ""];
    if (!fields[0] || fields.some((value) => typeof value !== "string" || value.length > 1000)) throw new Error("Invalid video cache identity.");
    return JSON.stringify([1, ...fields]);
  }

  function openDatabase() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (!databasePromise) databasePromise = new Promise((resolve) => {
      const request = indexedDB.open("dualsub-video-cache", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("savedAt", "savedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return databasePromise;
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Video cache read failed."));
    });
  }

  function complete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Video cache write failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Video cache write aborted."));
    });
  }

  async function read(cacheKey) {
    const database = await openDatabase();
    if (database) return requestValue(database.transaction(STORE).objectStore(STORE).get(cacheKey));
    return (await browser.storage.local.get(FALLBACK))[FALLBACK]?.[cacheKey];
  }

  function valid(entry) {
    return entry && Number.isFinite(entry.capturedAt) && Date.now() - entry.capturedAt < MAX_AGE;
  }

  function cues(values) {
    if (!Array.isArray(values) || values.length > 15000) throw new Error("Invalid cached caption list.");
    let previous = -1;
    return values.map((cue) => {
      if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous || cue.start < 0 || cue.end < cue.start || typeof cue.text !== "string" || cue.text.length > 20000) throw new Error("Invalid cached caption.");
      previous = cue.start;
      const result = { start: cue.start, end: cue.end, text: cue.text };
      if (Array.isArray(cue.fragments)) result.fragments = cue.fragments.slice(0, 500).map((fragment) => {
        if (!Number.isFinite(fragment.start) || !Number.isFinite(fragment.end) || typeof fragment.text !== "string" || fragment.text.length > 20000) throw new Error("Invalid caption fragment.");
        return { start: fragment.start, end: fragment.end, text: fragment.text, append: Boolean(fragment.append) };
      });
      return result;
    });
  }

  function translations(values, source) {
    const result = new Map();
    for (const item of (Array.isArray(values) ? values : []).slice(0, source.length)) {
      if (!Number.isInteger(item?.index) || !source[item.index] || typeof item.text !== "string" || !item.text || item.text.length > 20000) continue;
      result.set(item.index, {
        index: item.index, text: item.text,
        alignment: (Array.isArray(item.alignment) ? item.alignment : []).slice(0, 1000).filter((span) =>
          [span?.sourceStart, span?.sourceEnd, span?.targetStart, span?.targetEnd].every((value) => Number.isInteger(value) && value >= 0)
        ).map(({ sourceStart, sourceEnd, targetStart, targetEnd }) => ({ sourceStart, sourceEnd, targetStart, targetEnd })),
        alignmentKind: ["character", "segment"].includes(item.alignmentKind) ? item.alignmentKind : "none",
        provenance: String(item.provenance || "").slice(0, 100)
      });
    }
    return result;
  }

  function get(scope) {
    return serialize(async () => {
      const entry = await read(key(scope));
      return valid(entry) ? { sourceCues: entry.sourceCues, targetCues: entry.targetCues,
        translations: entry.translations, capturedAt: entry.capturedAt } : null;
    });
  }

  function save(scope, snapshot = {}) {
    return serialize(async () => {
      const cacheKey = key(scope);
      const sourceCues = cues(snapshot.sourceCues), targetCues = cues(snapshot.targetCues);
      if (!sourceCues.length) return false;
      const incoming = translations(snapshot.translations, sourceCues);
      const previous = await read(cacheKey);
      const sameSource = valid(previous) && JSON.stringify(previous.sourceCues) === JSON.stringify(sourceCues);
      const merged = sameSource ? translations(previous.translations, sourceCues) : new Map();
      incoming.forEach((value, index) => merged.set(index, value));
      const now = Date.now();
      const entry = { key: cacheKey, sourceCues,
        targetCues: targetCues.length ? targetCues : (sameSource ? previous.targetCues : []),
        translations: Array.from(merged.values()), savedAt: now,
        capturedAt: Number.isFinite(snapshot.capturedAt) ? Math.min(now, snapshot.capturedAt) : now };
      if (!valid(entry) || new TextEncoder().encode(JSON.stringify(entry)).byteLength > MAX_ENTRY_BYTES) return false;
      const database = await openDatabase();
      if (database) {
        const transaction = database.transaction(STORE, "readwrite");
        const store = transaction.objectStore(STORE);
        store.put(entry);
        const cursorRequest = store.index("savedAt").openCursor(null, "prev");
        let count = 0;
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (!valid(cursor.value) || ++count > MAX_VIDEOS) cursor.delete();
          cursor.continue();
        };
        await complete(transaction);
      } else {
        const stored = (await browser.storage.local.get(FALLBACK))[FALLBACK] || {};
        stored[cacheKey] = entry;
        let bytes = 0;
        const retained = Object.values(stored).filter(valid).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_VIDEOS)
          .filter((value) => { bytes += new TextEncoder().encode(JSON.stringify(value)).byteLength; return bytes <= FALLBACK_BYTES; });
        await browser.storage.local.set({ [FALLBACK]: Object.fromEntries(retained.map((value) => [value.key, value])) });
      }
      return true;
    });
  }

  function clear() {
    return serialize(async () => {
      const database = await openDatabase();
      if (database) {
        const transaction = database.transaction(STORE, "readwrite");
        transaction.objectStore(STORE).clear();
        await complete(transaction);
      }
      await browser.storage.local.set({ [FALLBACK]: {} });
    });
  }

  globalThis.DualSubVideoCache = Object.freeze({ get, save, clear, key });
})();
