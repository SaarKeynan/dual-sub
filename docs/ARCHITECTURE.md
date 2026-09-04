# DualSub architecture and behavior

This document explains how the extension is divided, how its parts communicate,
and how the main user-visible features work. It describes version 0.8.3.

## Runtime architecture

DualSub runs code in four different contexts. Keeping their responsibilities
separate is important because Firefox gives each context different privileges.

```text
YouTube page context                   Firefox extension context
┌─────────────────────┐  DOM events   ┌──────────────────────────────┐
│ page-bridge.js      │◄─────────────►│ content.js + content.css     │
│ YouTube player data │               │ captions, overlay, learning │
└─────────────────────┘               └──────────────┬───────────────┘
                                                    │ runtime messages
                                     ┌──────────────▼───────────────┐
                                     │ background.js                │
                                     │ translation-engine.js        │
                                     │ data, network, OCR capture   │
                                     └───────┬──────────────────────┘
                                             │ runtime messages/storage
                      ┌──────────────────────▼──────────────────────┐
                      │ popup / sidebar / vocabulary / translator  │
                      │ settings and learning workspaces           │
                      └─────────────────────────────────────────────┘
```

- The **page bridge** can read YouTube's JavaScript player data but has no
  extension privileges.
- The **content script** owns everything displayed over the video and follows
  YouTube's single-page navigation.
- The **background scripts** own persistent data, provider requests, caption
  fetching, commands, and creation of tabs or popup windows.
- **Extension pages** provide settings, transcript, vocabulary, pronunciation
  help, manual translation, and OCR results.

## File map

| Path | Responsibility |
| --- | --- |
| `manifest.json` | Firefox permissions, scripts, pages, commands, CSP, and version |
| `content.js` | Caption acquisition and rendering, timing, lookup cards, study behavior, and the in-video OCR selector |
| `content.css` | Subtitle overlay, lookup card, status badge, and OCR selector styles |
| `page-bridge.js` | Reads and controls YouTube player internals from the page context |
| `background.js` | Settings defaults, extension messages, vocabulary, corrections, video profiles, caption proxy, commands, and OCR capture |
| `translation-engine.js` | Translation providers, batching, cache, retry/backoff, cancellation, and health metrics |
| `language/french.js` | French morphology, infinitives, elisions, lexical information, and word-group classification |
| `popup/*` | Searchable General, Appearance, and Tools settings |
| `sidebar/*` | Live bilingual transcript, seeking, buffer health, and known/unknown-word tools |
| `vocabulary/*` | Vocabulary browsing, editing, import/export, pronunciation, and spaced review |
| `tools/translator.*` | Type-to-translate workspace and local French OCR result popup |
| `help/pronunciation.*` | OS-specific instructions for installing a French speech voice |
| `vendor/*` | Offline morphology, lexical, and OCR runtime data |
| `scripts/*` | Developer-only generation and vendoring utilities |
| `tests/smoke.test.js` | Behavioral helper tests and structural regression checks |
| `web-ext-config.cjs` | Files included in or excluded from the Firefox package |

## Startup and YouTube navigation

Firefox injects the morphology runtime, `language/french.js`, `content.js`, and
`content.css` into YouTube. `content.js` then injects `page-bridge.js` into the
page context.

YouTube is a single-page application, so changing videos often does not reload
the document. DualSub listens for `yt-navigate-start` and `yt-navigate-finish`.
At navigation start it invalidates old asynchronous work and clears video-bound
state. At navigation finish it finds the new `<video>` and player, attaches the
overlay, loads the saved per-video profile, and asks the bridge for tracks.

The overlay is mounted inside the YouTube player. The same node is moved when
the player or fullscreen container changes, so fullscreen and theater mode do
not need separate subtitle renderers.

## Caption acquisition

### Track discovery

`page-bridge.js` reads YouTube's player response and returns the caption track
list through the `dualsub:tracks` DOM event. `content.js` chooses the requested
source and target languages. If there is no French track, DualSub exits quietly
and restores YouTube's regular captions.

### Preferred path: complete timed tracks

For both languages, `content.js` requests caption data in parallel. A request is
attempted from the page context and through the background caption proxy; the
first usable response wins. JSON3 is preferred, with XML formats as fallbacks.
If no native English track exists, YouTube's translated French track is
requested with `tlang=en`.

