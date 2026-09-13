# Local Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer single-word lookups from a bundled French→English dictionary before any translation engine is contacted.

**Architecture:** A build script renders the kaikki.org Wiktionary extract into a sorted `lemma<TAB>json` text file. At first lookup the background imports that file into IndexedDB and then answers lookups with one keyed `get`, so nothing is held in memory between lookups. `background.js` consults the dictionary after the cache and before any provider. The content script already knows the lemma and grammatical group, so it sends them with the lookup message.

**Tech Stack:** Plain JavaScript, no bundler. Firefox MV3 extension. IndexedDB. Node 22+ for build and tests. `node:test` is not used — the suites are plain scripts run by `node`.

**Spec:** `docs/superpowers/specs/2026-09-13-local-dictionary-design.md`

## Global Constraints

- **No module system.** Each script attaches a frozen `globalThis.DualSub*` object; later scripts read it. Load order in `manifest.json` is the dependency order.
- **A new script must be registered in two places** (three if development-only): `manifest.json` (`background.scripts` here) and the hand-enumerated `check` script in `package.json`. `web-ext-config.cjs` only if development-only.
- **A new setting must be registered in three places:** `shared/settings.js` defaults, the `ids` list in `popup/popup.js`, and the `settingDestinations` search index in the same file. A setting missing from the index is unreachable — most settings sit inside a collapsed `<details>`.
- **`mergeSettings` shallow-spreads stored values over defaults.** A setting whose stored value could be malformed needs its own repair step.
- **The runtime is French→English only.**
- **Run `npm run verify`** (check + tests + lint, warnings are errors) before every commit. Node is at `C:\Program Files\nodejs` and may not be on PATH.
- **The working tree is CRLF** (`core.autocrlf=true`). Data files read by byte offset must be listed in `.gitattributes` as `-text` or checkout will corrupt them.
- **A new development-only file must be added to `ignoreFiles` in `web-ext-config.cjs`.** `.gitignore` does not affect packaging: `web-ext` packages everything under `sourceDir` except what `ignoreFiles` names.
- **Commit messages end with:**
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017MfqDUbRJ74dK9f8rnxdSh
  ```
- **Do not push.** The user lands this manually.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/build-dictionary.js` | Reads the kaikki extract, filters and caps it, writes the sorted text index. Run manually, like `build-word-groups.js`. |
| `vendor/wiktionary/french-english.txt` | Shipped data: sorted `lemma<TAB>json` lines, under 6 MB. |
| `vendor/wiktionary/SOURCE.md`, `LICENSE-CC-BY-SA-4.0` | Provenance, licence, SHA-256 of the generated file. |
| `dictionary.js` | Background module. Imports the text into IndexedDB once, then answers `lookup`. Knows nothing about settings or messages. |
| `background.js` | Decides *when* to consult the dictionary, inside the existing lookup order. |
| `content.js` | Sends `lemma` and `group` with a word lookup. |
| `tests/fixtures/kaikki-sample.jsonl` | Six lines of real-shaped extract input for the build test. |

`dictionary.js` deliberately does not read settings or messages: it is a store with one question, so it can be tested without a background context.

---

### Task 1: Build script and vendored data

**Files:**
- Create: `scripts/build-dictionary.js`
- Create: `tests/fixtures/kaikki-sample.jsonl`
- Create: `vendor/wiktionary/SOURCE.md`
- Modify: `.gitignore`
- Modify: `.gitattributes`
- Test: `tests/smoke.test.js` (new function `testDictionaryBuild`)

