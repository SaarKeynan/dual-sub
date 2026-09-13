# Local dictionary: word meanings without a request

Design for DualSub 0.9.2. Adds a bundled French→English dictionary consulted
before any translation engine, and makes the lookup card's first answer a
dictionary sense rather than a machine translation.

## Problem

Word lookup asks a sentence translator for something that is not a sentence.

Hovering `armées` returned **"10 + 4 Armed"**. MyMemory is a translation memory:
it stores aligned segments and answers a query with the closest stored segment,
so a single word returns a segment that happens to contain it — here one that
carried its own list numbering. A live probe of ten common French words through
the exact call the extension makes:

| Word | `match` | Returned | Verdict |
| --- | --- | --- | --- |
| `armées` | 0.99 | `10 + 4 Armed` | junk |
| `avez` | 0.99 | `her name is Anna` | junk |
| `toujours` | 0.99 | `expectations always` | segment leak |
| `as` | 1 | `as` | untranslated passthrough |
| `manger` | 1 | `eating` | wrong form |
| `très` | 0.99 | `highly` | off |
| `pourtant` | 0.99 | `nonetheless` | good |
| `chien` | 1 | `dog` | good |
| `rouge` | 1 | `red` | good |
| `livre` | 1 | `book` | good |

Four of ten are right. The `match` score cannot separate them: the `armées` junk
scores 0.99 and the plainly wrong `as` → `as` scores a perfect 1, the same as
`chien` → `dog`.

Three defects follow:

1. **The quality checks cannot see short junk.** `suspiciousMyMemoryWordResult`
   (`translation-engine.js:473`) is `words(source).length === 1 &&
   words(translation).length > 3`. `10 + 4 Armed` tokenises to three tokens and
   passes. Every word check measures length — token count, character count,
   sentence stops — so junk that is short is invisible to all of them.
2. **Every meaning costs a request.** A lookup, a sidebar row and a preloaded
   word each spend provider quota on a word whose dictionary meaning does not
   change. Preloading is capped at 36 words, and at 12 on MyMemory, purely to
   ration those requests.
3. **A translator is the wrong tool for the question.** A learner hovering a word
   wants its meanings and its part of speech. An MT engine returns one
   contextual rendering with no senses, no register, and no indication that
   `livre` is also a verb and also a unit of weight.

Switching engines does not fix this. Google returns `armies` for `armées`, which
is right, but it is still one ungrounded string per request, and the same class
of failure appears on any ambiguous or inflected form.

## Decisions

Settled with the user:

- **Source: Wiktionary, via kaikki.org's machine-readable extract.** 390,535
  distinct French headwords with English senses and part of speech, CC BY-SA 4.0
  + GFDL. Rejected: FreeDict `fra-eng` (8,505 headwords, too thin, GPL) and
  Apertium `fra-eng` (lemma→lemma with no senses, GPL). DualSub ships no
  `LICENSE` and is all-rights-reserved, so GPL data is the murkiest option;
  CC BY-SA is already precedent here through Lexique.
- **Dictionary first, engine on miss.** A hit answers with no request at all. An
  engine is consulted only when the word is absent.
- **The dictionary lives on disk in IndexedDB**, queried per word, not held in
  memory. Memory is the first constraint on this feature; section 3 records what
  was measured and why the obvious in-memory design was rejected.
- **MyMemory single-word lookups stay off by default** via
  `mymemoryWordLookup`, which this change does not supersede: the dictionary is
  consulted first, and the setting still decides who answers a miss.
- **Built, not vendored raw.** The 550 MB extract is gitignored and downloaded
  separately, exactly as `vendor/lexique/Lexique383.tsv` is today, with a build
  script rendering the shipped JSON.

## Scope

In scope: the build script, the shipped data, a background dictionary module,
its place in the lookup decision order, the lookup card's source row, the
licence notice, and settings to turn it off.

Out of scope: changing the engines themselves, the fallback chain, phrase
lookups (a phrase is not a dictionary headword), translating caption lines, and
any language other than French→English.

## Design

### 1. What ships

`vendor/wiktionary/french-english.json`, target **under 6 MB**, built from the
kaikki extract filtered by Lexique frequency.

