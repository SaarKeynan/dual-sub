# How DualSub finds translations and word matches

This guide describes the translation and matching decisions in DualSub 0.9.1.
It complements the broader [architecture guide](ARCHITECTURE.md).

## Three different problems

DualSub handles three related but independent problems:

1. **English text acquisition:** find or generate an English version of a
   French caption.
2. **Cue alignment:** decide which complete English caption belongs beside a
   complete French caption at a given time.
3. **Word alignment:** when a learner points at a French word, decide which
   English word or phrase—if any—can be highlighted reliably.

A good line translation does not automatically provide a trustworthy word
mapping. French and English can change word order, omit pronouns, or express one
word as several words. DualSub therefore keeps all three operations separate.

## Where an English subtitle comes from

The English line has the following preference order:

| Priority | Source | How it is obtained |
| --- | --- | --- |
| 1 | Native English YouTube captions | The English caption track supplied with the video |
| 2 | YouTube auto-translation | The French timed-text URL requested with `tlang=en` |
| 3 | Configured translation provider | French timed cues translated ahead of playback |
| 4 | Configured translation provider, live | A settled line read from YouTube's native French renderer |

The first two sources are produced by YouTube. They do not use the translation
provider configured in DualSub and do not consume its quota.

If only a complete French transcript is available, the rolling scheduler sends
French cue text to the selected external provider. If even that transcript
cannot be recovered, DualSub watches YouTube's visible auto-generated French
caption, waits for the changing line to settle, and translates that line.

The current status and copied diagnostics identify whether DualSub is using
complete tracks, buffered provider translation, or live fallback.

## How provider translation is selected

The setting `translationProvider` selects Google, Azure, DeepL, MyMemory, or
LibreTranslate. It is used until it succeeds, fails, or runs out of requests.

Running out of requests is the one failure another engine can answer, and
`translationFallback` decides where that is allowed. It holds one switch per
translation location, because the locations do not carry the same risk:

| Location | Covers | Default |
| --- | --- | --- |
| `subtitles` | Caption batches and the live-cue path | on |
| `translator` | The standalone translator page | on |
| `lookups` | Word and phrase lookups, and word preloading | off |

A subtitle is read once and then gone, so finishing the line matters more than
which engine finished it. A word meaning is saved into the vocabulary and
studied for weeks, so it stays on the chosen engine unless the reader switches
that on deliberately. Preloading follows the `lookups` switch rather than having
its own, because the lookup card and the sidebar word list read preloaded and
hovered meanings from the same cache.

Eligible engines are tried in the order held by `translationFallbackOrder`,
which the reader rearranges by dragging the list in settings, or with the move
buttons on each row for keyboard and touch. It defaults to cheapest first —
Google, MyMemory, LibreTranslate, Azure, DeepL — so a free engine absorbs an
overflow before a paid key is spent, and one order is shared by every location.
A stored order is repaired on read rather than trusted: unknown and duplicate
entries are dropped and missing engines appended, so an order written by another
version can never shorten the chain.
An engine whose key or endpoint is missing is skipped rather than attempted,
because a missing credential fails identically every time. Only a rate limit, or
a circuit a rate limit opened, advances the chain: a missing key, an empty
response, and a session cancelled by navigation do not. Every candidate is asked
of the cache before it is allowed to spend a request, since cache keys carry the
provider. A result produced by a substitute engine carries `fellBackFrom`, and
its `provenance` names the engine that actually answered, never the selected one.

Because cache keys carry the provider, lines translated by a substitute stay as
that engine translated them once the selected engine recovers. Mixed-provider
subtitles within one video are the expected result, not a fault.

A separate exception is a short word lookup that appears clearly unreliable. A
bad result from MyMemory, Azure, DeepL, or LibreTranslate may be retried through
the Google concise-word path. An unreliable result already produced by Google is
rejected instead of repeatedly calling the same service.

### Lookup decision order

