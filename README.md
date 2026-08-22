# DualSub for YouTube

DualSub is a small Firefox WebExtension for French learners. It displays the
active French and English YouTube captions **at the same time** in two separate
rows.

## Features

- French source captions plus an English caption track or YouTube's English
  auto-translation, rendered simultaneously. Auto-generated French captions
  are supported, with JSON and XML caption-format fallbacks. If YouTube returns
  an empty downloadable translation, DualSub falls back to the player's live
  English caption renderer.
- One-click on/off switch and `Alt+Shift+D` keyboard shortcut.
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
  controls for each language.
- Select a French word or sentence directly in the captions for an inline
  English translation.
- Fullscreen support and automatic handling of YouTube's single-page navigation.

## Translation cost and privacy

The continuous English subtitle line normally uses YouTube's caption translation,
so it does not consume a separate translation service. When a fallback is needed,
the default provider is Google's keyless web translation endpoint for better
quality and rolling lookahead. This endpoint is unofficial and may be rate-limited
or changed without notice. The documented free [MyMemory API](https://mymemory.translated.net/doc/spec.php)
is available as an alternative in the popup. Translation results are cached for
the current browser session. Fallback caption text and explicitly highlighted
text are sent to the selected provider.

YouTube caption endpoints are not a public, stable API. If YouTube changes its
player response or timed-text format, the caption loader may need an update.

## Load temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose this project's `manifest.json`.
4. Open or reload a YouTube video that has French captions.
5. Open the toolbar button to adjust each caption row.

A temporary extension is removed when Firefox exits. For permanent local use,
package and sign the extension through Mozilla Add-ons.

## Development checks

The extension uses plain JavaScript and has no build step or runtime
dependencies. To check syntax:

```powershell
node --check background.js
node --check content.js
node --check page-bridge.js
node --check popup/popup.js
```
