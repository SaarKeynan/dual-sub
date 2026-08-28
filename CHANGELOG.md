# Changelog

## 0.7.0 — resilient translation and study workspace

- Replaced individual lookahead requests with a priority batch scheduler that
  starts at the playback position, buffers in both directions, cancels stale
  video sessions, honors rate-limit recovery, and reports its queue health.
- Added Azure Translator, DeepL API Free, and custom LibreTranslate adapters in
  addition to Google web translation and manual MyMemory use. Provider secrets
  stay in local Firefox storage and optional host access is requested only when
  configured.
- Added a bounded 180-day IndexedDB translation cache with a local-storage
  fallback, provider/version-aware keys, cache statistics, and explicit clear.
- Added exact Azure character alignment and Google segment alignment ahead of
  conservative local word matching. Translation provenance is shown beside the
  English row and personal vocabulary corrections override later word lookups.
- Kept raw YouTube cue fragments as timing provenance, moved rendering to video
  frame/media events, added a configurable line hold, and expanded diagnostics
  with the nearby cue window, alignment spans, buffer state, and provider health.
- Added a Firefox transcript sidebar with bilingual search, seeking, current-line
  tracking, translation buffer status, known-word coverage, frequent unknown
  words, and repeated phrase mining. Incremental revisions avoid rebuilding the
  complete transcript on every poll.
- Added Watch, Focus, Study, and Shadow modes, unknown-word smart pauses,
  optional silent-gap skipping, per-video timing/mode profiles, caption
  navigation commands, and a fixed-modifier bypass for other dictionary tools.
- Enriched the offline Lexique derivative with lemma, IPA-like pronunciation,
  gender, number, syllable count, and frequency data for 50,000 common forms.
- Expanded review with forward, reverse, cloze, and listening exercises,
  tolerant answer checks, adaptive scheduling, and safe Anki TSV export.
- Added keyboard-accessible settings tabs, contrast warnings, a responsive
  options page, automated manifest linting, tests, packaging, and CI checks.

## 0.6.9 — silent native-caption fallback

- Removed the DualSub error notice on videos without a French caption track.
- Kept YouTube's regular subtitle renderer visible until a French track has
  actually been confirmed.
- Silently disabled the DualSub overlay for the current video when French is
  unavailable, while leaving the extension enabled for the next video.
- Prevented repeated caption-track requests after a video is known not to have
  French captions.
- Cleared saved native-caption state during YouTube SPA navigation so a track
  from the previous video cannot interfere with regular captions on the next.
- Restored the user's original YouTube caption choice at navigation start,
  before the old player and its caption state are replaced.

## 0.6.8 — elision-aware subtitle words and compact particles

- Split French elisions into adjacent grammatical targets without changing the
  displayed spelling: `s’` is now a pronoun and `habiller` is the verb in
  `s’habiller`; `d’`, `l’`, `j’`, and similar particles are handled likewise.
- Kept the complete compound attached to verb lookup and translation, so the
  main word still resolves to forms such as `s’habiller` and `t’aimer`.
- Added a small, non-pausing, request-free particle tooltip instead of opening
  the full learning card for a one- or two-letter particle.
- Classified `l’` contextually as a determiner before nouns and adjectives, or
  as a pronoun before verbs.
- Recognized standalone `s’/se` infinitives as pronominal even when there is no
  explicit sentence subject.

## 0.6.7 — reliable compact status close button

- Reduced the status close button from 32 to 22 pixels.
- Replaced the font glyph with two precisely centered CSS strokes, retaining
  the dark-blue circle and lighter-blue X.
- Dismissed messages on pointer-down before YouTube can consume the click, and
  kept the same message dismissed through repeated caption-loading retries.
- Reset dismissed notices only when navigating to another video.

## 0.6.6 — clitic and reflexive verb analysis

- Added morphology support for apostrophe-linked forms such as `t’aime`,
  `m’appelle`, `s’appelle`, and `j’aime` while keeping each compound easy to
  select and translate.
- Distinguished object pronouns (`je t’aime`) from genuinely reflexive forms
  (`il s’appelle`) using the sentence subject.
- Used nearby subject pronouns to choose ambiguous conjugations correctly and
  recognized separate reflexive pronouns in phrases such as
  `nous nous appelons`.
- Added the expanded clitic and its role to the compact grammar explanation,
  and linked reflexive lookups and examples through the pronominal infinitive.

## 0.6.5 — larger status dismiss control

- Enlarged the dismiss button to a 32-pixel circular hit target and explicitly
  enabled pointer and touch interaction inside the video overlay.
- Restyled the button as a deep-blue circle with a lighter-blue X, plus clear
  hover, pressed, and keyboard-focus states.
- Prevented the player beneath the overlay from intercepting the button's
  initial pointer press.

## 0.6.4 — video word warm-up, compact grammar, and voice setup

- Added an optional, enabled-by-default warm-up that preloads the 36 most
  frequent words from complete timed captions (12 with MyMemory), using two
  low-priority workers and stopping after provider errors.
- Prevented Google warm-up failures from spilling into MyMemory and consuming
  its smaller free quota. Existing persistent cache hits remain request-free.
- Replaced prose-heavy verb explanations with compact forms such as
  `mange → manger`, `present · 1st person singular`, and `Example: Je mange.`
- Added a real-world Example sentences link to Tatoeba for each lookup.
- Replaced the no-voice dead end with a setup action and bundled Windows,
  macOS, and Linux French-voice instructions.
- Made missing-French-track and other error notices dismissible without
  disabling the extension.
- Renamed and documented the synchronous fallback morphology tables, replaced
  repeated ranking scans with a map, and hoisted per-lookup constant sets.

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
