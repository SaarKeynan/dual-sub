# DualSub for YouTube

DualSub is a Firefox WebExtension for French learners. It displays French and
English YouTube captions **at the same time**, then turns each subtitle into an
interactive study surface.

For an implementation map and detailed feature flows, see
[DualSub architecture and behavior](docs/ARCHITECTURE.md). Translation sources,
French analysis, and French-to-English word matching are detailed in
[How DualSub finds translations and word matches](docs/TRANSLATION_AND_ALIGNMENT.md).

## Features

- A resilient translation scheduler prioritizes the current caption, batches a
  configurable lookahead window, cancels work when the video changes, backs off
  after rate limits, and keeps French visible while English catches up.
- Choose Azure Translator for exact character alignment and batching, DeepL API
  Free for contextual translation, the keyless Google web endpoint, a custom
  LibreTranslate server, or manual MyMemory compatibility. A provider-aware,
  bounded 180-day local cache avoids retranslating caption lines and words.
- A Firefox sidebar provides a searchable bilingual transcript, one-click
  seeking, buffer status, known-word coverage, frequent unknown words, and
  repeated phrase mining without covering the video.
- Watch, Focus, Study, and Shadow modes bundle useful learning behavior. Timing
  and mode can be remembered per video, and silent captionless gaps can be
  skipped optionally.

- French source captions plus an English caption track or YouTube's English
  auto-translation, rendered simultaneously. Auto-generated French captions
  are supported, with JSON and XML caption-format fallbacks. If YouTube returns
  an empty downloadable translation, DualSub falls back to the player's live
  English caption renderer.
- One-click on/off switch and `Alt+Shift+D` keyboard shortcut.
- A compact type-or-paste translator and local French OCR workspace. Video OCR
  pauses playback and lets you drag directly over video text; releasing opens a
  modal inside YouTube that recognizes and translates it without leaving the tab.
- Faster loading through parallel page/extension caption requests, concurrent
  format fallbacks, cached caption payloads, and an event-driven upgrade when
  YouTube exposes an authenticated auto-caption request.
- Translation is buffered ahead without shifting subtitle display time; a
  neutral synchronization control can correct unusually early or late videos.
- Whole-line live captions by default, with an optional immediate word-by-word
  mode. Whole-line mode waits for YouTube's changing cue to settle and for its
  English translation, then reveals both languages together.
- Caption tracks are requested from YouTube's own page context first so complete
  French and English tracks can be loaded and synchronized before playback when
  YouTube permits it. If timed-text downloads are blocked, DualSub requests the
  full transcript panel and pre-translates a rolling window ahead of playback;
  live cue translation is only the final fallback.
- For videos whose auto-captions require YouTube proof-of-origin tokens, DualSub
  observes the native player's authenticated caption request and upgrades from
  live mode to complete synchronized tracks automatically. A compact loading
  badge makes this temporary live phase explicit.
- YouTube's explicit append events and strongly identified transient roll-up
  fragments are folded into the full line; independent short captions keep
  their own boundaries, and overlapping cues prefer the newest line.
- Independent font size, color, background, opacity, font, weight, and italic
  controls for each language, with live previews in the popup.
- Hover or click a French word for an instant translation. A corresponding
  English word is highlighted only when the translated surface form or inferred
  infinitive provides an exact or strong inflection match; uncertain matches are
  intentionally left unmarked. Word translations use an immediate in-page
  cache plus the bounded persistent translation cache, so repeated lookups do
  not flash a loading state or spend provider quota.
  When full timed captions are available, DualSub can also preload a small set
  of the video's most frequent words before they are selected.
  Each lookup card identifies whether its result came from a correction, local
  cache, or live engine request and links to the provider's public lookup page.
- French conjugations are analyzed locally with ablaut's reverse morphology,
  then checked against a 7,820-infinitive Lefff derivative. The lookup card
  shows only the most likely infinitive, keeping grammatical analysis out of
  the way of the translation.
- An offline Lexique 3.83 derivative identifies grammatical word groups for
  125,132 French forms. Lookup cards show a color-coded noun, verb, adjective,
  adverb, pronoun, determiner, preposition, conjunction, or interjection label;
  the same colors can optionally be applied to every French subtitle word.
  Every group color is editable under Appearance → French, while unclassified
  words default to white.
- Determiner context suppresses misleading verb-first readings for nominal
  forms; for example, `une psychée` favors the attested noun `psyché` while
  retaining `psycher` as an explicitly secondary possible verb reading.