That budget is now about download size, not memory: section 3 puts the data on
disk rather than in the heap. It still binds, because the packaged extension is
5.4 MB today and this must not double it. A dictionary built to the shape below
measured 13.2 MB at 50,000 lemmas, so 6 MB buys roughly 25,000 lemmas at three
senses each. Coverage is chosen by Lexique frequency, so those are the 25,000
most frequent lemmas in French, not an arbitrary slice.

Entry shape, keyed by lemma:

```json
{
  "armée": [
    { "pos": "noun", "gender": "f", "senses": ["army", "armed forces"] }
  ],
  "livre": [
    { "pos": "noun", "gender": "m", "senses": ["book"] },
    { "pos": "noun", "gender": "f", "senses": ["pound (unit of weight)"] },
    { "pos": "verb", "senses": ["delivers", "hands over"] }
  ]
}
```

Senses are capped (at most 3 per part of speech, at most 3 parts of speech per
lemma) and each sense truncated, because the card shows a line, not an article.
The cap is what keeps the file under 6 MB; it is applied in the build, so the
runtime never carries text it cannot display.

`gender` is carried only where it separates senses that share a part of speech,
as `livre` does: masculine *book* against feminine *pound*. The card shows it in
that case to say which of the two the reader is being given. It is omitted
everywhere it would only repeat what the grammatical reading already states.

### 2. The build script

`scripts/build-dictionary.js`, following `scripts/build-word-groups.js`:

1. Read the kaikki JSONL line by line — it must never be held in memory whole.
2. Keep entries whose `lang_code` is `fr` and which have at least one English
   gloss.
3. Drop senses tagged as obsolete, archaic, or rare, and drop entries that are
   only proper nouns.
4. Intersect with Lexique: keep a lemma only if it appears in
   `french-lexical-info.json`. This is the size lever and the quality lever at
   once — it removes Wiktionary's long tail of forms that never occur in speech,
   and guarantees every dictionary lemma is one the morphology can produce.
5. Normalise part-of-speech names onto the labels `language/french.js` already
   uses, so a reading and a sense can be compared directly.
6. Write the JSON, print the entry count and byte size, and fail loudly if the
   output exceeds the size budget.

`vendor/wiktionary/SOURCE.md` records the download URL, the extract date, and
the command, as `vendor/lexique/SOURCE.md` does. The raw extract is gitignored.

### 3. Runtime module, and why it is not a Map

Measured on this machine with `node --expose-gc`, comparing heap before and
after, against the real shipped files and against a dictionary built to the
shape in section 1:

| What | File | Heap | Ratio |
| --- | --- | --- | --- |
| Both Lexique indexes, as JSON objects (before this was fixed) | 3.8 MB | **19.1 MB** | x5.0 |
| Both Lexique indexes, as text plus offsets (shipping now) | 3.8 MB | **3.6 MB** | x1.0 |
| Dictionary, plain object from `JSON.parse` | 13.2 MB | 28.9 MB | x2.2 |
| Dictionary, `Map` of parsed objects | 13.2 MB | 27.6 MB | x2.1 |
| Dictionary, `Map` of unparsed JSON strings | 13.2 MB | 15.0 MB | x1.1 |
| Dictionary, one packed string plus offset index | 13.2 MB | 14.1 MB | x1.1 |

Three conclusions, in order of how much they change the design:

1. **A parsed dictionary is not affordable.** Objects cost roughly twice their
   JSON on the heap, so the 6 MB budget buys about 13 MB of resident memory.
   Keeping values as unparsed strings and parsing one entry per lookup halves
   that, because a string is flat while every object and property carries its
   own overhead — but it is still several MB held for nothing most of the time.
2. **The background cannot hold it anyway.** `manifest.json` declares
   `manifest_version: 3` with no `"persistent": true`, so Firefox runs the
   background as an event page and terminates it when idle. An in-memory
   dictionary would be discarded and re-read on every wake, turning a one-time
   6 MB parse into a recurring one. This rules out the in-memory design on its
   own, independently of the size.
3. **IndexedDB costs nothing resident.** The data lives on disk and a lookup is
   one keyed `get`. Lookups are already asynchronous — they are messages to the
   background — so nothing in the calling code changes shape.

So `dictionary.js`, in `background.scripts` before `background.js`, exposing a
frozen `globalThis.DualSubDictionary`:

```js
await DualSubDictionary.lookup(lemma, { partOfSpeech })
// → { senses: [...], pos: "noun", gender: "f" } | null
```

- Database `dualsub-dictionary`, store `entries`, `keyPath: "lemma"`.
- **Import on demand.** On the first lookup after install or a data version
  change, the shipped JSON is streamed in and written in batched transactions,
  then released. That import is the only moment the file is in memory, and its
  peak is transient rather than resident.
- **A version record** holds the build stamp from `SOURCE.md`. A shipped file
  newer than the stored stamp triggers a re-import and clears the old store, so
  a rebuilt dictionary cannot leave stale entries behind.
- **Eviction is expected, not exceptional.** The browser may clear IndexedDB
  under storage pressure. A lookup that finds no version record re-imports;
  until the import finishes, lookups miss and the engine answers, so an evicted
  dictionary degrades to today's behaviour rather than failing.
- **Resident cost between lookups: an open connection.** No copy per tab, and
  no copy in the background either.

The rejected `Map`-of-strings design is recorded here because it is the right
answer if IndexedDB proves unworkable: x1.1, one copy, and simple. It would
need the background kept alive, which this manifest does not do.

### 3a. The cost that was already being paid — now fixed

Measuring for this design turned up a larger cost outside it.
`language/french.js` is a content script (`manifest.json` `content_scripts[0]`),
so Lexique's two indexes were parsed into objects in **every** YouTube tab, at
about 19 MB of heap per tab for 3.8 MB of data.

That is fixed ahead of this work and is no longer a risk this design carries.
The indexes now ship as sorted `key<TAB>value` lines, and the runtime holds each
as one string with a `Uint32Array` of line offsets, binary-searching it: 3.6 MB
per tab, with lookups at about 1 microsecond.

Two things follow for this design. The per-tab budget is no longer under
pressure, so a content-script dictionary is not ruled out by the *existing*
load — it is ruled out only by its own size and by the reasons in section 3.
And the text-plus-offsets format is proven in this codebase, which makes it the
ready alternative if IndexedDB disappoints.

### 4. Where it sits in the lookup order

`background.js`'s `translateSelectionWithEngine` gains one step:

```text
exact saved correction
        ↓ absent
identical request already in flight
        ↓ absent
persistent provider-specific cache
        ↓ absent
local dictionary                      ← new
        ↓ no entry for this lemma
selected translation provider, except MyMemory for one word
        ↓ out of requests, and lookups may change engine
next eligible engine, cheapest first
        ↓ suspicious short-word result
Google concise-word fallback
```

The dictionary is consulted only when `cacheMode === "word"` and the source is a
single word. Phrases and caption lines are untouched.

**Which lemma is asked.** `language/french.js` already produces a reading —
lemma plus part of speech — for the hovered word, and already resolves the
ambiguity that matters (`l'as` as *the ace* versus *you have*). The dictionary is
asked for that lemma and that part of speech. If the reading gives no part of
speech, all senses are returned in the file's order.

**Caching.** A dictionary hit is not written to the translation cache. It is
already local and instant, and writing it would let a dictionary answer occupy a
provider-keyed slot that the engine path would later read back.

### 5. What the card shows

The source row gains one value, **"dictionary"**, alongside the existing *your
saved correction*, *instant session cache*, *local translation cache* and the
provider provenances. A dictionary answer renders its senses separated by a
middot, with the grammatical reading the card already shows.

Where a lemma has senses under more than one part of speech and the reading
picked one, only that part of speech is shown; the others are reachable but not
displayed, because the card is a line and the reader asked about this word in
this sentence.

### 6. Settings

`dictionaryLookup`, default **on**, in the Translation service group beside the
fallback switches, with an info bubble in the pattern added for those:
"Looks words up in a bundled French dictionary before asking a translation
engine. Meanings appear instantly and cost no requests. Turn this off to always
ask your engine."

Registered in `shared/settings.js`, the `ids` list, and `settingDestinations` —
all three, per the gotcha added after the last setting missed the search index.

### 7. Licence notice

`THIRD_PARTY_NOTICES.md` gains a Wiktionary entry naming CC BY-SA 4.0 and GFDL,
the kaikki extract, the wiktextract citation, and the extract date.
`vendor/wiktionary/` carries the licence text, as `vendor/lexique/` does.