**Interfaces:**
- Consumes: nothing.
- Produces: `vendor/wiktionary/french-english.txt` — sorted `lemma<TAB>json` lines, code-unit order, `\n` separated, no trailing newline. Value JSON is an array of `{ pos, gender?, senses }` objects. `pos` is one of `"noun" | "verb" | "adjective" | "adverb" | "pronoun" | "determiner" | "preposition" | "conjunction" | "interjection"`.

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/kaikki-sample.jsonl`. Each line is one kaikki entry. These six exercise every filter: a normal noun, a gendered homograph pair, a verb, an obsolete sense that must be dropped, a proper noun that must be dropped, and a non-French entry that must be dropped.

```jsonl
{"word":"armée","lang_code":"fr","pos":"noun","tags":["feminine"],"senses":[{"glosses":["army"]},{"glosses":["armed forces"]},{"glosses":["a great multitude"]},{"glosses":["a fourth sense that must be capped away"]}]}
{"word":"livre","lang_code":"fr","pos":"noun","tags":["masculine"],"senses":[{"glosses":["book"]}]}
{"word":"livre","lang_code":"fr","pos":"verb","senses":[{"glosses":["to deliver"]},{"glosses":["to hand over"]}]}
{"word":"chien","lang_code":"fr","pos":"noun","tags":["masculine"],"senses":[{"glosses":["dog"]},{"tags":["obsolete"],"glosses":["a flintlock hammer"]}]}
{"word":"Paris","lang_code":"fr","pos":"name","senses":[{"glosses":["Paris"]}]}
{"word":"dog","lang_code":"en","pos":"noun","senses":[{"glosses":["a dog"]}]}
```

- [ ] **Step 2: Write the failing test**

Add to `tests/smoke.test.js`, and call it from the runner at the bottom of the file alongside the other `await test...()` calls.

```js
// The build is run by hand against a 550MB extract, so the test drives it with
// a fixture instead. It exists to pin the filtering rules, not the data.
async function testDictionaryBuild() {
  const fixture = path.join(projectRoot, "tests", "fixtures", "kaikki-sample.jsonl");
  const output = path.join(os.tmpdir(), `dualsub-dictionary-${process.pid}.txt`);
  // Fourth argument is the lexicon to intersect with. Empty means none, so this
  // run isolates the language, part-of-speech and tag filters. "Paris" and "dog"
  // are both absent from Lexique, so with the intersection on they would be
  // dropped before those filters were reached and the assertions below would
  // pass for the wrong reason.
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build-dictionary.js"), fixture, output, ""
  ], { encoding: "utf8" });

  const lines = fs.readFileSync(output, "utf8").split("\n");
  const entries = new Map(lines.map((line) => {
    const tab = line.indexOf("\t");
    return [line.slice(0, tab), JSON.parse(line.slice(tab + 1))];
  }));

  // Sorted in code-unit order, because the consumer compares with <.
  const keys = lines.map((line) => line.slice(0, line.indexOf("\t")));
  for (let position = 1; position < keys.length; position++) {
    assert(keys[position - 1] < keys[position], `not sorted at ${keys[position]}`);
  }

  assert.deepStrictEqual(entries.get("armée"), [
    { pos: "noun", gender: "f", senses: ["army", "armed forces", "a great multitude"] }
  ], "Senses are capped at three, and a feminine noun keeps its gender");

  // Same spelling, two parts of speech, and a gender that separates nothing is
  // still carried on the noun because the other reading is a verb.
  assert.deepStrictEqual(entries.get("livre"), [
    { pos: "noun", gender: "m", senses: ["book"] },
    { pos: "verb", senses: ["to deliver", "to hand over"] }
  ]);

  assert.deepStrictEqual(entries.get("chien"), [
    { pos: "noun", gender: "m", senses: ["dog"] }
  ], "An obsolete sense is dropped");

  assert(!entries.has("Paris"), "Proper nouns are not dictionary lookups");
  assert(!entries.has("dog"), "Only French entries are kept");
  fs.unlinkSync(output);

  // And with a lexicon, only lemmas it knows survive. "chien" is in Lexique and
  // "zzzznotaword" is not, so this proves the intersection rather than assuming it.
  const lexicon = path.join(os.tmpdir(), `dualsub-lexicon-${process.pid}.txt`);
  fs.writeFileSync(lexicon, 'chien\t["chien","SjE~","m","s",1,100]');
  const filteredFixture = path.join(os.tmpdir(), `dualsub-fixture-${process.pid}.jsonl`);
  fs.writeFileSync(filteredFixture, [
    '{"word":"chien","lang_code":"fr","pos":"noun","senses":[{"glosses":["dog"]}]}',
    '{"word":"zzzznotaword","lang_code":"fr","pos":"noun","senses":[{"glosses":["nothing"]}]}'
  ].join("\n"));
  const filteredOut = path.join(os.tmpdir(), `dualsub-filtered-${process.pid}.txt`);
  execFileSync(process.execPath, [
    path.join(projectRoot, "scripts", "build-dictionary.js"), filteredFixture, filteredOut, lexicon
  ], { encoding: "utf8" });
  const filtered = fs.readFileSync(filteredOut, "utf8");
  assert(filtered.startsWith("chien\t"), "A lemma the lexicon knows survives");
  assert(!filtered.includes("zzzznotaword"), "A lemma it does not know is dropped");
  for (const file of [lexicon, filteredFixture, filteredOut]) fs.unlinkSync(file);
}
```

Add `const os = require("os");` and `const { execFileSync } = require("child_process");` to the requires at the top of `tests/smoke.test.js` if they are not already there.

- [ ] **Step 3: Run the test to verify it fails**

Run: `node tests/smoke.test.js`
Expected: FAIL — `Cannot find module .../scripts/build-dictionary.js`.

- [ ] **Step 4: Write the build script**

Create `scripts/build-dictionary.js`:

```js
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(projectRoot, "vendor", "wiktionary", "kaikki-french.jsonl");
const outputPath = process.argv[3] || path.join(projectRoot, "vendor", "wiktionary", "french-english.txt");
// Fourth argument overrides the lexicon to intersect with; an empty string
// disables the intersection, which the build test uses to isolate the other
// filters. Defaults to the shipped Lexique index.
const lexicalInfoPath = process.argv[4] === undefined
  ? path.join(projectRoot, "vendor", "lexique", "french-lexical-info.txt")
  : process.argv[4];

