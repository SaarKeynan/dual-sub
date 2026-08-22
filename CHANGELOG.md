# Changelog

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
