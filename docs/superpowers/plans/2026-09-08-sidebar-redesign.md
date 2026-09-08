# Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's four overlapping "words from this video" surfaces with one tabbed layout whose word list shows meanings and saves to vocabulary in a single click, and add a tab mode.

**Architecture:** The content script keeps owning French morphology and hands the sidebar per-word lookup metadata in the transcript state. The sidebar becomes a three-tab shell plus a new `sidebar/word-list.js`. Meanings resolve cache-first through a new cache-only message answered by `background.js`, which also reports whether each word is already in the vocabulary.

**Tech Stack:** Plain ES2022, no bundler, no module system. Scripts attach frozen `globalThis.DualSub*` objects and load in declaration order. Tests are Node's `assert` plus `jsdom`, run by `node tests/*.test.js`.

**Spec:** `docs/superpowers/specs/2026-09-08-sidebar-redesign-design.md`

## Global Constraints

- Node 22+. This machine has v24.19.0 at `C:\Program Files\nodejs\`, **not on PATH**. Every command below assumes `$env:Path = "C:\Program Files\nodejs;$env:Path"` in PowerShell.
- No module system. A new script attaches a frozen global and is registered in the hand-enumerated `check` script in `package.json`. `sidebar/word-list.js` loads via a `<script>` in `sidebar.html`, not `manifest.json`, because the sidebar is an extension page.
- Runtime is French-to-English only.
- Provider calls route through the translation engine. The peek is cache-only and issues zero provider requests.
- Render external text with `textContent` / DOM construction. No `innerHTML` on caption or translation text.
- Provider secrets stay in local storage. Extension CSP and permissions are unchanged; no new permission is added.
- `tests/smoke.test.js` and `tests/regression.test.js` slice source by literal markers. Update markers in the same commit that moves the code.
- Baseline before starting: `npm run check` and `npm test` both pass.

---

### Task 1: Cache-only peek in the engine and background

**Files:**
- Modify: `translation-engine.js` (exports block, ~line 645)
- Modify: `background.js` (`translateSelectionWithEngine`, ~line 581; message router, ~line 850)
- Test: `tests/regression.test.js`

**Interfaces:**
- Produces: `DualSubTranslation.cachedResults(keys)` → `Promise<Array<result|null>>`
- Produces: message `{ type: "peek-word-meanings", words: [{ text, lookupText, readingKey, context }], sourceLanguage, targetLanguage }` → `{ ok: true, meanings: [{ translatedText, provenance, saved }] }`, one entry per word, positional, never null; a miss is `translatedText: ""`.
- Produces: `lookupBatchItem(message, settings)` → `{ item, options }`, the extracted construction shared by peek and fetch.

- [ ] **Step 1: Write the failing tests** in `tests/regression.test.js`, in the existing translation test area.

```js
// A peek must never reach a provider, and must answer for every word.
const peek = await messageListener({
  type: "peek-word-meanings",
  words: [{ text: "pourtant", lookupText: "pourtant", readingKey: "", context: "Pourtant, tout allait bien." }],
  sourceLanguage: "fr", targetLanguage: "en"
});
assert(peek.ok);
assert.strictEqual(peek.meanings.length, 1);
assert.strictEqual(peek.meanings[0].translatedText, "");
assert.strictEqual(peek.meanings[0].saved, false);
assert.strictEqual(fetchCalls, 0, "A peek must not call a provider");
```

- [ ] **Step 2: Run and verify it fails**

`npm test` → FAIL, the handler does not exist so `peek.ok` is undefined.

- [ ] **Step 3: Export `cachedResults`** — add it to the frozen `DualSubTranslation` object.

- [ ] **Step 4: Extract `lookupBatchItem`** from `translateSelectionWithEngine`, returning the `{ text, cacheId }` item and the options object it currently builds inline, so peek and fetch cannot disagree about keys.

- [ ] **Step 5: Add the `peek-word-meanings` handler.** Per word: check translation corrections first (same order as the fetch), then `cacheKeyFor(item, options)` + `cachedResults`. Compute `saved` by applying `vocabularyKey` to `word.text` and testing against the vocabulary's `normalized` values, reading the vocabulary once for the whole batch.

- [ ] **Step 6: Run tests** → PASS.

- [ ] **Step 7: Commit** `feat: add a cache-only word meaning peek`

---

### Task 2: Transcript state carries per-word lookup metadata

**Files:**
- Modify: `content.js` `buildTranscriptState` (~line 1024) and the analysis block (~1036-1067)
- Test: `tests/regression.test.js`

**Interfaces:**
- Removed from the response: `topUnknown`, `topPhrases`.
- Produces: each entry of the existing `vocabulary` array gains, for the first 60 entries whose `state === "unknown"`: `cueIndex` (int, first cue containing the word), `lookupText` (string), `readingKey` (string), `label` (string, may be empty).

- [ ] **Step 1: Write the failing test** — build a transcript state from two cues and assert `topPhrases` is gone and the first unknown word carries a `cueIndex` pointing at the cue it appears in, plus a non-empty `lookupText`.

- [ ] **Step 2: Run and verify it fails.**

- [ ] **Step 3: Delete the phrase counting loop** and the `topUnknown` / `topPhrases` fields from `transcriptAnalysisCache` and the response.

- [ ] **Step 4: Record first-occurrence cue index** while counting tokens; attach morphology from `DualSubFrench.lookupReading` / `classifyWord` / `lexicalInfo` to the top 60 unknown entries only. The analysis stays memoised on `transcriptSourceRevision:wordStatesRevision`, so this runs once per transcript.

- [ ] **Step 5: Run tests** → PASS.

- [ ] **Step 6: Commit** `feat: carry per-word lookup metadata in transcript state`

---

### Task 3: Tabbed sidebar shell

**Files:**
- Modify: `sidebar/sidebar.html`, `sidebar/sidebar.css`, `sidebar/sidebar.js`
- Test: `tests/ui.test.js:21`, `tests/regression.test.js:379`, `tests/smoke.test.js`

**Interfaces:**
- Produces: `#tabs` tablist with `[data-view="transcript"|"words"|"practice"]`, panes as `[data-pane=...]`, `data-active` on the selected pane.
- Produces: `#wordCount` badge element, filled by Task 4.