`parseCaptionPayload()` converts responses into a common cue structure:

```js
{ start: 1250, end: 3910, text: "example", fragments: [...] }
```

Explicit YouTube append events are joined. Heuristics fold strongly identified
late roll-up fragments without merging independent short captions. The original
fragment timing is retained for progressive display when that mode is enabled.

### Recovery and fallback order

YouTube sometimes rejects extension-created timed-text requests even though its
own player can load captions. DualSub degrades in this order:

1. Start observing the native French captions immediately.
2. Ask YouTube's transcript panel for a complete French transcript.
3. Observe the authenticated caption URL issued by the native player and retry
   complete timed-track loading.
4. If only French is recoverable, translate a rolling window around playback.
5. If no complete source is recoverable, translate settled native French lines
   live.

The temporary live state is explicit in the loading badge. When a better source
arrives, generation identifiers prevent old requests from overwriting it.

### Cue synchronization and display

Source and target cue lists are aligned by temporal overlap and midpoint
distance. At playback time, binary search finds the newest active cue; choosing
the newest matters because auto-generated YouTube cues commonly overlap.

Rendering uses `requestVideoFrameCallback` when Firefox exposes it, with an
animation-frame fallback. Display time is always based on the video's current
time plus the configured caption offset. Translation prefetch changes when text
becomes available, not its display timestamp.

In whole-line live mode, changing native caption text is allowed to settle for
the configured hold interval before it replaces the displayed line. Immediate
mode instead uses the retained fragment timing.

## Translation engine

For the full decision order, provider behavior, cue-alignment formula, French
morphology pipeline, and word-matching thresholds, see
[How DualSub finds translations and word matches](TRANSLATION_AND_ALIGNMENT.md).

`translation-engine.js` is loaded before `background.js`, exposing
`DualSubTranslation` to the background context. All external translation calls
pass through this service.

| Provider | Implementation | Notes |
| --- | --- | --- |
| Google | Keyless web endpoint | Default; inexpensive but unofficial and rate-limited |
| Azure | Translator API | Official; returns character alignment when available |
| DeepL | DeepL API Free | Official contextual translation; requires a key |
| MyMemory | Public API | Manual compatibility; small free quota |
| LibreTranslate | User-supplied endpoint | Can be self-hosted; optional API key |

The engine:

- normalizes and batches up to 1,000 requested items;
- deduplicates concurrent word and phrase lookups in `background.js`;
- retries temporary failures with `Retry-After`-aware delays;
- opens a per-provider circuit after repeated failures or rate limits;
- supports session cancellation when the video changes;
- reports provider health and cache statistics to the settings UI;
- returns `provider`, `provenance`, `cacheHit`, and any alignment information
  with each result.

### Translation cache

Successful translations are cached for 180 days. IndexedDB database
`dualsub-translation-cache`, store `translations`, is preferred. If IndexedDB
is unavailable, `browser.storage.local.lineTranslationCacheV2` is used with a
bounded entry count.

Cache keys include provider, source and target languages, provider version,
context, cache identifier, and a hash of the source text. This prevents results
from one provider or context silently contaminating another.

The content script also holds a short-lived in-memory lookup cache. It makes
repeated hover lookups instant and stores source metadata so the card can say
whether a result came from the session cache, persistent cache, saved
correction, or a live provider request.

### Rolling translation scheduler

When YouTube provides French timing but not English text, `content.js` builds a
priority queue. It translates the active cue first, then recent context, then
upcoming cues inside the configured buffer. Batch size is capped for each
provider. Failed work backs off without blocking French display. Navigating to
another video cancels the session and invalidates queued results.

Frequent words near the current position can be warmed separately for fast
lookup. This process is bounded and stops when the provider begins rejecting
requests.

## French language analysis and lookup

`language/french.js` loads three local resources in parallel:

- ablaut WebAssembly for reverse verb morphology;
- an attested Lefff-derived French verb lemma list;
- Lexique-derived word groups and compact lexical information.

If a resource fails, conservative built-in fallbacks remain available.

For a selected word, the module normalizes apostrophes and accents, separates
elided clitics such as `s'` and `t'`, asks the morphology engine for candidate
forms, rejects unattested infinitives, and ranks candidates using nearby
subjects and clitics. Determiner context can prefer a noun or adjective reading
over an otherwise plausible participle. `classifyWord()` separately returns the
primary noun/verb/adjective/etc. group and any alternatives.

