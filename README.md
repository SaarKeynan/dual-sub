# DualSub for YouTube

DualSub is a Firefox WebExtension for French learners. It displays French and
English YouTube captions **at the same time**, then turns each subtitle into an
interactive study surface.

## Features

- French source captions plus an English caption track or YouTube's English
  auto-translation, rendered simultaneously. Auto-generated French captions
  are supported, with JSON and XML caption-format fallbacks. If YouTube returns
  an empty downloadable translation, DualSub falls back to the player's live
  English caption renderer.
- One-click on/off switch and `Alt+Shift+D` keyboard shortcut.
- Faster loading through parallel page/extension caption requests, concurrent
  format fallbacks, cached caption payloads, and an event-driven upgrade when
  YouTube exposes an authenticated auto-caption request.
- Adjustable subtitle lookahead displays complete downloaded tracks slightly
  early to compensate for player and translation latency.
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
  live mode to complete synchronized tracks automatically.
- YouTube's flagged and unflagged late auto-caption continuation fragments are
  folded into the full line, and overlapping cues prefer the newest line, so
  final words do not wait until the end of the sentence to appear.
- Independent font size, color, background, opacity, font, weight, and italic
  controls for each language, with live previews in the popup.
- Hover or click a French word for an instant translation. A corresponding
  English word is highlighted only when the translated surface form or inferred
  infinitive provides an exact or strong inflection match; uncertain matches are
  intentionally left unmarked.
- Common French conjugations are analyzed locally. The lookup card shows the
  likely infinitive, tense, person, and number, including alternatives for
  ambiguous forms such as `fait`.
- Select any French phrase or sentence for lookup; lookup cards include the
  complete bilingual line, pronunciation, sentence translation, replay, and a
  Google Translate link. Cards are docked above the captions and close after the
  pointer leaves, resuming playback if the lookup paused it.
- Optional active-recall mode hides English until the French row is hovered.
- Optional auto-pause mode stops at each new line for intensive listening.
- Save words with their translation, complete sentence, video, and timestamp.
- A dedicated vocabulary workspace supports search, filters, personal notes,
  corrections, CSV export, JSON backup/restore, pronunciation, and spaced
  review with optional typed answers.
- In-flight translations are deduplicated and results are cached for the
  current browser session to reduce latency and free-service usage.
- Fullscreen support and automatic handling of YouTube's single-page navigation.
- A compact categorized settings menu separates General, French, English,
  Learning, and Services controls without page-level scrollbars.

## Shortcuts

- `Alt+Shift+D`: toggle DualSub.
- `Alt+Shift+R`: replay the current French subtitle line.
- `Alt+Shift+V`: open the vocabulary workspace.

Firefox shortcuts can be reassigned from **Add-ons and themes → Extensions →
Manage Extension Shortcuts**.

## Translation cost and privacy

The continuous English subtitle line normally uses YouTube's caption translation,
so it does not consume a separate translation service. When a fallback is needed,
the default provider is Google's keyless web translation endpoint for better
quality and rolling lookahead. This endpoint is unofficial and may be rate-limited
or changed without notice. The documented free [MyMemory API](https://mymemory.translated.net/doc/spec.php)
is available as an alternative in the popup. Translation results are cached for
the current browser session. Fallback caption text and explicitly highlighted
text are sent to the selected provider.

Vocabulary, review progress, notes, video IDs, and timestamps are stored locally
in Firefox. They are not sent to a DualSub server. JSON backup and CSV export
only occur after an explicit click. Pronunciation uses Firefox's local Web
Speech support when available. Word matching is computed locally.

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
dependencies. The current work is staged on `feature/conjugation-ui`; `master`
preserves the 0.2.3 baseline. Useful recovery points are listed in
[`CHANGELOG.md`](CHANGELOG.md).

Run the smoke suite (caption timing/alignment, translation request deduplication,
and vocabulary storage/review/import):

```powershell
Get-Content -Encoding utf8 -Raw tests/smoke.test.js | node -
```

Check individual script syntax:

```powershell
node --check background.js
node --check content.js
node --check language/french.js
node --check page-bridge.js
node --check popup/popup.js
node --check vocabulary/vocabulary.js
```