- Select any French phrase or sentence for lookup; lookup cards include the
  complete bilingual line, pronunciation, sentence translation, replay, and
  Google Translate and Wiktionary links. Cards can appear intelligently above
  the subtitles, beside the pointer, or in the upper-right; they close after
  the pointer leaves unless pinned and resume playback if lookup paused it.
- Lookup cards can copy the bilingual pair, step to the previous or next French
  word, build a multi-word phrase by choosing its final word, replay at 0.75×
  speed, and loop the current caption for shadowing. Drag-selection also looks
  up arbitrary French phrases.
- Pronunciation uses a selectable French system voice, preferring French
  natural or neural voices when available, with adjustable rate and preview.
  If Firefox exposes no French voice, the setup action opens bundled Windows,
  macOS, and Linux installation instructions.
- Optional active-recall mode hides English until the French row is hovered.
- Optional auto-pause mode stops at each new line for intensive listening.
- Save words with their translation, complete sentence, video, and timestamp.
- A dedicated vocabulary workspace supports search, filters, personal notes,
  corrections, CSV export, JSON backup/restore, pronunciation, and spaced
  review with optional typed answers.
- In-flight translations are deduplicated and successful results are cached
  locally for up to 180 days to reduce latency and provider usage. Cache data
  can be inspected and cleared from General settings.
- Fullscreen support and automatic handling of YouTube's single-page navigation.
- Videos without a French caption track fall back silently to YouTube's regular
  subtitles; DualSub does not cover, disable, or replace them.
- A compact categorized settings menu separates General, Appearance, and Tools
  controls without page-level scrollbars.

## Shortcuts

- `Alt+Shift+D`: toggle DualSub.
- `Alt+Shift+L`: show the English line normally or hide it until the French
  line is hovered.
- `Alt+Shift+R`: replay the current French subtitle line.
- `Alt+Shift+V`: open the vocabulary workspace.
- `Alt+Shift+O`: pause and drag over video text for OCR (release to capture;
  `Escape` cancels).
- `Alt+Shift+Left` / `Alt+Shift+Right`: previous or next caption.

To reassign any shortcut, open DualSub and select **Tools → Shortcuts &
troubleshooting → Remap shortcuts**. DualSub opens Firefox's shortcut editor
directly with its commands highlighted.

## Translation cost and privacy

The continuous English subtitle line uses YouTube's own English caption track
when one is available. When external translation is needed, the default is
Google's keyless web endpoint. It is unofficial and may be rate-limited or
changed without notice. Azure Translator and DeepL both offer official free
tiers but require your own key; Azure is recommended when reliable word
alignment matters. A self-hosted or trusted LibreTranslate endpoint is also
supported. MyMemory remains available for manual compatibility but its public
quota is too small for long-video lookahead. Caption text and explicitly
highlighted text are sent only to the provider selected in General settings.
Provider keys are stored in `browser.storage.local`, never sync storage.

Vocabulary, review progress, notes, video IDs, and timestamps are stored locally
in Firefox. They are not sent to a DualSub server. JSON backup and CSV export
only occur after an explicit click. Pronunciation uses Firefox's local Web
Speech support when available. Word matching is computed locally.

The offline morphology resources and their licenses are documented in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). No conjugation request is
sent to a remote service.

YouTube caption endpoints are not a public, stable API. If YouTube changes its
player response or timed-text format, the caption loader may need an update.

## Load temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose this project's `manifest.json`.
4. Open or reload a YouTube video that has French captions.
5. Open the toolbar button to adjust each caption row.

When updating a temporary installation, click **Reload** next to DualSub on the
same `about:debugging` page, then reload the YouTube tab. Vocabulary is kept in
extension local storage; use **Backup JSON** before removing the temporary
extension if the browser may discard that storage.

A temporary extension is removed when Firefox exits. For permanent local use,
package and sign the extension through Mozilla Add-ons.

## Development checks

The extension uses plain JavaScript and has no build step or runtime
dependencies. Development checks use Node and `web-ext`; recovery points and
release changes are listed in [`CHANGELOG.md`](CHANGELOG.md).

Install the development dependency once, then run syntax checks, the smoke
suite, and Mozilla's extension linter:

```powershell
npm install
npm run verify
```

Build an installable archive:

```powershell
npm run build
```

The smoke suite also initializes the packaged WebAssembly engine and checks
irregular, regular, prefixed, and ambiguous French reverse analyses.