The lookup card is owned by `content.js`. It combines:

- the surface word or selected phrase and concise English result;
- editable word-group color, lexical details, and likely infinitive;
- the full current French and English line;
- translation provenance and a provider lookup link when available;
- pronunciation, correction, copy, replay, slow replay, looping, phrase
  selection, and vocabulary actions.

Word-to-word highlighting has two levels. Azure character projections are used
when available. Otherwise DualSub only highlights target words when surface,
infinitive, stem, or edit-distance evidence is strong enough; uncertainty is
preferable to a misleading match.

Pronunciation uses Firefox's Web Speech API and the selected installed French
voice. DualSub does not download or install OS voices itself.

## Study modes and transcript sidebar

Study modes are setting bundles rather than separate renderers:

- **Watch** keeps normal bilingual playback.
- **Focus** enables active recall by hiding English until interaction.
- **Study** emphasizes lookup tools without forced pauses.
- **Shadow** auto-pauses lines for speaking practice.

The sidebar polls the active YouTube tab for `get-transcript-state`. To reduce
message size, the content script can omit unchanged cue data when the sidebar
sends its last revision. The response includes the cue list, active index,
buffer length, provider, study mode, vocabulary coverage, frequent unknown
words, and repeated phrases. Sidebar cue clicks seek through a content-script
message rather than controlling the tab directly.

## Vocabulary and corrections

Vocabulary records are created in `background.js` so every UI uses the same
validation and limits. An entry contains the French text, English meaning,
sentence pair, video ID/title/time, notes, creation time, and review state.
Saving an edited meaning also stores an exact translation correction.

The review workspace uses four ratings. `background.js` updates the interval,
ease, due date, repetitions, lapses, and last-review time. The vocabulary page
also supports search, video filters, editing, removal, JSON import, CSV export,
Anki-compatible export, and pronunciation.

Known/learning/ignored word states are separate from vocabulary entries. They
drive sidebar coverage and unknown-word filtering.

## OCR and manual translation

Pressing `Alt+Shift+O` sends `start-video-ocr-selection` to the active YouTube
content script. The content script:

1. pauses the video and remembers whether it was playing;
2. displays a crosshair selector constrained to the visible `<video>` bounds;
3. records a viewport-relative rectangle while the user drags;
4. cancels and restores playback on Escape;
5. removes the selection overlay and continues automatically when the pointer
   is released after a valid drag.

After two animation frames, the selected rectangle is sent back as
`complete-video-ocr-selection`. The background script captures the visible tab,
stores the screenshot and rectangle temporarily, and opens a standalone
translator window. `tools/translator.js` scales CSS coordinates to screenshot
pixels, crops to the selection, and immediately runs the bundled French
Tesseract worker and model. Recognized text is placed in the French editor and
translation begins automatically after a short debounce. Stale translation
responses are ignored if the text changes while a request is running.

The screenshot is removed from storage after the popup loads. Tesseract runs
locally; only recognized text is sent to the configured translation provider.
The type-or-paste mode uses the same debounced translation path without OCR.

## Settings and profiles

The toolbar/options page groups controls into General, Appearance, and Tools.
Changes are debounced and written to `browser.storage.sync.settings`. Both
`background.js` and `content.js` merge stored values into defaults so upgrades
can add settings safely. Nested subtitle styles and word-group colors are
merged separately.

Video profiles override the global caption offset and study mode for a specific
YouTube video. They are kept locally and bounded to the most recently updated
profiles.

## Persistent data

| Location/key | Contents |
| --- | --- |
| `storage.sync.settings` | General, appearance, provider choice, and learning options |
| `storage.local.vocabulary` | Vocabulary and spaced-review records |
| `storage.local.wordStatesV1` | Known, learning, and ignored word states |
| `storage.local.translationCorrectionsV1` | Exact source/target corrections |
| `storage.local.videoProfilesV1` | Per-video timing and study mode |
| `storage.local.translationProviderSecretsV1` | Provider keys, region, and LibreTranslate endpoint |
| IndexedDB `dualsub-translation-cache` | Provider translation results |
| `storage.local.lineTranslationCacheV2` | Translation-cache fallback |
| `storage.local.ocrCaptureV1` | One-use screenshot and selected rectangle |

