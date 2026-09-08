# Sidebar redesign: one word list, one save

Design for DualSub 0.9.1. Replaces the transcript sidebar's four overlapping
word surfaces with a single studiable list, and adds a tab mode.

## Problem

Studying words from a video does not work, and the sidebar's layout hides that
rather than helping.

Four surfaces present "words from this video", all derived from the same token
stream in `learningTokens` (`content.js:1018`):

| Surface | Scope | What its controls do |
| --- | --- | --- |
| Useful unknown words (`topUnknown`) | Whole transcript, top 12 by frequency | Writes `wordStatesV1` only |
| Session recap (`session.encountered`) | Words from lines that have played | Nothing; it is a counter |
| Review words from this session | Vocabulary entries whose word played | Opens `vocabulary.html` |
| Repeated phrases (`topPhrases`) | 2–3 word sequences seen twice or more | Nothing; the chips have no handler |

Three defects follow:

1. **The chips cannot teach.** A chip shows a bare French word and a count. The
   user is asked to judge known / learning / ignored with less information than
   the overlay already has on screen.
2. **`+` does not add a word.** `setWordState` (`background.js:122`) writes
   `wordStatesV1`, a store entirely separate from `VOCABULARY_KEY`. The button
   reads as "add to my study list" and creates nothing reviewable. The only path
   to a vocabulary entry is the in-video lookup card.
3. **Nothing is prioritised.** Six panels stack in a column whose `min-width` is
   240px, with labels at 9px and eleven controls inside the practice panel. The
   transcript, the one thing followed while watching, starts below all of it.

## Decisions

Settled with the user against interactive mockups
(`https://claude.ai/code/artifact/dc925aa3-91c1-4f3d-832a-0e83128d1fc3`):

- **Layout A, tabs.** Transcript / Words / Practice, one at a time, each with the
  full column. Chosen over a bottom drawer and a fixed split because it removes
  the competition for space rather than rationing it.
- **One list, whole-video scope.** Every distinct word in the transcript, ranked
  by recurrence, minus what is marked known or ignored.
- **Meanings are cache-first.** Rows already in the translation cache render
  immediately; the rest resolve on demand. No bulk provider traffic.
- **Save is one click from any row state**, including a word never looked up.
- **Repeated phrases and the English buffer readout are deleted.**
- **Tab mode** opens the same page in a tab, two columns, bound to one video tab.

## Scope

**In scope.** `sidebar/` in full; the transcript-state contract in `content.js`;
a cache-only lookup path in `background.js` and `translation-engine.js`; docs;
tests.

**Out of scope.** The in-video lookup card, the vocabulary page and its review
scheduler, the OCR translator, the popup, provider adapters, and the review
algorithm. Word-state semantics are unchanged; only their prominence changes.

## Design

### 1. Sidebar structure

```
┌──────────────────────────────────────┐
│ DualSub                    ⇱  Aa  ⚙  │  header: title, video, actions
│ La Révolution de 1848 — Histoire…    │
├──────────────────────────────────────┤
│ [Study ▾]   Known ▓▓▓░░░░░░  38%     │  one strip, was three tiles
├──────────────────────────────────────┤
│ [ Transcript ][ Words ⁶ ][ Practice ]│  tablist
├──────────────────────────────────────┤
│                                      │
│  the selected view, full height      │
│                                      │
└──────────────────────────────────────┘
```

The status strip carries study mode and coverage only. `bufferAheadSeconds`
stays in the transcript-state response for diagnostics but is no longer
rendered: it reports how far ahead translation has run, which is a developer
signal, not a study one.

Tabs are a `role="tablist"` of three `role="tab"` buttons over three panes.
Selection lives in `sidebar.js` and survives refresh; it resets to Transcript
when the followed video changes. The Words tab carries a count badge so the
list's contents are legible without opening it.

Caption navigation (previous / replay / next) moves into the Transcript pane's
control row, beside search and the English toggle.

### 2. The word list

Rendered by a new `sidebar/word-list.js`. One row per word:

```
┌────────────────────────────────────────┐
│ pourtant  adv                 ×4 [Save]│   ← two sibling controls
│ yet, however                           │
├────────────────────────────────────────┤
│ compris   past part. · comprendre       │
│ understood                    ×3 [Save]│
└────────────────────────────────────────┘
```

Expanded (the row body pressed):

```
│ dès que   conj                ×3 [Save]│
│ as soon as                             │
│  │ Dès que la nouvelle est tombée…     │
│  │ As soon as the news broke…          │
│  [I know this] [Ignore] [Go to line]   │
```

**Markup.** The row is a container holding two sibling `<button>` elements — the
body, which expands, and Save — plus a region revealed when expanded. Not a
button inside a button: that is invalid, and it breaks keyboard traversal.

