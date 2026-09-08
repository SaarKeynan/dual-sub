# Working on DualSub

DualSub is a Firefox Manifest V3 extension for learning French with bilingual
YouTube subtitles, word lookup, vocabulary review, listening practice, and OCR.
It uses plain JavaScript, HTML, and CSS with no application bundler. Firefox
loads scripts in the order declared in `manifest.json` or extension HTML pages.

Read `docs/ARCHITECTURE.md` for the runtime flow and
`docs/TRANSLATION_AND_ALIGNMENT.md` for translation and word matching details.
Use `README.md` for installation and user-facing behavior.

## Development and validation

Use Node.js 22 or newer and install dependencies with `npm ci`.

```sh
npm run check        # JavaScript syntax checks
npm test             # Smoke, regression, jsdom UI, and video cache tests
npm run lint         # Firefox web-ext lint; warnings are errors
npm run verify       # All of the above
npm run build        # Package into .web-ext-artifacts/
npm run screenshots  # Render the overlay and pages to .shots/ for visual review
```

The test suites use jsdom, which has no layout engine, so they cannot catch a
visual regression. `npm run screenshots` renders the subtitle overlay at three
player sizes and each extension page in the Chrome or Edge already installed,
writes PNGs to `.shots/`, and prints measurements jsdom cannot produce: computed
caption size, resolved line widths, row counts, whether the page scrolls
sideways, and how many elements render below 10px. Look at the PNGs after any
change to `content.css` or a page stylesheet. Set `DUALSUB_CHROME` if neither
browser is in a standard location.

For manual testing, open Firefox `about:debugging#/runtime/this-firefox`, choose
Load Temporary Add-on, and select `manifest.json`. Reload the extension and the
YouTube tab after runtime changes. Automated tests do not establish that current
YouTube endpoints, fullscreen behavior, or live screenshot capture work; report
whether a live Firefox check was performed.

## Gotchas

- There is no module system. Each script attaches a frozen `globalThis.DualSub*`
  object and later scripts read it, so load order in `manifest.json` is the
  dependency order. A new script must be registered in three places: the
  matching `manifest.json` list (`content_scripts[].js` or `background.scripts`),
  the hand-enumerated `check` script in `package.json`, and `web-ext-config.cjs`
  if it is development-only.
- `tests/smoke.test.js` slices function bodies out of `content.js` by name
  markers (for example `refreshCueAlignment` through `startAheadTranslation`)
  and asserts on literal source and CSS strings. Renaming, reordering, or moving
  those functions breaks the suite even when behavior is unchanged; update the
  markers in the same change.
- The runtime is French-to-English only. `sourceLanguage` and `targetLanguage`
  exist in settings but no UI exposes them, and elision splitting, morphology,
  and lookup readings assume French.
- Regenerating `vendor/lexique/*.json` needs `vendor/lexique/Lexique383.tsv`,
  which is gitignored and must be downloaded separately. Lexique `cgram` codes
  carry subcategories such as `PRO:per` and `ART:def`.
- `docs/ARCHITECTURE.md` and `docs/TRANSLATION_AND_ALIGNMENT.md` state the
  version they describe in their first paragraph; update both on release.
- Google's keyless `translate_a/single` endpoint translates exactly one `q` and
  silently ignores any others, so repeating `q` does not batch and looks like a
  success. It does return one chunk per newline-separated line, and each chunk
  repeats its own source text, which is how `translateGoogle` batches: the
  mapping is verified against those source strings and falls back to one request
  per line if they do not match. The endpoint is rate limited per IP and starts
  answering 429 after very few requests, so measure request counts, not just
  whether a call succeeded.

## Code ownership

- `page-bridge.js` runs in the YouTube page context and accesses player data.
  It communicates with the content script through DOM events.
- `content.js` manages video lifecycle, subtitle rendering, lookup cards, and OCR
  selection. `content.css` styles the overlay. The `content/` modules contain
  caption parsing/loading, translation priority ordering, and lookup markup.
- `background.js` handles extension messages, persistent learning data, caption
  requests, translation orchestration, commands, and screenshot capture.
- `translation-engine.js` owns provider adapters, translation caching,
  cancellation, retries, backoff, and provider health.
- `video-cache.js` persists timed caption tracks and available translations
  across refreshes using IndexedDB with a bounded local-storage fallback.
- `language/french.js` handles local morphology, elisions, grammatical readings,
  and lookup query preparation using resources in `vendor/`.
- `shared/settings.js` centralizes defaults and settings migration.
  `shared/practice.js` implements listening practice and dictation comparison.
- `popup/`, `sidebar/`, `vocabulary/`, and `tools/translator.*` provide extension
  workspaces. OCR uses bundled Tesseract resources and runs locally.

## Invariants to preserve

- YouTube uses single-page navigation. Cancel obsolete translation sessions and
  guard asynchronous state updates with the existing generation/session checks.
  Restore the user's native caption state when leaving a video or disabling
  DualSub. Videos without French captions should fall back quietly.
- Use video time plus the configured offset for caption timing. Preserve JSON3
  append semantics and fragment timing; do not fix alignment by indiscriminately
  extending cue durations.
- Route provider calls through the translation engine. Check caches before
  rejecting work because a provider is in backoff. Navigation cancellation must
  not count as a provider failure.
- Keep grammatical labels and translations consistent. Ambiguous elisions such
  as `l'as` need a prepared query and reading-specific cache key; retain explicit
  noun contexts such as `l'as de pique`.
- MyMemory match/quality scores do not guarantee a correct meaning. The observed
  `avez` result `her name is Anna` is rejected by word-quality validation and
  uses the concise Google fallback. Preloading must apply the same checks as
  interactive lookup. Do not turn rate-limit errors into automatic fallback.
- Keep video snapshots isolated by video, languages, tracks, provider, and custom
  endpoint. Preserve expiry and size limits. Clearing caches must prevent late
  saves or pagehide handlers from restoring cleared snapshots.
- Serialize read-modify-write operations on learning data. Repeated saves must
  preserve notes and contexts. Capacity errors must not silently delete existing
  vocabulary. Validate backup restores before writing their contents.
- Keep both DualSub and native captions hidden during OCR selection, the two
  animation frames before capture, and the result window. Restore visibility on
  close, cancellation, and capture failure without changing caption preferences.
- Store provider secrets in local storage, never sync storage. Preserve extension
  CSP and permission boundaries. Render external text safely. Keep morphology
  and OCR assets local and retain their third-party license notices.

## Tests and releases

Add behavioral regressions for changes to parsing, timing, cache isolation,
storage, navigation, or lookup quality. Choose the appropriate existing suite:
`tests/smoke.test.js`, `tests/regression.test.js`, `tests/ui.test.js`, or
`tests/video-cache.test.js`. Avoid tests that only duplicate implementation.

Run `npm run verify` for runtime changes and `npm run build` when packaging a
release. Keep versions in `manifest.json`, `package.json`, and `package-lock.json`
consistent. Update `CHANGELOG.md` and relevant documentation for user-visible
changes. Check `web-ext-config.cjs` when adding files so development-only assets
are excluded from the extension package. Do not commit generated ZIPs, installed
dependencies, credentials, or local Firefox data.
