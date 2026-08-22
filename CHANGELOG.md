# Changelog

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
