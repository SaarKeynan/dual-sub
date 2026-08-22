# Changelog

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

## 0.2.3

- Folded short unflagged caption tails into incomplete lines.
- Preferred the newest active cue when auto-caption timings overlap.
