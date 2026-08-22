# Changelog

## 0.6.3 — clearer lookup cards and persistent word cache

- Rewrote verb-form explanations as plain-language descriptions of the base
  verb, likely subject, tense, and everyday meaning of that tense.
- Moved each selected word’s grammatical group and translation into one
  color-matched panel; verb panels and conjugation accents are purple by
  default and follow the editable verb color.
- Added a bounded, 180-day local cache for up to 1,200 translated words. It
  survives background-worker restarts, while sentence translations remain
  transient.
- Added an immediate in-page cache so reopening a translated word does not
  briefly flash “Translating…”.

## 0.6.2 — editable grammatical palette

- Replaced the similar pastel word-group colors with a more distinct palette.
- Made all ten colors editable under Appearance → French, including the
  unclassified “Word” color, which now defaults to pure white.
- Applied the custom palette consistently to hover highlights, lookup badges,
  phrase selections, and the optional fully colored French subtitle row.

## 0.6.1 — popup scrolling and clearer provider errors

- Restored vertical scrolling in the settings popup while keeping horizontal
  overflow hidden.
- Replaced MyMemory's raw HTTP 429 failure with an actionable rate-limit
  message and the stable `MYMEMORY_RATE_LIMITED` diagnostic code.
- Moved the French grammatical-group coloring toggle to Appearance → French.

## 0.6.0 — word groups, French voices, and phrase lookup

- Added an offline 125,132-form grammatical-category index derived from
  Lexique 3.83. Word cards now identify nouns, verbs, adjectives, adverbs,
  pronouns, determiners, prepositions, conjunctions, and interjections.
- Added consistent category-specific hover colors and an optional setting that
  applies the same colors to all French subtitle words.
- Used determiner and sentence context to avoid presenting nominal participles
  as verbs. In “une psychée,” the card now favors the attested noun `psyché`
  while retaining `psycher` as a possible verb reading.
- Added a French system-voice selector, automatic preference for French natural
  or neural voices, adjustable speech rate, and a pronunciation preview.
- Replaced the redundant Translate line action with Select phrase: start from a
  word and click the final word to translate the complete range. Drag-selection
  remains available.
- Split Tools internally into compact Lookup & colors and Pronunciation panes
  so the popup remains scrollbar-free.

## 0.5.3 — persistent precise-timing recovery

- Kept the loading indicator visible after live translation becomes usable;
  live bilingual text and precise timed-track readiness are now separate states.
- Accepted YouTube's native timed-caption requests whether or not their current
  URL happens to contain the optional `pot` parameter.
- Extended background timed-track recovery from roughly ten seconds to roughly
  one minute, while throttling retries of an identical failed URL.
- Added precise-timing recovery state, attempt count, and the latest failure
  reason to copied diagnostics.

## 0.5.2 — visible and prioritized loading

- Added a compact persistent loading badge above the subtitle rows while live
  fallback is active and complete timed tracks are still being acquired.
- Started native authenticated-track recovery concurrently with the transcript
  request instead of waiting for transcript failure first.
- Consumed YouTube's observed authenticated caption URL immediately rather than
  waiting for another polling interval.
- Prioritized English translation at the current playback position, then an
  eight-second context buffer behind it, followed by upcoming captions.
- Reprioritized the translation queue after seeking and surfaced when English
  near the new playback position is still being prepared.

## 0.5.1 — caption boundary and synchronization fix

- Stopped treating arbitrary short overlapping captions as late words from the
  previous line. Unmarked fragments now fold only when timing, grammar, and the
  following roll-up event all identify a transient continuation.
- Kept YouTube's explicit `aAppend` caption updates intact.
- Separated translation preloading from display timing, removing the inherited
  500 ms advance that could make complete tracks appear early.
- Replaced the one-way early-display control with a neutral synchronization
  correction that can move captions earlier or later when a specific video
  needs it.

## 0.5.0 — full morphology and focused tools

- Replaced the small hand-maintained conjugation index with an offline hybrid:
  ablaut 0.7 performs verified reverse morphology and a 7,820-lemma Lefff
  derivative rejects unattested rule-generated infinitives.
- Improved ambiguous matching by translating up to three distinct candidate
  lemmas and using only visible English evidence for highlighting.
- Added selectable smart, pointer-adjacent, and upper-right lookup positions;
  smart mode centers the card near the word but above the subtitle block.
- Consolidated settings into General, Appearance, and Tools. Appearance uses a
  compact French/English switch and the popup has no page-level scrollbars.
- Added card pinning, one-click bilingual copy, previous/next word navigation,
  0.75× replay, caption looping, and a lemma-aware Wiktionary link.
- Added third-party source, modification, and license notices for ablaut and
  the Lefff-derived verb list.

## 0.4.0 — conjugation-aware learning UI

- Added local French verb-form analysis for common irregular and regular verbs,
  showing infinitive, tense, person, number, and ambiguous alternatives.
- Improved French-to-English highlighting with evidence from both the spoken
  form and inferred infinitive; uncertain matches are still left unmarked.
- Docked lookup cards away from the subtitle rows and automatically dismiss them
  after the pointer leaves, resuming playback when DualSub paused it.
- Filtered YouTube's startup caption labels such as “French (auto-translated)”
  and “Click for settings” from the learning subtitles.
- Reorganized the popup into General, French, English, Learning, and Services
  categories with a fixed, scrollbar-free layout.

## 0.3.2 — subtitle latency fix

- Complete YouTube tracks render 500 ms ahead by default, adjustable from 0 to
  1500 ms in the popup.
- Live fallback starts translating a stable candidate after 90 ms instead of
  waiting for the whole-line settlement timer to expire.
- Reduced whole-line live settlement from 600 ms to 360 ms.
- Word translation begins shortly after hover so reliable matching can finish
  before the lookup card opens.

## 0.3.1 — normal-player and word-matching fix

- Removed video-overlaid backdrop blur, filtered shadows, transform animation,
  and recall-mode blur that could trigger unstable Firefox compositing outside
  fullscreen.
- Removed positional English-word guesses. English highlighting now appears
  only after an exact translated phrase or a strong inflection match is found.
- Added conservative English stemming, edit-distance matching, and regression
  tests for accepted and rejected word pairs.

## 0.3.0 — staged learning workspace

- Faster caption loading, cached payloads, and parallel format fallback.
- Event-driven recovery of YouTube proof-of-origin authenticated tracks.
- French/English cue alignment and bounded overlap lookup for long transcripts.
- Interactive word tokens with hover, click, keyboard lookup, and approximate
  bilingual highlighting refined from the word translation.
- Rich lookup cards with full-line context, pronunciation, replay, sentence
  translation, and vocabulary saving.
- Active-recall and auto-pause study modes.
- Local vocabulary collection with context, timestamps, encounter deduplication,
  editable translations and notes, search/filter/sort, safe CSV export, JSON
  backup/restore, and spaced review with typed answers.
- Replay and vocabulary keyboard shortcuts, live style previews, clearer status
  states, diagnostics copying, reduced-motion support, and keyboard focus styles.

### Git recovery points

- `b2ef378` — untouched 0.2.3 baseline on `master`.
- `6145da4` — faster caption loading and cue alignment foundation.
- `49d00f0` — interactive lookup and vocabulary review milestone.
- `d5ca059` — deeper study workflow, accessibility, backup, and recovery.
- `6f3075d` — advanced study modes, diagnostics, performance polish, and 0.3.0 release documentation.

## 0.2.3

- Folded short unflagged caption tails into incomplete lines.
- Preferred the newest active cue when auto-caption timings overlap.