For a selected word or phrase, `background.js` uses this order:

```text
exact saved correction
        ↓ absent
identical request already in flight
        ↓ absent
persistent provider-specific cache
        ↓ absent
selected translation provider
        ↓ out of requests, and lookups may change engine
next eligible engine, cheapest first
        ↓ suspicious short-word result
Google concise-word fallback, unless Google was already selected
```

The content script has an additional session cache in front of this path. It is
populated by previous hovers and optional video-word warmup. This is why a
frequently used word can appear immediately without another runtime message.

The source row in the lookup card exposes the outcome:

- **your saved correction** means an exact local correction won;
- **instant session cache** means the page already held the result in memory;
- **local translation cache** means the persistent 180-day cache won;
- a provider provenance such as **Azure aligned**, **DeepL contextual**,
  **Google web**, or **MyMemory** means an engine request supplied the result;
- **Google concise fallback** means another engine's short-word answer failed
  the quality check and Google supplied the replacement.

A result that a substitute engine supplied names that engine, so a lookup made
while DeepL was out of requests reads **Google web**, not **DeepL contextual**.
The result also carries `fellBackFrom` with the engine that ran dry.

The adjacent provider link opens the same source text in a public Google,
MyMemory, DeepL, or Microsoft Translator lookup. A self-hosted LibreTranslate
service is labeled but has no external link because its endpoint may be private.

## What each provider returns

Every successful result is normalized to approximately this shape:

```js
{
  sourceText: "je mange",
  translatedText: "I eat",
  provider: "azure",
  provenance: "Azure aligned",
  cacheHit: false,
  alignmentKind: "character",
  alignment: [
    { sourceStart: 0, sourceEnd: 1, targetStart: 0, targetEnd: 0 }
  ]
}
```

Fields not supported by a provider are empty or absent.

### Azure

DualSub sends a JSON batch to Azure Translator v3 with source/target languages,
`includeAlignment=true`, and `includeSentenceLength=true`. Azure's projection
string is parsed into inclusive source and target character ranges. When those
ranges exist, `alignmentKind` is `character`; this is the only alignment treated
as precise enough for direct word highlighting.

### DeepL

DualSub sends a form-encoded batch to the DeepL Free API. Surrounding caption
text is passed in DeepL's `context` field when available. DeepL returns the line
translation but no word alignment through this implementation.

### Google

DualSub uses the keyless `translate_a/single` web endpoint. Up to four requests
from a batch are processed concurrently. Response pieces are concatenated into
the final text. When Google returns more than one meaningful source/target
piece, DualSub records those ranges as `segment` alignment.

Google segments are useful provenance, but they are not assumed to be word
alignment. The direct high-confidence path requires Azure `character`
alignment; Google results use the conservative lookup-evidence path described
below.

### MyMemory

DualSub sends each item separately with the chosen language pair and optional
email. MyMemory has a comparatively small public quota. HTTP or response-level
429 results pause its circuit and are reported explicitly.

For word lookups only, DualSub also checks whether MyMemory returned a very long
definition-like passage or text reliably detected as an unrelated language.
This protects against cases where a translation memory match is valid text but
not the requested concise English meaning.

### LibreTranslate

DualSub sends each item separately to the configured `/translate` endpoint.
Only HTTPS endpoints or localhost are accepted. The service returns translated
text but no standard word-alignment data in this implementation.

## Context, batches, and cache identity

Caption batches include nearby French lines as context. DeepL consumes that
context directly. It also contributes to the cache identity for ordinary cue
translations, preventing one context-sensitive result from being reused in an
unrelated context.

Word lookups use a stable cache identifier based on the normalized word. That
makes common word lookup fast across sentences, at the tradeoff that the cache
does not store a different provider answer for every sentence. Exact user
corrections are keyed by source language, target language, and normalized source
text and take precedence.

The persistent cache key also contains:

- schema version;
- provider;
- source and target languages;
- provider-version tag;
- video ID or the `lookup` namespace;
- cue identity or explicit word cache identifier.

Changing provider therefore causes cache misses for that provider, but it does
not erase previous providers' results. Switching back can reuse the older
provider-specific entries until they expire.

## Short-word quality checks

Quality screening applies only to requests marked as word lookups. A response
is suspicious when the source is at most three words and the result is much
longer than a concise meaning: its word count exceeds the larger of eight or
four times the source count; its character count exceeds the larger of 72 or
ten times the source length; or it is a multi-sentence passage with more than
six words.

MyMemory word results also pass through Firefox language detection. A result is
rejected only when detection is reliable enough and its strongest language is
neither the requested English nor the French source language. This catches
answers such as Spanish `creada` without rejecting ambiguous one-word answers
based on weak detection.

These checks do not prove that a meaning is semantically correct. The lookup
card's provider source and external link make the remaining uncertainty visible,
and **Correct meaning** stores an exact local override.

## How complete French and English cues are paired

Cue alignment happens before word alignment. For each French cue,
`refreshCueAlignment()` examines nearby English cues and scores them with:

```text
score = temporal overlap × 4 − distance between cue midpoints
```

The highest score becomes the English cue displayed beside that French cue.
The search stops after the English start time moves more than 2.5 seconds beyond
the French end. A moving cursor keeps this operation close to linear for normal
ordered tracks.

This algorithm handles small timestamp differences between independently timed
French and English tracks. It does not rewrite either track's times. During
playback, the caption offset is applied to the video clock before active-cue
lookup, and overlapping auto-generated cues prefer the most recently started
active cue.

## How a French word is analyzed

Before requesting its English meaning, DualSub gathers local grammatical
evidence from `language/french.js`.

### Normalization and elision

Words are normalized to lowercase NFC French text. Apostrophes and surrounding
punctuation are handled explicitly. Elided particles such as `j'`, `t'`, `s'`,
`l'`, `d'`, and `qu'` can be displayed and explained separately instead of
being treated as the verb or noun that follows.

For a reflexive form such as `s'habiller`, the clitic and lexical verb are
separated for analysis. The morphology lookup operates on the verb portion,
while nearby clitics and subjects contribute contextual evidence.

### Verb morphology

The ablaut WebAssembly engine proposes reverse-morphology matches. DualSub then:

1. parses the morphological slot into tense, mood, person, and number;
2. discards candidates whose lemmas are not in the Lefff-derived attested list;
3. inspects nearby subject pronouns and object/reflexive clitics;
4. ranks context-compatible candidates;
5. returns the likely infinitive and a small set of alternatives.

Built-in irregular and regular-form fallbacks are used if the WebAssembly data
is unavailable.

### Noun/adjective versus verb ambiguity

Lexique can attest multiple word groups for the same spelling. When a form that
looks like a participle follows a nominal determiner, DualSub prefers a noun or
adjective reading and retains the verb as an alternative. This is why context
such as `une ...` can prevent a misleading verb-first explanation.

Local analysis selects labels and infinitives; it does not invent the displayed
English meaning. The displayed meaning still comes from correction, cache, or
the translation provider.

## How French-to-English word matching works

Matching is deliberately conservative. If the evidence is weak, DualSub leaves
the English line unhighlighted.

### Path A: Azure character alignment

When the current English line was generated by Azure and includes character
projections:

1. `wordCharacterRange()` finds the selected French token's character offsets
   in the complete French line.
2. DualSub selects Azure projection entries whose source ranges overlap that
   token.
3. It finds English tokens whose character ranges overlap the corresponding
   target ranges.
4. Every overlapping target token receives the `is-aligned` highlight.

This supports one-to-many and many-to-one projections. It is the preferred path
because it uses alignment emitted for the exact translated sentence.

### Path B: lookup translation evidence

When precise character alignment is absent, hovering starts a short background
lookup for:

- the selected French surface form; and
- its likely infinitive, if local morphology found a different verb lemma.

Only the surface-form answer is shown as the lookup definition. Both answers can
be used privately as matching evidence.

DualSub tokenizes those English results and searches the displayed English line
for an exact contiguous occurrence. If the same phrase appears more than once,
it estimates the expected target position using the selected French word's
relative position:

```text
French position = (French token index + 0.5) / French token count
expected English index = French position × English token count − 0.5
```

The exact occurrence closest to that estimate wins.

If there is no exact occurrence, each displayed English word is compared with
the evidence words. The comparison:

- lowercases and removes accents and punctuation;
- recognizes a small set of common irregular English forms;
- strips common `-ing`, `-ied`, `-ed`, `-es`, and plural `-s` endings;
- otherwise uses normalized Levenshtein similarity.

An exact match scores `1.0`, a matching English stem scores `0.9`, and a fuzzy
match must score at least `0.86`. Highest score wins, with proximity to the
estimated position breaking ties.

### Worked examples

For `je mange une pomme` → `I am eating an apple`:

- the surface lookup for `mange` may produce `eat`;
- the infinitive lookup for `manger` may also produce `eat`;
- no exact `eat` exists in the line;
- English stemming reduces `eating` to `eat`;
- the 0.9 stem match allows `eating` to be highlighted.

For `je regarde la banque` → `I look at the bank`:

- `la` appears early in French but its likely English determiner `the` may occur
  more than once;
- exact matching finds both occurrences;
- relative-position distance prefers the occurrence nearer the French token's
  location, but no highlight is made if lookup evidence does not contain `the`.

For an idiom whose word meaning is absent from the final English sentence,
DualSub usually highlights nothing. That is intentional: a guessed positional
match would look authoritative while being linguistically wrong.

## Phrase selection

Dragging text or choosing **Select phrase** sends the complete selected surface
text with `cacheMode: "phrase"`. Its translation is displayed in the same card
and can be corrected or saved. Phrase lookup does not fabricate a token-by-token
mapping. Exact phrase evidence may highlight a contiguous target phrase, but
otherwise the matching fallback remains conservative.

## What is not inferred

DualSub currently does not run a bilingual transformer-based aligner locally.
It also does not use dictionary definitions as unquestioned truth, map words by
position alone, or treat Google response segments as exact word projections.

Consequently, matching may be absent when:

- the translation paraphrases the source;
- a French word is omitted in natural English;
- the provider returns a contextually different synonym;
- the displayed English line came from YouTube while lookup evidence came from
  another engine;
- morphology found the wrong lemma;
- several candidate English words are equally plausible.

The `Match translated words when evidence is reliable` setting controls all
English token highlighting without disabling French lookup itself.

## Relevant implementation points

| Behavior | Function/file |
| --- | --- |
| Provider normalization and cache keys | `cacheKeyFor()` in `translation-engine.js` |
| Provider HTTP implementations | `translateAzure()`, `translateDeepL()`, `translateGoogle()`, `translateMyMemory()`, `translateLibre()` |
| Persistent cache and batching | `translateBatch()` in `translation-engine.js` |
| Correction and word-quality precedence | `translateSelectionWithEngine()` in `background.js` |
| Cue-to-cue time matching | `refreshCueAlignment()` in `content.js` |
| Rolling translation priority | `translationPrefetchOrder()` and `pumpAheadTranslationBatch()` in `content.js` |
| Azure character projection | `applyPreciseProviderAlignment()` in `content.js` |
| Lexical fallback matching | `refineAlignedTargetWords()` in `content.js` |
| French morphology and group choice | `analyzeWord()` and `classifyWord()` in `language/french.js` |
| Lookup source display | `showLookupProvenance()` in `content.js` |

When modifying these algorithms, add cases to `tests/smoke.test.js`. In
particular, preserve the rule that a missing highlight is safer than a confident
but unsupported French-to-English match.