**Hierarchy.** Exactly one action competes for attention at rest. "I know this"
and "Ignore" are real but secondary and live in the expanded region. This is the
specific fix for the old chips, which offered three equal-weight 22px buttons per
word with no primary among them.

**Ordering and size.** Descending by count, then alphabetically, matching the
existing sort in `buildTranscriptState`. Capped at 60 rows; the cap bounds the
morphology work described in §4.

**Empty states.** No captions yet: "Waiting for captions…". Captions present but
every word marked: "Nothing left to study in this video." These are distinct, and
neither is the "no French captions" notice, which remains a property of the video.

### 3. Save, in one click

`addVocabularyEntryUnlocked` rejects an entry whose `translatedText` is empty
(`background.js:179`). A word whose meaning has not resolved therefore cannot be
saved directly, so Save on such a row performs both steps as one action:

1. Button reads `Saving…` and is disabled.
2. Resolve the meaning through §4's fetch path.
3. On success, send `add-vocabulary` with the word, its meaning, the first cue's
   sentence and translation, the video id/title, and that cue's start time —
   the same shape the in-video card sends (`content.js:2277`).
4. Button reads `Saved ✓`. The row also records a `learning` word state, so a
   saved word leaves the unknown list and counts toward coverage.

On failure the button returns to `Save` and the row shows the error text from
the response. Two failures are worth distinct messages: a full vocabulary
(2,000 entries) and a provider that could not produce a meaning.

Save is idempotent per row within a session; a second press on `Saved ✓` does
nothing. Re-saving an existing entry is already safe — `addVocabularyEntryUnlocked`
merges contexts and preserves notes.

### 4. Meaning resolution

Two paths, both reusing the interactive lookup so quality rules are not
reimplemented.

**Cache peek, on open.** One message resolves the whole visible list without
touching a provider:

```
→ { type: "peek-word-meanings",
    words: [{ text, lookupText, readingKey, context }, …],
    sourceLanguage, targetLanguage }
← { ok: true, meanings: [ { translatedText, provenance } | null, … ] }
```

`background.js` answers it by checking, per word, the same two sources
`translateSelectionWithEngine` checks before it calls a provider: the user's
translation corrections, then `DualSubTranslation.cachedResults` for the key
`cacheKeyFor` builds. The item and options construction currently inlined in
`translateSelectionWithEngine` is extracted into one helper used by both, so a
peek and a fetch cannot disagree about keys. `cachedResults` is exported from
`translation-engine.js`; it is presently internal.

A peek issues **zero** provider requests and is safe while a provider is in
backoff, which satisfies "check caches before rejecting work because a provider
is in backoff".

**Fetch, on demand.** A row with no cached meaning reads `tap to look up`.
Expanding it, or pressing Save, sends the existing `translate-selection` message
with `cacheMode: "word"`, `lookupText`, `readingKey`, and `context` set to the
first cue's text. Because this is the identical path the lookup card uses, the
MyMemory word-quality validation, the concise Google fallback, and the
reading-specific cache key all apply unchanged — the preloading requirement in
`CLAUDE.md` is met by construction rather than by duplicated checks.

Only one fetch runs per row. Results are held in the sidebar for the life of the
video and re-peeked from cache after a transcript revision.

### 5. Transcript-state contract

`buildTranscriptState` (`content.js:1024`) changes:

- **Removed:** `topUnknown`, `topPhrases`. The phrase counting loop in the
  analysis block goes with them.
- **Added,** on each entry of the existing `vocabulary` array, for the first 60
  entries whose state is `unknown`: `cueIndex` (first cue containing the word),
  `lookupText` and `readingKey` (from `DualSubFrench.lookupReading`), and
  `label` (the grammatical reading from `classifyWord` / `lexicalInfo`).

The sidebar derives the list, the counts and the sentences from this plus the
`cues` it already receives. French morphology stays in `language/french.js`,
called from the content script that already loads it; the sidebar does not gain
a French dependency.

Cost is bounded: the analysis is memoised on
`transcriptSourceRevision:wordStatesRevision`, so morphology runs once per
transcript, for at most 60 words.

### 6. Tab mode

The header's ⇱ opens `sidebar/sidebar.html?followTab=<id>` in a tab, where `<id>`
is the YouTube tab the sidebar is already polling.

**Why an explicit id.** `sidebar.js:16` finds the video with
`tabs.query({ active: true, currentWindow: true })`. In a tab, the active tab is
the sidebar page itself, so that query renders the page permanently empty. Tab
mode binds to the id in the URL and keeps messaging it, which needs no
permission beyond the existing `*://www.youtube.com/*` host permission.

**Layout.** Above 780px the page is two columns — transcript left, word list
right, both full height — with the status strip in a header bar. The tabs remain
for Practice. Below 780px it collapses to the single-column sidebar layout, so
one stylesheet serves both.

**Lost connection.** If the followed tab closes, navigates away from a watch URL,
or stops answering, the page shows "The video tab is gone" with a button that
re-binds to a YouTube tab if exactly one is open. Tab mode never silently
retargets a different video.