## Files

| File | Change |
| --- | --- |
| `scripts/build-dictionary.js` | New. Builds the shipped JSON from the extract. |
| `vendor/wiktionary/french-english.json` | New. Shipped data, under 6 MB. |
| `vendor/wiktionary/SOURCE.md`, `LICENSE-CC-BY-SA-4.0` | New. Provenance and licence. |
| `dictionary.js` | New. Background lookup module. |
| `manifest.json` | Register `dictionary.js` in `background.scripts`. |
| `package.json` | Add `dictionary.js` to the hand-enumerated `check` script. |
| `.gitignore` | Ignore the downloaded extract. |
| `background.js` | Dictionary step in the lookup order. |
| `shared/settings.js` | `dictionaryLookup` default. |
| `popup/popup.html`, `.css`, `.js` | Switch, info bubble, `ids`, search index. |
| `content/lookup-view.js`, `content.js` | The "dictionary" source row. |
| `THIRD_PARTY_NOTICES.md`, `docs/*`, `CHANGELOG.md` | Notice and documentation. |

`vendor/wiktionary/french-english.json` must be listed in
`web_accessible_resources` only if the content script ever reads it. Under this
design it does not, and it should not be listed.

## Tests

`tests/regression.test.js`:

- A word with a dictionary entry returns its senses and contacts no provider.
- A word with no entry falls through to the engine, and the engine's answer is
  returned unchanged.
- The reading decides the sense: `livre` as a noun and `livre` as a verb return
  different senses from the same entry.
- A dictionary answer is not written to the translation cache.
- With `dictionaryLookup` off, the same word goes straight to the engine.
- A saved correction still wins over a dictionary entry.
- A phrase never consults the dictionary.

`tests/ui.test.js`:

- The lookup card renders the dictionary source row and the senses.
- The setting renders, saves, and is reachable from the settings search.

A fixture dictionary is used, not the shipped file: the suites must not depend
on multi-MB data or on Wiktionary's contents at a point in time.

## Invariants preserved

- Provider calls still route through the translation engine; the dictionary is
  consulted before any call is made, never instead of the engine's own rules.
- Preloading applies the same checks as interactive lookup — it takes the same
  path and so gets the same dictionary answers.
- Cache keys stay provider-scoped; dictionary answers stay out of that cache.
- Morphology and dictionary assets remain local, with their licence notices.
- Navigation cancellation is unaffected: a dictionary hit makes no request and
  has nothing to cancel.

## Risks

- **The extract is large and its download route is moving.** kaikki marks the
  550 MB per-language file deprecated and points at raw data that is 23 GB for
  the English edition. The exact route must be pinned and recorded in
  `SOURCE.md` when the build script is written; if the per-language file is gone,
  the build reads the English-edition raw file and filters by `lang_code`.
- **Size budget versus coverage.** Measured, 6 MB is about 25,000 lemmas at three
  senses. The Lexique-frequency intersection is the lever; if the file is still
  too large, lower the sense caps before dropping lemmas, since a missing lemma
  sends the word to an engine while a missing third sense does not. The budget
  is a download-size constraint on a 5.4 MB package, not a memory one.
- **IndexedDB import is a one-time cost that can be interrupted.** The first
  lookup after install triggers it. If it is slow enough to be noticed, or is
  cut short by the event page terminating mid-import, the version record must
  not be written until the import completes, or a partial dictionary would look
  complete. This is the main thing to get right in implementation.
- **A dictionary answers the lemma, not the sentence.** For idioms and for words
  whose contextual meaning departs from the lemma's senses, the dictionary will
  be confidently less useful than the engine was. The card already shows the
  grammatical reading, and the source row will say "dictionary", so the reader
  can see which kind of answer they have — but this is a real regression for
  idiomatic usage and should be watched after release.
- **Wiktionary glosses vary in register and quality.** They are crowd-written.
  The build's filtering of obsolete and rare senses is a blunt instrument.
- **Storage instead of memory.** The cost moves from heap to disk: roughly 6 MB
  of profile storage per install, plus IndexedDB's own overhead. That is the
  intended trade, but it is a trade, and a browser under storage pressure may
  evict it and force a re-import.