// Wiktionary names parts of speech its own way. Map onto the labels
// language/french.js already produces, so a reading and a sense compare directly.
const PARTS = new Map([
  ["noun", "noun"], ["verb", "verb"], ["adj", "adjective"], ["adv", "adverb"],
  ["pron", "pronoun"], ["det", "determiner"], ["article", "determiner"],
  ["prep", "preposition"], ["conj", "conjunction"], ["intj", "interjection"]
]);
// A sense a learner will not meet in a subtitle, and which would crowd out one
// they will. "name" is excluded as a part of speech entirely.
const DROP_TAGS = new Set(["obsolete", "archaic", "rare", "dated"]);
const MAX_SENSES = 3;
const MAX_PARTS = 3;
const MAX_SENSE_LENGTH = 60;
const SIZE_BUDGET = 6 * 1024 * 1024;

// Only lemmas Lexique knows: it removes Wiktionary's long tail of forms that
// never occur in speech, and guarantees every lemma is one the morphology can
// produce from a surface form. Read as text, the way the runtime reads it.
function lexiqueLemmas() {
  const text = fs.readFileSync(lexicalInfoPath, "utf8");
  const known = new Set();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    known.add(line.slice(0, tab));
    const value = JSON.parse(line.slice(tab + 1));
    if (value[0]) known.add(value[0]);
  }
  return known;
}

function cleanGloss(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_SENSE_LENGTH);
}

function genderOf(tags) {
  if (tags.includes("feminine")) return "f";
  if (tags.includes("masculine")) return "m";
  return "";
}

