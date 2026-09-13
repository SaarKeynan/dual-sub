(() => {
  const DB_NAME = "dualsub-dictionary";
  const DB_VERSION = 1;
  const ENTRIES = "entries";
  const META = "meta";
  const SOURCE = "vendor/wiktionary/french-english.txt";
  // The first 16 hex characters of the shipped file's SHA-256, so a changed file
  // replaces a stale store. tests/smoke.test.js recomputes it from the file and
  // from vendor/wiktionary/SOURCE.md, so regenerating the data without updating
  // both fails the suite.
  const DATA_VERSION = "f5a21d1d91f78feb";
  const BATCH = 2000;
  // The labels language/french.js gives a reading. Any other group, including
  // "unknown", is no reading at all.
  const GROUPS = new Set(["noun", "verb", "adjective", "adverb", "pronoun", "determiner", "preposition", "conjunction", "interjection"]);

  let databasePromise = null;
  let connection = null;
  let importPromise = null;
  let state = "idle";

  // Drops a connection that can no longer answer, so the next lookup opens a
  // fresh one instead of failing until the event page restarts. An import
  // running on it will fail too, so it is forgotten with it.
  function forget(database) {
    if (!database || connection !== database) return;
    connection = null;
    databasePromise = null;
    importPromise = null;
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    const attempt = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      // A failed or blocked open answers null for the lookups waiting on it,
      // but is not remembered: the event page outlives it, so the next lookup
      // tries the open again instead of answering null until a restart.
      const giveUp = () => {
        if (databasePromise === attempt) databasePromise = null;
        resolve(null);
      };
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (_error) {
        // Not yet assigned while the executor runs, so reset after it returns.
        Promise.resolve().then(giveUp);
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ENTRIES)) database.createObjectStore(ENTRIES, { keyPath: "lemma" });
        if (!database.objectStoreNames.contains(META)) database.createObjectStore(META, { keyPath: "id" });
      };
      request.onsuccess = () => {
        const database = request.result;
        // A blocked open can still succeed later. Its callers already have
        // null and a newer open may own the connection, so close this one.
        if (databasePromise !== attempt) { database.close(); return; }
        connection = database;
        // Firefox closes the connection itself when site data is cleared or
        // storage fails; another context upgrading the database asks it to go.
        database.onclose = () => forget(database);
        database.onversionchange = () => {
          database.close();
          forget(database);
        };
        resolve(database);
      };
      request.onerror = giveUp;
      request.onblocked = giveUp;
    });
    databasePromise = attempt;
    return attempt;
  }

  function readOne(database, store, key) {
    return new Promise((resolve) => {
      const request = database.transaction(store).objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  function writeBatch(database, rows) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(ENTRIES, "readwrite");
      const store = transaction.objectStore(ENTRIES);
      for (const row of rows) store.put(row);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  // The version record is written last and only on success. An import cut short
  // by the event page terminating leaves no record, so the next lookup redoes it
  // rather than trusting a partial dictionary.
  async function importDictionary(database) {
    state = "importing";
    const response = await fetch(browser.runtime.getURL(SOURCE));
    if (!response.ok) throw new Error(`Dictionary resource returned ${response.status}`);
    const text = await response.text();
    // Replace rather than overlay: a lemma the new file removed must not
    // survive from the old one. The version record goes with it, so an import
    // cut short after this point is redone.
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([ENTRIES, META], "readwrite");
      transaction.objectStore(ENTRIES).clear();
      transaction.objectStore(META).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    let rows = [];
    for (const line of text.split("\n")) {
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      rows.push({ lemma: line.slice(0, tab), parts: line.slice(tab + 1) });
      if (rows.length >= BATCH) { await writeBatch(database, rows); rows = []; }
    }
    if (rows.length) await writeBatch(database, rows);
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(META, "readwrite");
      transaction.objectStore(META).put({ id: "version", value: DATA_VERSION });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    state = "ready";
  }

  async function ready() {
    const database = await openDatabase();
    if (!database) { state = "unavailable"; return null; }
    let stored;
    try {
      stored = await readOne(database, META, "version");
    } catch (error) {
      forget(database);
      throw error;
    }
    if (stored?.value === DATA_VERSION) { state = "ready"; return database; }
    if (!importPromise) {
      const attempt = importDictionary(database).catch((error) => {
        state = "unavailable";
        // A newer attempt may already have replaced this one.
        if (importPromise === attempt) importPromise = null;
        throw error;
      });
      importPromise = attempt;
    }
    await importPromise;
    return database;
  }

  // Keys are written lowercased, NFC, and with œ/æ folded to oe/ae, because
  // Wiktionary files cœur under œ where Lexique spells coeur. A caption spelled
  // either way must reach the same key.
  function headword(value) {
    return String(value || "").trim().toLocaleLowerCase("fr").normalize("NFC").replace(/œ/g, "oe").replace(/æ/g, "ae");
  }

  async function readParts(database, word) {
    let row;
    try {
      row = await readOne(database, ENTRIES, word);
    } catch (_error) {
      forget(database);
      return undefined;
    }
    if (!row) return null;
    try {
      const parts = JSON.parse(row.parts);
      return Array.isArray(parts) && parts.length ? parts : null;
    } catch (_error) {
      return null;
    }
  }

  // `candidates` is one headword or an ordered list of them: the content script
  // sends the surface word and Lexique's lemma for most readings, and the
  // infinitive for a verb. The first candidate with a part of speech matching
  // the reading answers. A reading nothing matches is a miss, so an engine
  // answers "la maison" rather than the pronoun "her, it". Only with no reading
  // does the first candidate that has an entry answer with its first part.
  async function lookup(candidates, group = "") {
    const words = (Array.isArray(candidates) ? candidates : [candidates])
      .map(headword)
      .filter((word, index, values) => word && values.indexOf(word) === index);
    if (!words.length) return null;
    let database;
    try { database = await ready(); } catch (_error) { return null; }
    if (!database) return null;
    const labelled = GROUPS.has(group);
    for (const word of words) {
      const parts = await readParts(database, word);
      if (parts === undefined) return null;
      if (!parts) continue;
      const chosen = labelled ? parts.find((part) => part.pos === group) : parts[0];
      if (chosen) return { senses: chosen.senses || [], pos: chosen.pos || "", gender: chosen.gender || "" };
    }
    return null;
  }

  // Waits out any import already writing against this same database handle
  // before wiping. Otherwise a clear() that lands mid-import cannot stop it:
  // the import would go on to write its later batches, and finally the
  // version record, straight into the store clear() just emptied, leaving
  // `ready()` convinced a store missing everything clear() removed is
  // current.
  async function clear() {
    const database = await openDatabase();
    if (!database) return;
    const pending = importPromise;
    if (pending) await pending.catch(() => {});
    await new Promise((resolve) => {
      const transaction = database.transaction([ENTRIES, META], "readwrite");
      transaction.objectStore(ENTRIES).clear();
      transaction.objectStore(META).clear();
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
    });
    importPromise = null;
    state = "idle";
  }

  globalThis.DualSubDictionary = Object.freeze({
    lookup,
    clear,
    get state() { return state; }
  });
})();
