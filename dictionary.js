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

  let databasePromise = null;
  let importPromise = null;
  let state = "idle";

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ENTRIES)) database.createObjectStore(ENTRIES, { keyPath: "lemma" });
        if (!database.objectStoreNames.contains(META)) database.createObjectStore(META, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return databasePromise;
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
    const stored = await readOne(database, META, "version");
    if (stored?.value === DATA_VERSION) { state = "ready"; return database; }
    if (!importPromise) {
      importPromise = importDictionary(database).catch((error) => {
        state = "unavailable";
        importPromise = null;
        throw error;
      });
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

  async function lookup(lemma, group = "") {
    const word = headword(lemma);
    if (!word) return null;
    let database;
    try { database = await ready(); } catch (_error) { return null; }
    if (!database) return null;
    const row = await readOne(database, ENTRIES, word);
    if (!row) return null;
    let parts;
    try { parts = JSON.parse(row.parts); } catch (_error) { return null; }
    if (!Array.isArray(parts) || !parts.length) return null;
    // The reading picks the part of speech. A reading that matches nothing here
    // still gets an answer: a dictionary meaning is better than none.
    const chosen = parts.find((part) => part.pos === group) || parts[0];
    return { senses: chosen.senses || [], pos: chosen.pos || "", gender: chosen.gender || "" };
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