(async () => {
  const known = lexicalInfoPath && fs.existsSync(lexicalInfoPath) ? lexiqueLemmas() : null;
  const collected = new Map();
  const input = readline.createInterface({ input: fs.createReadStream(sourcePath), crlfDelay: Infinity });

  for await (const line of input) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_error) { continue; }
    if (entry.lang_code !== "fr") continue;
    const pos = PARTS.get(entry.pos);
    if (!pos) continue;
    const word = String(entry.word || "");
    if (!word || (known && !known.has(word))) continue;

    const senses = [];
    for (const sense of entry.senses || []) {
      const tags = sense.tags || [];
      if (tags.some((tag) => DROP_TAGS.has(tag))) continue;
      for (const gloss of sense.glosses || []) {
        const cleaned = cleanGloss(gloss);
        if (cleaned && !senses.includes(cleaned)) senses.push(cleaned);
      }
    }
    if (!senses.length) continue;

    const parts = collected.get(word) || [];
    const gender = genderOf(entry.tags || []);
    parts.push({ pos, ...(gender ? { gender } : {}), senses: senses.slice(0, MAX_SENSES) });
    collected.set(word, parts);
  }

  const lines = Array.from(collected)
    .map(([word, parts]) => [word, JSON.stringify(parts.slice(0, MAX_PARTS))])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([word, value]) => word + "\t" + value);

  for (let position = 1; position < lines.length; position++) {
    if (!(lines[position - 1] < lines[position])) throw new Error(`output is not sorted at line ${position}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"));
  const bytes = fs.statSync(outputPath).size;
  if (bytes > SIZE_BUDGET && sourcePath.includes("kaikki-french")) {
    throw new Error(`output is ${bytes} bytes, over the ${SIZE_BUDGET} budget`);
  }
  console.log(JSON.stringify({ lemmas: lines.length, bytes }, null, 2));
})();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/smoke.test.js`
Expected: PASS, and the whole smoke suite still passes.

- [ ] **Step 6: Keep the extract out of git AND out of the package**

Append to `.gitignore`:

```
vendor/wiktionary/kaikki-french.jsonl
```

Append to `.gitattributes`:

```
vendor/wiktionary/*.txt -text
```

And add the same path to `ignoreFiles` in `web-ext-config.cjs`, beside the
`vendor/lexique/Lexique383.tsv` entry:

```js
    "vendor/wiktionary/kaikki-french.jsonl",
```

`.gitignore` does not keep a file out of the built `.xpi`: `web-ext` packages
everything under `sourceDir` except what `ignoreFiles` names. `Lexique383.tsv`
is listed there for exactly this reason, and CLAUDE.md makes it a standing rule.
Without it the raw extract downloaded in Task 6 — 550 MB to 23 GB — ships in the
release artifact, against a 5.4 MB baseline.

- [ ] **Step 7: Write the provenance file**

Create `vendor/wiktionary/SOURCE.md`, modelled on `vendor/lexique/SOURCE.md`. Record: the download URL used, the extract date, the exact command (`node scripts/build-dictionary.js`), the filtering rules (French only, mapped parts of speech, obsolete/archaic/rare/dated dropped, proper nouns dropped, intersected with the Lexique lemmas, three senses per part of speech, three parts of speech per lemma, 60 characters per sense), the CC BY-SA 4.0 and GFDL terms, the wiktextract citation, and the SHA-256 of the generated file. Copy `LICENSE-CC-BY-SA-4.0` from `vendor/lexique/`.

The extract is downloaded in Task 6, so at this point the SHA-256 is not known. Write the line as `Generated derivative SHA-256: pending first build` and fill it in during Task 6, step 3. Do not leave a bare TODO.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-dictionary.js tests/fixtures/kaikki-sample.jsonl tests/smoke.test.js vendor/wiktionary/ .gitignore .gitattributes
git commit -m "build: render the Wiktionary extract into a dictionary index"
```

---

### Task 2: The dictionary store

**Files:**
- Create: `dictionary.js`
- Modify: `manifest.json` (add to `background.scripts`, before `background.js`)
- Modify: `package.json` (add to the `check` script)
- Test: `tests/regression.test.js` (new function `dictionaryStoreTests`)

**Interfaces:**
- Consumes: `vendor/wiktionary/french-english.txt` from Task 1.
- Produces: `globalThis.DualSubDictionary`, frozen, with:
  - `async lookup(lemma: string, group?: string) → { senses: string[], pos: string, gender: string } | null`
  - `async clear() → void`
  - `readonly state: "idle" | "importing" | "ready" | "unavailable"`

- [ ] **Step 1: Write the failing test**

First extend the harness. `background()` in `tests/regression.test.js` builds a
context with **no** `indexedDB`, which is why `translation-engine.js` uses its
`storage.local` fallback throughout that suite. Switching it on globally would
move every existing test onto a different cache path, so it becomes opt-in:

```js
const { IDBFactory } = require("fake-indexeddb");

function background(initial = {}, options = {}) {
  // ... existing body, then in the vm.createContext call add:
  //   ...(options.indexedDB ? { indexedDB: new IDBFactory() } : {}),
}
```

Add `indexedDB` to the `vm.createContext` object exactly that way, leaving every
existing `background(...)` call untouched and unaffected.

Then add the test below and call it from the runner at the bottom of the file.

```js
// The dictionary lives on disk, not in memory: the background is an event page
// and would re-parse a multi-megabyte file on every wake.
async function dictionaryStoreTests() {
  const index = [
    'armée\t[{"pos":"noun","gender":"f","senses":["army","armed forces"]}]',
    'livre\t[{"pos":"noun","gender":"m","senses":["book"]},{"pos":"verb","senses":["to deliver"]}]'
  ].join("\n");
  const { context: c } = background({}, { indexedDB: true });
  let fetches = 0;
  c.fetch = async () => { fetches++; return { ok: true, text: async () => index }; };
  vm.runInContext(source("dictionary.js"), c);

  const noun = await c.DualSubDictionary.lookup("armée");
  assert.deepEqual([...noun.senses], ["army", "armed forces"]);
  assert.equal(noun.pos, "noun");
  assert.equal(noun.gender, "f");

  // The reading decides which sense of a homograph is returned.
  assert.equal((await c.DualSubDictionary.lookup("livre", "verb")).senses[0], "to deliver");
  assert.equal((await c.DualSubDictionary.lookup("livre", "noun")).senses[0], "book");
  // With no reading, the first part of speech answers rather than nothing.
  assert.equal((await c.DualSubDictionary.lookup("livre")).pos, "noun");
  // A group the entry does not have falls back rather than returning nothing.
  assert.equal((await c.DualSubDictionary.lookup("armée", "verb")).pos, "noun");

  assert.equal(await c.DualSubDictionary.lookup("inconnu"), null, "A miss is null, so the caller can ask an engine");
  assert.equal(fetches, 1, "The file is read once, not per lookup");
  assert.equal(c.DualSubDictionary.state, "ready");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/regression.test.js`
Expected: FAIL — `Cannot find module` or `DualSubDictionary is not defined`.

- [ ] **Step 3: Write the module**

Create `dictionary.js`:

```js
(() => {
  const DB_NAME = "dualsub-dictionary";
  const DB_VERSION = 1;
  const ENTRIES = "entries";
  const META = "meta";
  const SOURCE = "vendor/wiktionary/french-english.txt";
  // Bumped whenever the shipped file changes, so a stale store is replaced.
  const DATA_VERSION = 1;
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

  async function lookup(lemma, group = "") {
    const word = String(lemma || "").trim().toLocaleLowerCase("fr").normalize("NFC");
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

  async function clear() {
    const database = await openDatabase();
    if (!database) return;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/regression.test.js`
Expected: PASS.

- [ ] **Step 5: Register the script**

In `manifest.json`, `background.scripts` becomes:

```json
["shared/settings.js", "video-cache.js", "translation-engine.js", "dictionary.js", "background.js"]
```

In `package.json`, append ` && node --check dictionary.js` to the `check` script.

- [ ] **Step 6: Run the full verification**

Run: `npm run verify`
Expected: all green, lint 0/0/0.

- [ ] **Step 7: Commit**

```bash
git add dictionary.js manifest.json package.json tests/regression.test.js
git commit -m "feat: add the background dictionary store"
```

---

### Task 3: Consult the dictionary before any engine

**Files:**
- Modify: `background.js` — `lookupBatchItem` (~line 625) and `translateSelectionWithEngine` (~line 660)
- Modify: `content.js:2062` and `content.js:1835` — send `lemma` and `group`
- Test: `tests/regression.test.js` (extend `dictionaryStoreTests` with a second function `dictionaryLookupTests`)

**Interfaces:**
- Consumes: `DualSubDictionary.lookup(lemma, group)` from Task 2.
- Produces: a lookup result shaped like every other, with `provider: "dictionary"` and `provenance: "Dictionary"`.

**Why the content script sends the lemma:** `language/french.js` is a content script, so the background has no morphology. Measured on the real data, the right lemma depends on the group — for `armées` the Lexique lemma is `armée` (correct) while the morphology gives `armé` (wrong), and for `livre` as a verb only the morphology gives `livrer`:

| Word | group | `lexicalInfo().lemma` | `analyzeWord().lemma` |
| --- | --- | --- | --- |
| `armées` | noun | **armée** | armé |
| `livre` (verb reading) | verb | livre | **livrer** |
| `recevront` | verb | recevoir | **recevoir** |
| `très` | adverb | **très** | null |

So the rule is: **verb readings use the morphology lemma, everything else uses the Lexique lemma.**

- [ ] **Step 1: Write the failing test**

Add to `tests/regression.test.js` and call it from the runner:

```js
// A dictionary hit answers without a request, and must not be written into the
// provider cache, where it would occupy a provider-keyed slot.
async function dictionaryLookupTests() {
  const index = 'armée\t[{"pos":"noun","gender":"f","senses":["army","armed forces"]}]';
  const { context: c } = background({}, { indexedDB: true });
  let providerCalls = 0;
  c.fetch = async (url) => {
    if (String(url).includes("french-english")) return { ok: true, text: async () => index };
    providerCalls++;
    return { ok: true, json: async () => [[["armies", "armées"]]] };
  };
  vm.runInContext(source("dictionary.js"), c);

  const hit = await c.translateSelectionWithEngine({
    text: "armées", cacheMode: "word", lemma: "armée", group: "noun", sessionId: "d1"
  });
  assert.equal(hit.translatedText, "army · armed forces");
  assert.equal(hit.provider, "dictionary");
  assert.equal(hit.provenance, "Dictionary");
  assert.equal(providerCalls, 0, "A dictionary hit spends no request");

  const miss = await c.translateSelectionWithEngine({
    text: "zzzz", cacheMode: "word", lemma: "zzzz", group: "noun", sessionId: "d2"
  });
  assert.equal(miss.translatedText, "armies");
  assert.equal(providerCalls, 1, "A miss falls through to the engine");

  // A phrase is not a headword.
  await c.translateSelectionWithEngine({ text: "les armées", cacheMode: "phrase", sessionId: "d3" });
  assert.equal(providerCalls, 2, "A phrase never consults the dictionary");

  // A saved correction still wins.
  await c.saveTranslationCorrection("armées", "my own word");
  const corrected = await c.translateSelectionWithEngine({
    text: "armées", cacheMode: "word", lemma: "armée", group: "noun", sessionId: "d4"
  });
  assert.equal(corrected.translatedText, "my own word");

  // A dictionary answer must not occupy a provider-keyed cache slot, or the
  // engine path would later read it back as though an engine had produced it.
  const keyed = c.DualSubTranslation.cacheKeyFor(
    { text: "armée", cacheId: "word:armées" },
    { provider: "google", sourceLanguage: "fr", targetLanguage: "en" }
  );
  const cached = await c.DualSubTranslation.cachedResults([keyed]);
  assert.equal(cached[0], null, "The dictionary does not write into the translation cache");

  // Switched off, the same word goes to the engine.
  const off = background({ settings: { dictionaryLookup: false } }, { indexedDB: true }).context;
  let offCalls = 0;
  off.fetch = async (url) => {
    if (String(url).includes("french-english")) return { ok: true, text: async () => index };
    offCalls++;
    return { ok: true, json: async () => [[["armies", "armées"]]] };
  };
  vm.runInContext(source("dictionary.js"), off);
  const asked = await off.translateSelectionWithEngine({
    text: "armées", cacheMode: "word", lemma: "armée", group: "noun", sessionId: "d5"
  });
  assert.equal(asked.translatedText, "armies");
  assert.equal(offCalls, 1, "With the setting off the engine answers");
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/regression.test.js`
Expected: FAIL — `expected 'army · armed forces', got 'armies'`.

- [ ] **Step 3: Add the dictionary step in `background.js`**

In `translateSelectionWithEngine`, immediately after the saved-correction block and before the `if (translationPending.has(pendingKey))` line, insert:

```js
  // Before any engine and before the provider cache is even keyed: a dictionary
  // answer is local, instant, and costs no request. Single words only — a phrase
  // is not a headword.
  if (message.cacheMode === "word" && settings.dictionaryLookup !== false && singleWordLookup(normalizedText)) {
    const entry = await DualSubDictionary.lookup(message.lemma || normalizedText, message.group || "");
    if (entry?.senses?.length) {
      return {
        sourceText: normalizedText,
        lookupText,
        translatedText: entry.senses.join(" · "),
        provider: "dictionary",
        provenance: "Dictionary",
        partOfSpeech: entry.pos,
        gender: entry.gender,
        alignment: [],
        cacheHit: false
      };
    }
  }
```

`cacheHit` must be **false**. Nothing was fetched, but the card builds its label
from this flag (`content.js:1699`) and `true` would render "Source: local
translation cache · dictionary", which is not what happened. Task 5 adds the
branch that names the dictionary instead.

The result is also deliberately **not** passed to `cacheResults` — see the spec,
section 4. A local answer must not occupy a provider-keyed cache slot that the
engine path would later read back.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/regression.test.js`
Expected: PASS.

- [ ] **Step 5: Send the lemma and group from the content script**

In `content.js`, in the hover-prefetch message (~line 1835) and the lookup-card message (~line 2062), add two fields alongside the existing `lookupText` and `readingKey`:

```js
      lemma: (reading?.group === "verb"
        ? conjugation?.pronominalLemma || conjugation?.lemma
        : globalThis.DualSubFrench?.lexicalInfo(wordText)?.lemma) || wordText,
      group: reading?.group || "",
```

In the lookup-card call the local variables are named `cleanText` and `conjugation`; use `cleanText` in place of `wordText` there. Verify the surrounding variable names before editing — do not assume.

- [ ] **Step 6: Pin the lemma rule in the smoke suite**

Add to the French resource test in `tests/smoke.test.js`, which already loads the real Lexique files:

```js
  // The background has no morphology, so the content script sends the lemma. The
  // right source depends on the reading: Lexique has the noun lemma armée where
  // the morphology gives the adjective armé, and only the morphology has livrer.
  const armees = french.lookupReading("armées", "les armées sont là");
  assert.strictEqual(armees.group, "noun");
  assert.strictEqual(french.lexicalInfo("armées").lemma, "armée");
  const livre = french.analyzeWord("livre", "je livre le colis");
  assert.strictEqual(livre.lemma, "livrer");
```

- [ ] **Step 7: Run the full verification**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add background.js content.js tests/regression.test.js tests/smoke.test.js
git commit -m "feat: answer word lookups from the dictionary before any engine"
```

---

### Task 4: The setting

**Files:**
- Modify: `shared/settings.js`
- Modify: `popup/popup.html`, `popup/popup.js`
- Test: `tests/ui.test.js` (extend the `popup()` function)

**Interfaces:**
- Consumes: nothing.
- Produces: `settings.dictionaryLookup`, boolean, default `true`. Read in Task 3's `background.js` block.

- [ ] **Step 1: Write the failing test**

Add inside `popup()` in `tests/ui.test.js`, after the existing fallback assertions:

```js
    // Registered in all three places, or it cannot be found: the ids list, the
    // defaults, and the search index.
    const dictionary = w.document.getElementById("dictionaryLookup");
    assert.equal(dictionary.checked, true, "The dictionary answers by default");
    dictionary.checked = false;
    dictionary.dispatchEvent(new w.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(writes[writes.length - 1].dictionaryLookup, false);

    const search = w.document.getElementById("settingsSearch");
    search.value = "dictionary";
    search.dispatchEvent(new w.Event("input", { bubbles: true }));
    await settle();
    assert(w.document.querySelector("#settingsSearchResults button"), "The dictionary setting is findable");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/ui.test.js`
Expected: FAIL — `Cannot read properties of null (reading 'checked')`.

- [ ] **Step 3: Add the default**

In `shared/settings.js`, beside `translationFallbackOrder`:

```js
  // Word meanings come from the bundled dictionary before any engine is asked.
  // Off means always ask the engine.
  dictionaryLookup: true,
```

- [ ] **Step 4: Add the control**

In `popup/popup.html`, inside the `fallback-group` fieldset, above the `fallback-order-label` paragraph:

```html
            <div class="check-line">
              <label class="check-row"><input id="dictionaryLookup" type="checkbox"> Look words up in the bundled dictionary first</label>
              <button class="info" type="button" aria-describedby="dictionaryLookupInfo" aria-label="What the bundled dictionary affects">i</button>
              <p class="info-bubble" id="dictionaryLookupInfo" role="note">Affects word lookups: the hover card, the sidebar word list, and preloaded words. A word in the dictionary is answered instantly and costs no request. Words it does not have still go to your translation engine.</p>
            </div>
```

In `popup/popup.js`: add `"dictionaryLookup"` to the `ids` array; add `element("dictionaryLookup").checked = Boolean(settings.dictionaryLookup);` to `setFormValues`; add `settings.dictionaryLookup = element("dictionaryLookup").checked;` to `readFormValues`; and add to `settingDestinations`:

```js
  ["Bundled dictionary", "dictionary local offline word meaning lookup no request", "dictionaryLookup", "general"],
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/ui.test.js`
Expected: PASS.

- [ ] **Step 6: Look at the rendered page**

Run: `npm run screenshots`
Open `.shots/popup-translation.png`. Confirm the new row sits above the order list, does not overflow, and that `overflows` is `false` in the printed report.

- [ ] **Step 7: Commit**

```bash
git add shared/settings.js popup/ tests/ui.test.js
git commit -m "feat: add the bundled dictionary setting"
```

---

### Task 5: Say where the meaning came from

**Files:**
- Modify: `content/lookup-view.js` and/or `content.js` — wherever the source row maps provenance to its label
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: `provider: "dictionary"` and `provenance: "Dictionary"` from Task 3.
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the existing mapping**

The row is `.dualsub-card-provenance` (`content/lookup-view.js:30`), a `<div>`
holding a `<span>` label and an `<a>` link out to the engine. The label is built
at `content.js:1691-1704`:

```js
    const provider = response?.provider || settings.translationProvider;
    const providerLabel = { google: "Google", mymemory: "MyMemory", azure: "Azure", deepl: "DeepL", libretranslate: "LibreTranslate", correction: "Saved correction" }[provider] || provider;
    if (provider === "correction") {
      label.textContent = "Source: your saved correction";
    } else if (response?.memoryCache) {
      label.textContent = `Source: instant session cache · ${providerLabel}`;
    } else if (response?.cacheHit) {
      label.textContent = `Source: local translation cache · ${providerLabel}`;
    } else {
      label.textContent = `Source: ${response?.provenance || `${providerLabel} engine lookup`}`;
    }
```

Note that `translationProviderLink` has no entry for `dictionary`, so the "Open
in …" link hides itself. That is right: a bundled dictionary has nowhere to link.

- [ ] **Step 2: Write the failing test**

In `tests/ui.test.js`, in the `content()` harness, make the stubbed `translate-selection` response return the dictionary shape and assert the rendered row:

```js
        if (message.type === "translate-selection") {
          return { ok: true, translatedText: "army · armed forces", provider: "dictionary",
            provenance: "Dictionary", partOfSpeech: "noun", gender: "f" };
        }
```

then, after a lookup is rendered:

```js
    const provenanceRow = w.document.querySelector(".dualsub-card-provenance span");
    assert.equal(provenanceRow.textContent, "Source: bundled dictionary");
    assert(!/cache/i.test(provenanceRow.textContent), "and does not claim a cache answered");
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node tests/ui.test.js`
Expected: FAIL — the row shows a provider label or is empty.

- [ ] **Step 4: Add the label**

In `content.js`, add a branch immediately after the `correction` one, before
`memoryCache`, so the dictionary is named rather than described as a cache:

```js
    } else if (provider === "dictionary") {
      label.textContent = "Source: bundled dictionary";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/ui.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add content.js content/lookup-view.js tests/ui.test.js
git commit -m "feat: name the dictionary in the lookup card"
```

---

### Task 6: Generate the real data, and document it

**Files:**
- Create: `vendor/wiktionary/french-english.txt` (generated)
- Modify: `vendor/wiktionary/SOURCE.md`
- Modify: `THIRD_PARTY_NOTICES.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/TRANSLATION_AND_ALIGNMENT.md`, `CLAUDE.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the build script from Task 1.
- Produces: the shipped data.

- [ ] **Step 1: Download the extract**

The per-language file at `https://kaikki.org/dictionary/French/` is marked deprecated and may be gone. If it is, take the English-edition raw file from `https://kaikki.org/dictionary/rawdata.html` — the build filters by `lang_code` anyway, so either works. Save it as `vendor/wiktionary/kaikki-french.jsonl`, which `.gitignore` covers.

Record the URL actually used and the date in `SOURCE.md`. Do not guess the URL — use the one that served the file.

- [ ] **Step 2: Build**

Run: `node scripts/build-dictionary.js`
Expected: a JSON summary with `lemmas` and `bytes`. If it throws the size-budget error, lower `MAX_SENSES` to 2 before lowering coverage — a missing lemma sends the word to an engine, a missing third sense does not.

- [ ] **Step 3: Record the hash**

Run:
```bash
node -e "const c=require('crypto'),f=require('fs');console.log(c.createHash('sha256').update(f.readFileSync('vendor/wiktionary/french-english.txt')).digest('hex').toUpperCase())"
```
Put the result in `SOURCE.md`.

- [ ] **Step 4: Prove the checkout is verbatim**

```bash
git add vendor/wiktionary/french-english.txt
rm vendor/wiktionary/french-english.txt
git checkout -- vendor/wiktionary/french-english.txt
```
Re-run Step 3's command. The hash must be unchanged. If it is not, `.gitattributes` is wrong and CRLF conversion has corrupted the file.

- [ ] **Step 5: Spot-check the real data end to end**

Run the regression suite, then check by hand that the words from the original bug are answered:

```bash
node -e "
const fs=require('fs');
const text=fs.readFileSync('vendor/wiktionary/french-english.txt','utf8');
for (const word of ['armée','avoir','toujours','chien','livre','très']) {
  const line=text.split('\n').find((l)=>l.startsWith(word+'\t'));
  console.log(word.padEnd(10), line ? line.slice(line.indexOf('\t')+1).slice(0,90) : 'MISSING');
}"
```
Every one of those should be present. `armée` in particular is the word that started this.

- [ ] **Step 6: Write the notices and documentation**

- `THIRD_PARTY_NOTICES.md`: a Wiktionary entry naming CC BY-SA 4.0 and GFDL, the kaikki extract, the wiktextract citation, and the extract date.
- `docs/TRANSLATION_AND_ALIGNMENT.md`: add `local dictionary` to the lookup decision order diagram between the cache and the provider, and add **bundled dictionary** to the source-row list.
- `docs/ARCHITECTURE.md`: the new background script, the IndexedDB database `dualsub-dictionary`, and the storage table.
- `README.md`: one line that word meanings come from a bundled dictionary and work offline.
- `CLAUDE.md`: add `dictionary.js` to the code-ownership list.
- `CHANGELOG.md`: a new Unreleased section.

- [ ] **Step 7: Verify and package**

Run: `npm run verify` then `npm run build`
Confirm the packaged size in `.web-ext-artifacts/`. It was 5.4 MB before this feature; report the new figure.

- [ ] **Step 8: Commit**

```bash
git add vendor/wiktionary/ THIRD_PARTY_NOTICES.md README.md docs/ CLAUDE.md CHANGELOG.md
git commit -m "feat: ship the bundled French-English dictionary"
```

---

## Manual verification before this is considered done

Automated suites use jsdom and a fake IndexedDB. They cannot show that the real thing works. Load the extension at `about:debugging#/runtime/this-firefox` and confirm:

1. Hovering `armées` on a French video shows army senses and the card says **bundled dictionary**.
2. `about:debugging` → Inspect → Storage → Indexed DB shows `dualsub-dictionary` with the expected number of entries after the first lookup.
3. The first lookup after install is not visibly slow. Time the import in the console if it feels slow.
4. Turning the setting off sends the next lookup to the engine, and the source row changes accordingly.
5. Memory: open four YouTube tabs, check `about:memory`, and confirm the background holds the dictionary on disk rather than in the heap.

Report whether this was done. The invariant in `CLAUDE.md` is that a live Firefox check is reported either way.