- [ ] **Step 1: Update the two source-slicing tests first.** `tests/regression.test.js:389` slices `sidebar.js` between `function unknownWordsInCue`, `async function refresh()` and `element("transcript").addEventListener`. Rewrite the markers to match the new structure before moving code, so the failure is about behaviour rather than a slice error.

- [ ] **Step 2: Write the failing UI test** in `tests/ui.test.js` — clicking the Words tab activates the words pane; an unrevealed dictation selects Practice and leaves Transcript and Words disabled.

- [ ] **Step 3: Run and verify it fails.**

- [ ] **Step 4: Rewrite `sidebar.html`** — header, one status strip (mode + coverage, no buffer), tablist, three panes. Delete the phrases markup and the unknown-words chips. Move previous/replay/next into the transcript pane's control row. Add `<script src="word-list.js">` before `sidebar.js`.

- [ ] **Step 5: Rewrite `sidebar.css`** on `shared/tokens.css`, matching the published mockup.

- [ ] **Step 6: Update `sidebar.js`** — tab selection state, reset to Transcript on video change, dictation forcing the Practice tab, remove `renderUnknownWords` and the phrase rendering.

- [ ] **Step 7: Run `npm test`** → PASS.

- [ ] **Step 8: Commit** `feat: lay the transcript sidebar out as tabs`

---

### Task 4: The word list

**Files:**
- Create: `sidebar/word-list.js`
- Modify: `sidebar/sidebar.html` (script tag), `sidebar/sidebar.js` (mount + storage listener), `package.json` (`check`)
- Test: `tests/ui.test.js`

**Interfaces:**
- Produces: `globalThis.DualSubWordList = Object.freeze({ render, markSaved })`
  - `render(host, { words, cues, videoId, videoTitle })` → void
  - `markSaved(normalizedWord)` → void

- [ ] **Step 1: Write the failing tests** in `tests/ui.test.js`:
  - a cached word renders its meaning and issues zero `translate-selection` messages;
  - Save on an uncached row sends `translate-selection` then `add-vocabulary`, in that order, from one click;
  - a word whose peek returned `saved: true` renders no Save control and is excluded from the badge count;
  - a rejected save (vocabulary full) shows the error and leaves the row unsaved.

- [ ] **Step 2: Run and verify they fail.**