**Polling.** `refresh` skips its work while `document.hidden`, so a background
tab stops the 900ms poll. This applies to the sidebar too.

### 7. Dictation

Dictation must keep hiding the French until the answer is checked. Today it hides
`.transcript-panel` and `.unknown-panel`. Under tabs, an unrevealed dictation
selects the Practice tab and disables the Transcript and Words tabs, restoring
them on reveal, stop, navigation, or player replacement. The word list is as much
of a spoiler as the transcript, so it is covered by the same rule.

## Files

| File | Change |
| --- | --- |
| `sidebar/sidebar.html` | Tabs, one status strip; phrases and buffer removed |
| `sidebar/sidebar.css` | Rewritten on `shared/tokens.css`; two-column mode |
| `sidebar/sidebar.js` | Shell: polling, tab selection, transcript, practice, follow-tab |
| `sidebar/word-list.js` | New. List rendering, peek, fetch, save, word states |
| `content.js` | `buildTranscriptState` per §5 |
| `background.js` | `peek-word-meanings`; extract the lookup item/options helper |
| `translation-engine.js` | Export `cachedResults` |
| `package.json` | Add `sidebar/word-list.js` to the hand-enumerated `check` |
| `docs/ARCHITECTURE.md` | "Study modes and transcript sidebar", "Listening practice and session recap" |
| `CHANGELOG.md` | User-visible change |

`sidebar/word-list.js` is loaded by a `<script>` in `sidebar.html`, not by
`manifest.json`, because the sidebar is an extension page rather than a content
script. It ships in the package, so `web-ext-config.cjs` needs no change. It
follows the frozen-global convention: `globalThis.DualSubWordList`.

## Tests

Existing suites that break and must be updated in the same change:

- `tests/regression.test.js:389` slices `sidebar.js` by the markers
  `function unknownWordsInCue`, `async function refresh()` and
  `element("transcript").addEventListener`. All three move; update the markers.
- `tests/ui.test.js:21` drives the real sidebar and asserts
  `.transcript-panel.hidden` during dictation. Reassert against tab state.
- `tests/smoke.test.js` asserts no `value="focus"` in the mode menu (`:190`) and
  lints `sidebar/sidebar.css` alongside the other stylesheets (`:262`). Both
  survive the rewrite, but the stylesheet rules are worth re-reading once the CSS
  is replaced. It holds no assertion about the phrases or unknown-word markup,
  so nothing there blocks their removal.

New behavioural regressions, per `CLAUDE.md`'s rule for lookup-quality and
storage changes:

1. Opening the word list issues **zero** `translate-selection` messages when
   every word is cached, and renders their meanings.
2. Save on a row with no meaning sends `translate-selection` and then
   `add-vocabulary`, in that order, from one click.
3. A save rejected for a full vocabulary surfaces the error and does not mark
   the row saved.
4. A peek returns meanings while the provider circuit is open.
5. An unrevealed dictation leaves the Transcript and Words tabs unreachable.
6. Tab mode with a `followTab` id polls that id and never
   `tabs.query({active:true})`.

`npm run verify` for the runtime change, and `npm run screenshots` because
`sidebar.css` is rewritten — jsdom has no layout engine and cannot catch what
that breaks.

## Invariants preserved

- Word states keep their storage, validation and 12,000-entry cap; they continue
  to drive coverage and the unknown-lines filter.
- All provider calls route through the translation engine. The peek is
  cache-only and never counts as provider work; navigation cancellation is
  untouched.
- Vocabulary writes stay in `background.js` behind the existing per-key
  mutation queue, so repeated saves preserve notes and contexts.
- Ambiguous elisions keep their prepared query and reading-specific cache key,
  because the list sends the same `lookupText` / `readingKey` pair the card does.
- External text is rendered through `textContent` and DOM construction, as the
  current sidebar does. No `innerHTML` on caption or translation text.
- Restoring native caption state, JSON3 append semantics, and cache isolation
  are not touched by this change.

## Risks

- **Cache hit rate is unknown.** If few words are cached, most rows open reading
  `tap to look up`, and the list is a worse first impression than the mockup
  shows. Mitigation is that the count and grammatical label are useful on their
  own; it is measurable once built, and the fallback is a small "look up the top
  N" action under user control rather than automatic bulk traffic.
- **`tabs.query` with a URL filter** may require the `tabs` permission in
  Firefox. The design avoids it on the main path by passing the tab id, and the
  re-bind affordance is the only place it would be needed; if it is refused,
  re-binding falls back to asking the user to press ⇱ again.
- **Live behaviour is unverified.** Automated tests here establish nothing about
  real YouTube endpoints or real sidebar rendering in Firefox. A manual load via
  `about:debugging` is required before this is called done, and the result should
  be reported explicitly.