Provider secrets deliberately use local storage, not sync storage. OCR captures
are short-lived. Vocabulary export happens only after an explicit user action.

## Communication contracts

### Page bridge DOM events

The bridge and content script use `dualsub:*` `CustomEvent`s because extension
runtime messaging cannot directly expose page-world JavaScript objects.

| Request | Result or effect |
| --- | --- |
| `dualsub:request-tracks` | `dualsub:tracks` with player track metadata |
| `dualsub:fetch-caption-track` | `dualsub:caption-track-result` |
| `dualsub:request-full-transcript` | `dualsub:full-transcript-result` |
| `dualsub:request-player-caption-url` | `dualsub:player-caption-url-result` |
| `dualsub:enable-native-source` | Enables French and emits a result event |
| `dualsub:enable-native-translation` | Enables YouTube translation and emits a result event |
| `dualsub:restore-native-captions` | Restores the player's previous caption state |
| `dualsub:reset-native-caption-state` | Clears bridge state on navigation |

### Background runtime messages

The background handles caption fetching; single and batch translation;
translation cancellation, health, and cache management; provider secrets;
vocabulary CRUD/review/import; corrections; word states; video profiles;
pronunciation help; translator popup creation; and OCR selection completion.
Responses use `{ ok: true, ... }` or `{ ok: false, error, errorCode? }`.

The content script handles status and transcript queries, seeking, cue
navigation/replay, caption-offset changes, per-video profile saves, and starting
the OCR selection overlay.

When adding a message, keep privileged work in the background, DOM/player work
in the content script, and page-player internals in the bridge.

## Permissions and packaging

- `activeTab` permits user-triggered capture and interaction with the current
  YouTube tab.
- `storage` holds settings, learning data, provider configuration, and cache.
- YouTube and the keyless providers are declared host permissions.
- Azure, DeepL, and arbitrary HTTPS LibreTranslate endpoints are optional host
  permissions requested only when configured.
- The extension CSP permits local scripts, local workers, and bundled WebAssembly
  but not downloaded executable code.

`web-ext-config.cjs` excludes source datasets, tests, scripts, dependencies, and
repository metadata from release archives while retaining generated runtime
resources and their licenses.

## Generated and vendored resources

`npm run vendor:ocr` copies Tesseract, its SIMD LSTM WebAssembly core, and the
French trained model from installed packages into `vendor/tesseract`. It also
removes obsolete dynamic-function fallbacks that violate the extension CSP.

`scripts/build-word-groups.js` converts a local Lexique TSV into compact runtime
JSON for word groups and lexical information. The large source TSV is excluded
from releases. Sources and licenses are recorded beside each vendor resource
and in `THIRD_PARTY_NOTICES.md`.

## Testing and release checks

```powershell
npm run check       # JavaScript syntax
npm test            # parsing, timing, language, storage, and structural smoke tests
npm run lint        # Firefox manifest/package lint
npm run build       # build .web-ext-artifacts/*.zip
npm run verify      # check + test + lint
```

Node 22 or newer is required. Before changing caption parsing, timing, cache
keys, storage schemas, or message names, add a regression to
`tests/smoke.test.js`. Always run Firefox lint because valid JavaScript can still
violate WebExtension manifest or CSP rules.

## Debugging guide

- **No DualSub overlay:** verify a French track exists and that the content
  script was injected after installing/reloading the extension.
- **Live source mode remains active:** inspect authenticated URL recovery and
  transcript-panel results before changing timing code.
- **French is timed correctly but English is missing:** inspect provider health,
  circuit state, buffer count, and the rolling scheduler.
- **A late word joins the wrong cue:** inspect raw JSON3 append flags and retained
  fragments; do not fix it by globally extending cue times.
- **Word matching is wrong:** distinguish precise provider alignment from the
  conservative lexical fallback and check the lookup provenance row.
- **OCR captures the selector:** the overlay must be removed and two animation
  frames must complete before `captureVisibleTab` runs.
- **Old async data appears after navigation:** verify generation/session checks
  exist at the point where the result mutates current state.

The settings action can copy diagnostics containing version, video ID, current
mode, status, cue counts, time, languages, provider, and caption offset. That
snapshot is the best starting point for timing and loading reports.