- [ ] **Step 3: Create `sidebar/word-list.js`.** Row = container with two sibling buttons (body, Save) plus an expandable region holding context, "I know this", "Ignore", "Go to line". Never nest a button in a button.

- [ ] **Step 4: Wire peek on open and refresh**, and the on-demand fetch for a row expanded or saved while uncached.

- [ ] **Step 5: Implement one-click save** — `Saving…`, resolve meaning if absent, `add-vocabulary`, then a permanent `Saved` marker. On failure restore `Save` and surface the response's error text.

- [ ] **Step 6: Add the `storage.onChanged` listener** in `sidebar.js` for the local `vocabulary` key, re-running the peek so a save from the in-video card marks the row.

- [ ] **Step 7: Register `sidebar/word-list.js`** in the `check` script in `package.json`.

- [ ] **Step 8: Run `npm run check` and `npm test`** → PASS.

- [ ] **Step 9: Commit** `feat: add the video word list with one-click save`

---

### Task 5: Tab mode

**Files:**
- Modify: `sidebar/sidebar.html` (⇱ button), `sidebar/sidebar.js` (follow-tab binding), `sidebar/sidebar.css` (two-column at ≥780px)
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `sidebar/sidebar.html?followTab=<tabId>` binds polling to that exact tab id.

- [ ] **Step 1: Write the failing test** — with `?followTab=7`, refresh messages go to tab 7 and `tabs.query({active:true})` is never called; when tab 7 stops answering, the reconnect notice appears.

- [ ] **Step 2: Run and verify it fails.**

- [ ] **Step 3: Add the ⇱ button** opening `tabs.create` on `sidebar.html?followTab=<currentTabId>`.

- [ ] **Step 4: Branch tab resolution** in `sidebar.js` — a `followTab` id short-circuits `activeTab()`. Show "The video tab is gone" with a re-bind button when it stops answering. Never silently retarget.

- [ ] **Step 5: Skip polling while `document.hidden`.**

- [ ] **Step 6: Add the ≥780px two-column layout** to `sidebar.css`.

- [ ] **Step 7: Run `npm test`** → PASS.

- [ ] **Step 8: Commit** `feat: let the transcript open in a tab`

---

### Task 6: Documentation and visual verification

**Files:**
- Modify: `docs/ARCHITECTURE.md` ("Study modes and transcript sidebar", "Vocabulary and corrections", "Listening practice and session recap"), `CHANGELOG.md`

- [ ] **Step 1: Update `docs/ARCHITECTURE.md`** — the transcript-state contract loses `topUnknown`/`topPhrases` and gains per-word metadata; describe the tabs, the word list, the peek, and tab mode.

- [ ] **Step 2: Add a `CHANGELOG.md` entry** for the user-visible change.

- [ ] **Step 3: Run `npm run verify`** (check + test + lint) → PASS.

- [ ] **Step 4: Run `npm run screenshots`** and look at the PNGs. `sidebar.css` is rewritten and jsdom has no layout engine, so this is the only automated way to catch a layout regression.

- [ ] **Step 5: Report whether a live Firefox check was performed.** Automated tests establish nothing about real YouTube behaviour.

- [ ] **Step 6: Commit** `docs: describe the redesigned sidebar`

---

## Self-Review

**Spec coverage.** §1 sidebar structure → Task 3. §2 word list → Task 4. §3 one-click save → Task 4 step 5. §3a duplicate guard → Task 1 step 5 (the `saved` flag) and Task 4 steps 1, 3, 6. §4 meaning resolution → Task 1 and Task 4 step 4. §5 transcript-state contract → Task 2. §6 tab mode → Task 5. §7 dictation → Task 3 steps 2 and 6. Tests → distributed. Docs → Task 6.

**Type consistency.** `peek-word-meanings` returns `meanings` with `{ translatedText, provenance, saved }` in Tasks 1 and 4. `cueIndex` / `lookupText` / `readingKey` / `label` are produced in Task 2 and consumed in Task 4. `DualSubWordList.render` / `markSaved` are defined in Task 4 and used from `sidebar.js` in Tasks 4 and 5.

**Ordering.** Tasks 1 and 2 are independent of each other; both must land before Task 4. Task 3 must land before Tasks 4 and 5 because it creates the panes they mount into.
