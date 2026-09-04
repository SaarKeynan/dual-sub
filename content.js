(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    showSource: true,
    showTranslation: true,
    sourceLanguage: "fr",
    targetLanguage: "en",
    hideNativeCaptions: true,
    selectionTranslation: true,
    wholeLiveLines: true,
    preloadVideoWords: true,
    hoverLookup: true,
    wordAlignment: true,
    colorFrenchWordGroups: false,
    wordGroupPaletteVersion: 2,
    wordGroupColors: {
      unknown: "#ffffff",
      noun: "#60a5fa",
      verb: "#a78bfa",
      adjective: "#fb7185",
      adverb: "#facc15",
      pronoun: "#22d3ee",
      determiner: "#4ade80",
      preposition: "#fb923c",
      conjunction: "#f472b6",
      interjection: "#94a3b8"
    },
    pauseOnLookup: false,
    recallMode: false,
    autoPause: false,
    studyMode: "watch",
    captionHoldMs: 350,
    smartPauseUnknownOnly: true,
    skipCaptionGaps: false,
    translationBufferSeconds: 90,
    translationBatchSize: 30,
    lookupCardPosition: "smart",
    hoverDelay: 420,
    pronunciationVoiceURI: "",
    pronunciationRate: 0.88,
    captionOffsetMs: 0,
    translationProvider: "google",
    bottomOffset: 72,
    maxWidth: 88,
    sourceStyle: {
      fontSize: 30,
      textColor: "#ffffff",
      backgroundColor: "#111827",
      backgroundOpacity: 82,
      fontFamily: "Arial, sans-serif",
      fontWeight: "700",
      italic: false
    },
    targetStyle: {
      fontSize: 25,
      textColor: "#fde68a",
      backgroundColor: "#111827",
      backgroundOpacity: 82,
      fontFamily: "Arial, sans-serif",
      fontWeight: "600",
      italic: false
    }
  };

  let settings = DEFAULT_SETTINGS;
  let root;
  let sourceLine;
  let targetLine;
  let statusNode;
  let statusTextNode;
  let statusCloseNode;
  const dismissedStatusKeys = new Set();
  let selectionCard;
  let video;
  let ocrSelectionSession = null;
  let ocrPopup = null;
  let animationFrame;
  let videoFrameCallbackId;
  const observedVideos = new WeakSet();
  let sourceCues = [];
  let targetCues = [];
  let currentVideoId = "";
  let sourceTrackState = "unknown";
  let currentSourceText = "";
  let currentTargetText = "";
  let currentSourceCue = null;
  let currentTargetCue = null;
  let currentSourceCueIndex = -1;
  let currentVideoTitle = "";
  let alignedTargetCues = [];
  let loadGeneration = 0;
  let usingNativeTranslation = false;
  let usingNativeSource = false;
  let nativeSourceTrack = null;
  let nativeSourceActivatedAt = 0;
  let nativeTranslationActivatedAt = 0;
  let nativeTextBeforeFallback = "";
  let cachedNativeCaptionText = "";
  let lastNativeCaptionReadAt = 0;
  let nativeFallbackTimer;
  let liveSourceText = "";
  let liveTargetText = "";
  let liveTranslationSequence = 0;
  let liveTranslationRequestText = "";
  let liveTranslationPrefetchTimer;
  let observedNativeText = "";
  let pendingLiveSourceText = "";
  let pendingLiveTimer;
  let liveClearTimer;
  let status = { state: "waiting", message: "Waiting for a YouTube video." };
  let statusTimer;
  let pageCaptionRequestId = 0;
  const pendingPageCaptionRequests = new Map();
  const captionPayloadCache = new Map();
  let transcriptRequestId = 0;
  const pendingTranscriptRequests = new Map();
  let playerCaptionUrlRequestId = 0;
  const pendingPlayerCaptionUrlRequests = new Map();
  let captionRecoveryGeneration = 0;
  let timedTrackUpgradePending = false;
  let timedTrackRecoveryAttempt = 0;
  let timedTrackRecoveryLastError = "";
  let usingAheadTranslation = false;
  const aheadTranslations = new Map();
  const aheadAlignments = new Map();
  const aheadAlignmentKinds = new Map();
  const aheadTranslationProvenance = new Map();
  const lookupTranslationCache = new Map();
  const lookupTranslationMetadata = new Map();
  const aheadTranslationPending = new Set();
  const aheadTranslationFailed = new Set();
  const aheadTranslationQueue = [];
  let aheadTranslationActive = 0;
  let aheadTranslationGeneration = 0;
  let lastAheadPrefetchAt = 0;
  let aheadTranslationFocusIndex = -1;
  let aheadTranslationSessionId = "";
  let aheadTranslationBlockedUntil = 0;
  let aheadTranslationLastError = "";
  let aheadTranslationRetryTimer;
  let wordWarmupGeneration = 0;
  let wordWarmupTimer;
  let wordWarmupQueued = 0;
  let wordWarmupCompleted = 0;
  let wordWarmupFailed = 0;
  let hoverLookupTimer;
  let hoverPrefetchTimer;
  let lookupSequence = 0;
  let lookupContext = null;
  let lookupDismissTimer;
  let lookupPinned = false;
  let phraseSelectionAnchor = null;
  let pausedByLookup = false;
  let loopCueRange = null;
  let playbackRateBeforeSlow = 1;
  let lastPlaybackCueIndex = -1;
  let lastSkippedGapIndex = -1;
  let wordStatesCache = {};
  let wordStatesRevision = 0;
  let transcriptRevision = 0;
  let transcriptSourceRevision = 0;
  let transcriptSourceReference = null;
  let transcriptTargetReference = null;
  let transcriptTranslationCount = -1;
  let transcriptAnalysisCache = null;
  let currentVideoProfile = null;

  function mergeSettings(value = {}) {
    const wordGroupColors = { ...DEFAULT_SETTINGS.wordGroupColors, ...(value.wordGroupColors || {}) };
    if (!value.wordGroupPaletteVersion && wordGroupColors.verb === "#fb7185" && wordGroupColors.adjective === "#c084fc") {
      wordGroupColors.verb = DEFAULT_SETTINGS.wordGroupColors.verb;
      wordGroupColors.adjective = DEFAULT_SETTINGS.wordGroupColors.adjective;
    }
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      studyMode: ["watch", "study", "shadow"].includes(value.studyMode) ? value.studyMode : "watch",
      wordGroupPaletteVersion: 2,
      wordGroupColors,
      sourceStyle: { ...DEFAULT_SETTINGS.sourceStyle, ...(value.sourceStyle || {}) },
      targetStyle: { ...DEFAULT_SETTINGS.targetStyle, ...(value.targetStyle || {}) }
    };
  }

  function effectiveStudyMode() {
    const mode = currentVideoProfile?.studyMode || settings.studyMode || "watch";
    return ["study", "shadow"].includes(mode) ? mode : "watch";
  }

  function effectiveCaptionOffsetMs() {
    return Number(currentVideoProfile?.captionOffsetMs ?? settings.captionOffsetMs ?? 0);
  }

  function hexToRgba(hex, opacity) {
    const normalized = String(hex || "#000000").replace("#", "");
    const full = normalized.length === 3
      ? normalized.split("").map((character) => character + character).join("")
      : normalized.padEnd(6, "0").slice(0, 6);
    const red = parseInt(full.slice(0, 2), 16);
    const green = parseInt(full.slice(2, 4), 16);
    const blue = parseInt(full.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(100, opacity)) / 100})`;
  }

  function applyLineStyle(line, style) {
    line.style.fontSize = `${style.fontSize}px`;
    line.style.color = style.textColor;
    line.style.backgroundColor = hexToRgba(style.backgroundColor, style.backgroundOpacity);
    line.style.fontFamily = style.fontFamily;
    line.style.fontWeight = style.fontWeight;
    line.style.fontStyle = style.italic ? "italic" : "normal";
  }

  function applySettings() {
    const onWatchPage = settings.enabled && location.pathname === "/watch";
    const active = onWatchPage && sourceTrackState !== "unavailable";
    const sourceTrackConfirmed = onWatchPage && sourceTrackState === "available";
    document.documentElement.classList.toggle(
      "dualsub-enabled",
      sourceTrackConfirmed && settings.hideNativeCaptions
    );
    document.documentElement.classList.toggle(
      "dualsub-native-fallback",
      sourceTrackConfirmed && (usingNativeTranslation || usingNativeSource)
    );
    if (!root) return;
    root.hidden = !active;
    root.style.setProperty("--dualsub-bottom", `${settings.bottomOffset}px`);
    root.style.setProperty("--dualsub-width", `${settings.maxWidth}%`);
    for (const [group, color] of Object.entries(settings.wordGroupColors)) {
      root.style.setProperty(`--dualsub-group-${group}`, color);
    }
    root.classList.toggle("dualsub-recall-mode", Boolean(settings.recallMode));
    root.classList.toggle("dualsub-color-word-groups", Boolean(settings.colorFrenchWordGroups));
    root.dataset.studyMode = effectiveStudyMode();
    applyLineStyle(sourceLine, settings.sourceStyle);
    applyLineStyle(targetLine, settings.targetStyle);

    if (!active) {
      stopRenderScheduler();
      stopVideoWordWarmup();
      loopCueRange = null;
      sourceLine.parentElement.classList.remove("is-visible");
      targetLine.parentElement.classList.remove("is-visible");
      hideSelectionCard();
      if (usingNativeTranslation || usingNativeSource) stopNativeCapture(true);
      if (usingAheadTranslation) stopAheadTranslation();
    } else if (!usingNativeSource && !usingNativeTranslation && !usingAheadTranslation) {
      if (sourceCues.length && !targetCues.length) startAheadTranslation();
      else if (!sourceCues.length && sourceTrackState === "unknown") requestTrackData();
      requestRender();
    }
  }

  function stopRenderScheduler() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    if (videoFrameCallbackId && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(videoFrameCallbackId);
    videoFrameCallbackId = null;
  }

  function scheduleNextRender() {
    if (!settings.enabled || !video || video.paused || video.ended) return;
    if (typeof video.requestVideoFrameCallback === "function") {
      videoFrameCallbackId = video.requestVideoFrameCallback(() => {
        videoFrameCallbackId = null;
        renderLoop();
      });
    } else {
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null;
        renderLoop();
      });
    }
  }

  function requestRender() {
    if (animationFrame || videoFrameCallbackId) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      renderLoop();
    });
  }

  function createOverlay() {
    const player = document.querySelector(".html5-video-player");
    if (!player) return false;

    if (root && root.parentElement !== player) root.remove();
    if (!root || !root.isConnected) {
      root = document.createElement("div");
      root.className = "dualsub-root";
      root.innerHTML = `
        <div class="dualsub-stack">
          <div class="dualsub-status" role="status" aria-live="polite">
            <span class="dualsub-status-text"></span>
            <button class="dualsub-status-close" type="button" aria-label="Dismiss message" title="Dismiss"></button>
          </div>
          <div class="dualsub-line dualsub-source"><span class="dualsub-line-text"></span></div>
          <div class="dualsub-line dualsub-target"><span class="dualsub-line-text"></span></div>
        </div>
        <div class="dualsub-selection-card" role="dialog" aria-live="polite" aria-label="Subtitle lookup">
          <div class="dualsub-card-heading">
            <div class="dualsub-card-label">French lookup</div>
            <div class="dualsub-card-heading-actions">
              <button class="dualsub-card-pin" type="button" data-action="pin" aria-label="Keep lookup open" title="Keep open">Pin</button>
              <button class="dualsub-card-close" type="button" data-action="close" aria-label="Close lookup">&times;</button>
            </div>
          </div>
          <div class="dualsub-card-source"></div>
          <div class="dualsub-card-lexical" hidden>
            <div class="dualsub-card-lexical-info"></div>
          </div>
          <div class="dualsub-card-translation" data-group="unknown">
            <div class="dualsub-card-group" hidden></div>
            <div class="dualsub-card-result"></div>
            <div class="dualsub-card-infinitive" hidden></div>
          </div>
          <div class="dualsub-card-provenance" hidden><span></span><a target="_blank" rel="noopener noreferrer">Open engine lookup &nearr;</a></div>
          <form class="dualsub-correction-form" hidden>
            <label>Preferred English meaning<input class="dualsub-correction-input" type="text" maxlength="300" autocomplete="off"></label>
            <div><button type="submit" data-action="save-correction">Save correction</button><button type="button" data-action="cancel-correction">Cancel</button></div>
          </form>
          <div class="dualsub-card-context">
            <div class="dualsub-card-label">In this line</div>
            <div class="dualsub-card-sentence-source"></div>
            <div class="dualsub-card-sentence-target"></div>
          </div>
          <div class="dualsub-card-actions">
            <div class="dualsub-action-group dualsub-action-navigation">
              <button type="button" data-action="previous" title="Previous French word" aria-label="Previous French word">←</button>
              <button type="button" data-action="next" title="Next French word" aria-label="Next French word">→</button>
            </div>
            <div class="dualsub-action-group dualsub-action-primary">
              <button type="button" data-action="speak">Pronounce</button>
              <button type="button" data-action="save">+ Vocabulary</button>
              <button type="button" data-action="phrase">Select phrase</button>
            </div>
            <div class="dualsub-action-group dualsub-action-secondary">
              <button type="button" data-action="copy">Copy</button>
              <button type="button" data-action="correct">Correct meaning</button>
              <button type="button" data-action="replay">Replay</button>
              <button type="button" data-action="slow">Slow replay</button>
              <button type="button" data-action="loop">Loop line</button>
            </div>
          </div>
          <div class="dualsub-card-links">
            <a class="dualsub-card-link" target="_blank" rel="noopener noreferrer">Google Translate &nearr;</a>
            <a class="dualsub-card-wiktionary" target="_blank" rel="noopener noreferrer">Wiktionary &nearr;</a>
          </div>
        </div>`;
      player.appendChild(root);
      sourceLine = root.querySelector(".dualsub-source .dualsub-line-text");
      targetLine = root.querySelector(".dualsub-target .dualsub-line-text");
      statusNode = root.querySelector(".dualsub-status");
      statusTextNode = root.querySelector(".dualsub-status-text");
      statusCloseNode = root.querySelector(".dualsub-status-close");
      const dismissStatus = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const displayedStatusKey = statusNode.dataset.statusKey || `${statusNode.dataset.state}|${statusTextNode.textContent}`;
        dismissedStatusKeys.add(displayedStatusKey);
        statusNode.classList.remove("is-visible");
      };
      // Dismiss on the initial press so YouTube cannot consume the later click.
      // Keep click for keyboard activation and non-pointer input.
      statusCloseNode.addEventListener("pointerdown", dismissStatus);
      statusCloseNode.addEventListener("click", dismissStatus);
      selectionCard = root.querySelector(".dualsub-selection-card");
      selectionCard.querySelector(".dualsub-correction-form").addEventListener("submit", (event) => {
        event.preventDefault();
        selectionCard.querySelector('[data-action="save-correction"]').click();
      });
      selectionCard.addEventListener("pointerenter", cancelLookupDismiss);
      selectionCard.addEventListener("pointerleave", () => scheduleLookupDismiss(180));
      sourceLine.addEventListener("pointerleave", () => {
        if (selectionCard.classList.contains("is-visible")) scheduleLookupDismiss(650);
      });
      root.addEventListener("mouseup", handleSubtitleSelection);
      root.addEventListener("pointerover", handleWordPointerOver);
      root.addEventListener("pointerout", handleWordPointerOut);
      root.addEventListener("click", handleLearningCardAction);
      root.addEventListener("keydown", handleLearningKeydown);
      applySettings();
    }
    return true;
  }

  function setStatus(state, message, visibleForMs = 0) {
    const statusKey = `${state}|${message}`;
    status = { state, message };
    if (!statusNode) return;
    clearTimeout(statusTimer);
    statusTextNode.textContent = message;
    statusNode.dataset.state = state;
    statusNode.dataset.statusKey = statusKey;
    statusNode.classList.toggle("is-visible", Boolean(message) && settings.enabled && !dismissedStatusKeys.has(statusKey));
    if (visibleForMs) {
      statusTimer = setTimeout(() => statusNode?.classList.remove("is-visible"), visibleForMs);
    }
  }

  function requestTrackData() {
    if (!settings.enabled || location.pathname !== "/watch" || sourceTrackState === "unavailable") return;
    window.dispatchEvent(new CustomEvent("dualsub:request-tracks"));
  }

  function languageMatches(code, wanted) {
    const normalizedCode = String(code || "").toLowerCase();
    const normalizedWanted = String(wanted || "").toLowerCase();
    return normalizedCode === normalizedWanted || normalizedCode.startsWith(`${normalizedWanted}-`);
  }

  function chooseTrack(tracks, language) {
    const candidates = tracks.filter((track) => languageMatches(track.languageCode, language));
    return candidates.find((track) => track.kind !== "asr") || candidates[0] || null;
  }

  function buildCaptionUrl(baseUrl, translatedLanguage = "", format = "json3") {
    const url = new URL(baseUrl);
    if (format) url.searchParams.set("fmt", format);
    if (translatedLanguage) url.searchParams.set("tlang", translatedLanguage);
    else url.searchParams.delete("tlang");
    return url.toString();
  }

  function joinCaptionParts(parts) {
    let result = "";
    for (const rawPart of parts) {
      const part = String(rawPart || "").replace(/\s+/g, " ").trim();
      if (!part) continue;
      const punctuationStart = /^[,.;:!?%…'’\)\]\}]/u.test(part);
      const joiningEnd = /[-'’\(\[\{]$/u.test(result);
      if (result && !punctuationStart && !joiningEnd) result += " ";
      result += part;
    }
    return result.trim();
  }

  function foldLateCaptionFragments(cues) {
    const folded = [];
    const connectingWords = new Set([
      "a", "an", "the", "to", "of", "on", "in", "for", "with", "at", "from", "about",
      "de", "du", "des", "\u00e0", "au", "aux", "en", "sur", "avec", "pour", "sans", "chez",
      "dans", "par", "que", "qui", "un", "une", "le", "la", "les"
    ]);

    for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
      const cue = cues[cueIndex];
      const previous = folded[folded.length - 1];
      if (!previous) {
        folded.push({ ...cue, fragments: (cue.fragments || [{ start: cue.start, end: cue.end, text: cue.text }]).map((fragment) => ({ ...fragment })) });
        continue;
      }

      const previousWords = previous.text.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) || [];
      const fragmentWords = cue.text.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) || [];
      const lastPreviousWord = (previousWords[previousWords.length - 1] || "").toLocaleLowerCase();
      const previousLooksOpen = !/[.!?\u2026]["'\u2019\u201d)\]]*$/u.test(previous.text);
      const nextCue = cues[cueIndex + 1];
      const followsConnector = connectingWords.has(lastPreviousWord);
      const startsAtPreviousBoundary = Math.abs(cue.start - previous.end) <= 500;
      const immediatelySuperseded = Boolean(
        nextCue &&
        nextCue.start > cue.start &&
        nextCue.start <= cue.end &&
        nextCue.start - cue.start <= 1600
      );

      if (
        previousLooksOpen &&
        previousWords.length >= 4 &&
        previousWords.length + fragmentWords.length <= 16 &&
        fragmentWords.length > 0 && fragmentWords.length <= 3 &&
        followsConnector &&
        startsAtPreviousBoundary &&
        immediatelySuperseded
      ) {
        previous.text = joinCaptionParts([previous.text, cue.text]);
        previous.end = Math.max(previous.end, cue.end);
        previous.fragments.push(...(cue.fragments || [{ start: cue.start, end: cue.end, text: cue.text }]).map((fragment) => ({ ...fragment, folded: true })));
      } else {
        folded.push({ ...cue, fragments: (cue.fragments || [{ start: cue.start, end: cue.end, text: cue.text }]).map((fragment) => ({ ...fragment })) });
      }
    }

    return folded;
  }

  function requestCaptionFromPage(url) {
    return new Promise((resolve, reject) => {
      const id = ++pageCaptionRequestId;
      const timeout = setTimeout(() => {
        pendingPageCaptionRequests.delete(id);
        reject(new Error("YouTube page-context caption request timed out."));
      }, 4500);
      pendingPageCaptionRequests.set(id, { resolve, reject, timeout });
      window.dispatchEvent(new CustomEvent("dualsub:fetch-caption-track", {
        detail: JSON.stringify({ id, url })
      }));
    });
  }

  async function requestCaptionPayload(url) {
    if (captionPayloadCache.has(url)) return captionPayloadCache.get(url);

    const requireCaptionText = (text, origin) => {
      if (String(text || "").trim()) return text;
      throw new Error(`YouTube returned an empty ${origin} response.`);
    };
    const backgroundRequest = browser.runtime.sendMessage({ type: "fetch-captions", url }).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "Could not fetch captions.");
      return requireCaptionText(response.text, "extension-context");
    });
    const request = Promise.any([
      requestCaptionFromPage(url).then((text) => requireCaptionText(text, "page-context")),
      backgroundRequest
    ]).catch((error) => {
      captionPayloadCache.delete(url);
      const messages = Array.from(error?.errors || []).map((item) => item?.message).filter(Boolean);
      throw new Error(messages.join(" ") || error.message || "Could not fetch captions.");
    });
    captionPayloadCache.set(url, request);
    if (captionPayloadCache.size > 32) {
      captionPayloadCache.delete(captionPayloadCache.keys().next().value);
    }
    return request;
  }

  function requestFullTranscript() {
    return new Promise((resolve, reject) => {
      const id = ++transcriptRequestId;
      const timeout = setTimeout(() => {
        pendingTranscriptRequests.delete(id);
        reject(new Error("YouTube full-transcript request timed out."));
      }, 10000);
      pendingTranscriptRequests.set(id, { resolve, reject, timeout });
      window.dispatchEvent(new CustomEvent("dualsub:request-full-transcript", {
        detail: JSON.stringify({ id })
      }));
    });
  }

  function requestPlayerCaptionUrl(language) {
    return new Promise((resolve, reject) => {
      const id = ++playerCaptionUrlRequestId;
      const timeout = setTimeout(() => {
        pendingPlayerCaptionUrlRequests.delete(id);
        reject(new Error("Native player caption URL request timed out."));
      }, 1500);
      pendingPlayerCaptionUrlRequests.set(id, { resolve, reject, timeout });
      window.dispatchEvent(new CustomEvent("dualsub:request-player-caption-url", {
        detail: JSON.stringify({ id, language })
      }));
    });
  }

  function waitFor(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function recoverTracksFromNativePlayer(sourceTrack, initialUrl = "") {
    const recoveryGeneration = ++captionRecoveryGeneration;
    const attemptedAtByUrl = new Map();
    timedTrackUpgradePending = true;
    timedTrackRecoveryAttempt = 0;
    timedTrackRecoveryLastError = "Waiting for YouTube's native timed-caption request.";
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (!usingNativeSource || recoveryGeneration !== captionRecoveryGeneration) return;
      timedTrackRecoveryAttempt = attempt + 1;

      let authenticatedUrl = attempt === 0 ? initialUrl : "";
      if (!authenticatedUrl) {
        await waitFor(attempt ? 500 : 100);
        try {
          authenticatedUrl = await requestPlayerCaptionUrl(sourceTrack.languageCode || settings.sourceLanguage);
        } catch (error) {
          timedTrackRecoveryLastError = error.message || "Caption URL lookup failed.";
          continue;
        }
      }
      if (!authenticatedUrl) {
        timedTrackRecoveryLastError = "YouTube has not exposed its native timed-caption request yet.";
        continue;
      }
      const lastAttemptedAt = attemptedAtByUrl.get(authenticatedUrl) || 0;
      if (Date.now() - lastAttemptedAt < 10000) continue;
      attemptedAtByUrl.set(authenticatedUrl, Date.now());

      const authenticatedTrack = { ...sourceTrack, baseUrl: authenticatedUrl };
      const [sourceResult, targetResult] = await Promise.allSettled([
        loadCaptionCues(authenticatedTrack, "", "French"),
        loadCaptionCues(authenticatedTrack, settings.targetLanguage, "English auto-translation")
      ]);
      if (!usingNativeSource || recoveryGeneration !== captionRecoveryGeneration) return;
      if (sourceResult.status === "rejected") {
        timedTrackRecoveryLastError = sourceResult.reason?.message || "Timed French track request failed.";
        continue;
      }

      sourceCues = sourceResult.value.cues;
      if (targetResult.status === "fulfilled") {
        targetCues = targetResult.value.cues;
        refreshCueAlignment();
        stopNativeCapture(true);
        stopAheadTranslation();
        scheduleVideoWordWarmup();
        setStatus("ready", "French + English ready (authenticated YouTube tracks).", 2600);
        status = { state: "ready", message: "French + English active · full authenticated tracks" };
      } else {
        stopNativeCapture(true);
        startAheadTranslation();
      }
      return;
    }
    if (usingNativeSource && recoveryGeneration === captionRecoveryGeneration) {
      setStatus(
        "loading",
        "Live captions active · precise timed tracks are not available yet; DualSub will keep watching…"
      );
      status = {
        state: "loading",
        message: "Google live fallback · still watching for precise timed tracks"
      };
    }
  }

  function parseCaptionPayload(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("{")) {
      const payload = JSON.parse(trimmed);
      const provisional = [];

      for (const event of payload.events || []) {
        if (!Number.isFinite(Number(event.tStartMs)) || !Array.isArray(event.segs)) continue;
        const start = Number(event.tStartMs);
        const text = joinCaptionParts(event.segs.map((segment) => segment.utf8 || ""))
          .replace(/\u200b/g, "")
          .replace(/\s*\n\s*/g, "\n")
          .trim();
        if (!text) continue;

        const cue = {
          start,
          end: start + Number(event.dDurationMs || 0),
          text,
          fragments: [{ start, end: start + Number(event.dDurationMs || 0), text, append: Boolean(event.aAppend) }]
        };

        // `aAppend` is YouTube's explicit signal that this event extends the
        // preceding caption rather than starting a new one.
        if (event.aAppend && provisional.length) {
          const previous = provisional[provisional.length - 1];
          previous.text = joinCaptionParts([previous.text, cue.text]);
          previous.end = Math.max(previous.end, cue.end);
          previous.fragments.push(...cue.fragments);
        } else {
          provisional.push(cue);
        }
      }

      const folded = foldLateCaptionFragments(provisional);
      return folded.map((cue, index) => ({
        ...cue,
        end: cue.end > cue.start
          ? cue.end
          : (folded[index + 1]?.start || cue.start + 5000)
      }));
    }

    const documentNode = new DOMParser().parseFromString(trimmed, "text/xml");
    const simpleCues = Array.from(documentNode.querySelectorAll("text")).map((node) => {
      const start = Number(node.getAttribute("start") || 0) * 1000;
      const duration = Number(node.getAttribute("dur") || 5) * 1000;
      return { start, end: start + duration, text: node.textContent.trim() };
    }).filter((cue) => cue.text);
    if (simpleCues.length) return foldLateCaptionFragments(simpleCues);

    // YouTube's srv3 format, commonly returned for auto-generated captions,
    // uses <p t="milliseconds" d="milliseconds"><s>…</s></p> rather than
    // the older <text start="seconds"> shape.
    const richCues = Array.from(documentNode.querySelectorAll("p")).map((node) => {
      const start = Number(node.getAttribute("t") || 0);
      const duration = Number(node.getAttribute("d") || 5000);
      return {
        start,
        end: start + duration,
        text: node.textContent.replace(/\s+/g, " ").trim()
      };
    }).filter((cue) => cue.text);
    return foldLateCaptionFragments(richCues);
  }

  async function loadCaptionCues(track, translatedLanguage, label) {
    const attempts = ["json3", "srv1", "srv3", null];
    const attemptedUrls = new Set();
    let lastError;

    const tryFormat = async (format) => {
      const url = buildCaptionUrl(track.baseUrl, translatedLanguage, format);
      if (attemptedUrls.has(url)) throw new Error("Duplicate caption format URL.");
      attemptedUrls.add(url);
      const rawText = await requestCaptionPayload(url);
      const cues = parseCaptionPayload(rawText);
      if (!cues.length) throw new Error("YouTube returned an empty parsed caption track.");
      return { cues, format };
    };

    // JSON is overwhelmingly the common successful path. If it fails, race
    // the legacy serializations instead of waiting for three sequential
    // network timeouts.
    try {
      return await tryFormat(attempts[0]);
    } catch (error) {
      lastError = error;
    }
    try {
      return await Promise.any(attempts.slice(1).map((format) => tryFormat(format)));
    } catch (error) {
      const errors = Array.from(error?.errors || []).filter(Boolean);
      lastError = errors[errors.length - 1] || error || lastError;
    }

    const trackDescription = track.kind === "asr" ? " auto-generated" : "";
    const reason = lastError ? ` ${lastError.message}` : "";
    throw new Error(`YouTube returned no ${label} cues from the${trackDescription} caption track.${reason}`);
  }

  function isNativeCaptionSystemMessage(text, elapsedMs) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (!normalized || elapsedMs >= 9000) return false;
    if (/click\s+(?:for|to open)\s+(?:caption\s+)?settings|cliquez.+param[eè]tres/u.test(normalized)) return true;
    return (
      /(?:french|fran[cç]ais).*(?:auto[ -](?:generated|translated)|g[eé]n[eé]r[eé].*automatiquement|traduction automatique)/u.test(normalized) ||
      /(?:auto[ -](?:generated|translated)|g[eé]n[eé]r[eé].*automatiquement|traduction automatique).*(?:french|fran[cç]ais)/u.test(normalized)
    );
  }

  function readNativeCaptionText() {
    const now = performance.now();
    if (now - lastNativeCaptionReadAt < 50) return cachedNativeCaptionText;
    lastNativeCaptionReadAt = now;
    const segments = Array.from(document.querySelectorAll(
      ".ytp-caption-window-container .ytp-caption-segment"
    ));
    cachedNativeCaptionText = joinCaptionParts(segments.map((segment) => segment.textContent || ""));
    if (isNativeCaptionSystemMessage(cachedNativeCaptionText, performance.now() - nativeSourceActivatedAt)) {
      cachedNativeCaptionText = "";
    }
    return cachedNativeCaptionText;
  }

  function startNativeTranslation(sourceTrack) {
    stopNativeCapture(false);
    usingNativeTranslation = true;
    nativeTranslationActivatedAt = performance.now();
    nativeTextBeforeFallback = readNativeCaptionText();
    targetCues = [];
    document.documentElement.classList.add("dualsub-native-fallback");
    window.dispatchEvent(new CustomEvent("dualsub:enable-native-translation", {
      detail: JSON.stringify({
        sourceLanguage: sourceTrack.languageCode || settings.sourceLanguage,
        sourceKind: sourceTrack.kind || "",
        sourceVssId: sourceTrack.vssId || "",
        targetLanguage: settings.targetLanguage
      })
    }));

    clearTimeout(nativeFallbackTimer);
    nativeFallbackTimer = setTimeout(() => {
      if (usingNativeTranslation && !currentTargetText) {
        setStatus(
          "waiting",
          "Choose Settings → Subtitles → Auto-translate → English once; DualSub will capture that live English line."
        );
      }
    }, 7000);
  }

  function startNativeSourceCapture(sourceTrack) {
    stopNativeCapture(false);
    usingNativeSource = true;
    timedTrackUpgradePending = true;
    timedTrackRecoveryAttempt = 0;
    timedTrackRecoveryLastError = "Starting native timed-track recovery.";
    nativeSourceTrack = sourceTrack;
    nativeSourceActivatedAt = performance.now();
    liveSourceText = "";
    liveTargetText = "";
    liveTranslationRequestText = "";
    observedNativeText = "";
    pendingLiveSourceText = "";
    liveTranslationSequence += 1;
    document.documentElement.classList.add("dualsub-native-fallback");
    window.dispatchEvent(new CustomEvent("dualsub:enable-native-source", {
      detail: JSON.stringify({
        sourceLanguage: sourceTrack.languageCode || settings.sourceLanguage,
        sourceKind: sourceTrack.kind || "",
        sourceVssId: sourceTrack.vssId || ""
      })
    }));
    recoverTracksFromNativePlayer(sourceTrack);

    clearTimeout(nativeFallbackTimer);
    nativeFallbackTimer = setTimeout(() => {
      if (usingNativeSource && !liveSourceText) {
        setStatus(
          "waiting",
          "Choose YouTube Settings → Subtitles → French (auto-generated) once so DualSub can read the live captions."
        );
      }
    }, 5000);
  }

  async function translateLiveSourceCue(text, revealTogether = false) {
    const sequence = ++liveTranslationSequence;
    liveTranslationRequestText = text;
    if (!revealTogether) liveTargetText = "";
    try {
      const response = await browser.runtime.sendMessage({
        type: "translate-selection",
        text,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        context: liveSourceText || text
      });
      if (!usingNativeSource || sequence !== liveTranslationSequence || liveTranslationRequestText !== text) return;
      if (!response?.ok) throw new Error(response?.error || "Translation unavailable");
      if (revealTogether) liveSourceText = text;
      liveTargetText = response.translatedText;
      if (revealTogether && !observedNativeText) scheduleLiveLineClear();
      const providerLabel = {
        azure: "Azure",
        deepl: "DeepL",
        libretranslate: "LibreTranslate",
        mymemory: "MyMemory",
        google: "Google",
        correction: "Your correction"
      }[response.provider] || "Translation provider";
      clearTimeout(nativeFallbackTimer);
      if (timedTrackUpgradePending) {
        setStatus(
          "loading",
          `${providerLabel} live captions active · still loading precise timed tracks…`
        );
        status = {
          state: "loading",
          message: `${providerLabel} live fallback · precise timed tracks still loading`
        };
      } else if (status.state !== "ready") {
        setStatus("ready", `French + English ready (${providerLabel} live fallback).`, 2400);
        status = { state: "ready", message: `French + English active · ${providerLabel} live fallback` };
      }
    } catch (error) {
      if (!usingNativeSource || sequence !== liveTranslationSequence) return;
      if (revealTogether) liveSourceText = text;
      liveTargetText = "Translation unavailable";
      if (revealTogether && !observedNativeText) scheduleLiveLineClear();
      setStatus("error", `Live translation failed: ${error.message}`);
    }
  }

  function commitLiveSourceCue(text) {
    const cleanText = String(text || "").trim();
    if (
      !usingNativeSource ||
      !cleanText ||
      cleanText === liveSourceText ||
      cleanText === liveTranslationRequestText
    ) return;
    clearTimeout(liveClearTimer);
    liveClearTimer = undefined;
    if (settings.wholeLiveLines) {
      // In whole-line mode, reveal both languages only after translation so
      // the learner never sees French update ahead of its English counterpart.
      translateLiveSourceCue(cleanText, true);
    } else {
      liveSourceText = cleanText;
      translateLiveSourceCue(cleanText, false);
    }
  }

  function scheduleLiveLineClear() {
    clearTimeout(liveClearTimer);
    liveClearTimer = setTimeout(() => {
      if (!usingNativeSource || observedNativeText) return;
      liveSourceText = "";
      liveTargetText = "";
      liveTranslationRequestText = "";
      liveTranslationSequence += 1;
    }, 2200);
  }

  function handleObservedNativeSource(nativeSourceText) {
    if (nativeSourceText === observedNativeText) return;
    observedNativeText = nativeSourceText;
    clearTimeout(liveClearTimer);
    liveClearTimer = undefined;

    if (nativeSourceText) {
      if (!settings.wholeLiveLines) {
        clearTimeout(pendingLiveTimer);
        pendingLiveSourceText = "";
        commitLiveSourceCue(nativeSourceText);
        return;
      }

      pendingLiveSourceText = nativeSourceText;
      clearTimeout(liveTranslationPrefetchTimer);
      liveTranslationPrefetchTimer = setTimeout(() => {
        if (!usingNativeSource || pendingLiveSourceText !== nativeSourceText) return;
        browser.runtime.sendMessage({
          type: "translate-selection",
          text: nativeSourceText,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          context: nativeSourceText
        }).catch(() => {});
      }, 90);
      clearTimeout(pendingLiveTimer);
      pendingLiveTimer = setTimeout(() => {
        if (!usingNativeSource || pendingLiveSourceText !== nativeSourceText) return;
        commitLiveSourceCue(nativeSourceText);
        pendingLiveSourceText = "";
      }, 360);
      return;
    }

    // A disappearing native caption is a strong line-boundary signal. Commit
    // its final accumulated text immediately, then leave it visible long enough
    // to read the asynchronous English translation.
    if (settings.wholeLiveLines && pendingLiveSourceText) {
      clearTimeout(pendingLiveTimer);
      commitLiveSourceCue(pendingLiveSourceText);
      pendingLiveSourceText = "";
    }
    if (liveSourceText) {
      scheduleLiveLineClear();
    }
  }

  function stopNativeCapture(restorePlayer = false) {
    captionRecoveryGeneration += 1;
    timedTrackUpgradePending = false;
    if (!usingNativeTranslation && !usingNativeSource) {
      document.documentElement.classList.remove("dualsub-native-fallback");
      if (restorePlayer) window.dispatchEvent(new CustomEvent("dualsub:restore-native-captions"));
      return;
    }
    usingNativeTranslation = false;
    usingNativeSource = false;
    nativeSourceTrack = null;
    nativeSourceActivatedAt = 0;
    nativeTranslationActivatedAt = 0;
    nativeTextBeforeFallback = "";
    liveSourceText = "";
    liveTargetText = "";
    liveTranslationRequestText = "";
    observedNativeText = "";
    pendingLiveSourceText = "";
    liveTranslationSequence += 1;
    clearTimeout(pendingLiveTimer);
    clearTimeout(liveTranslationPrefetchTimer);
    clearTimeout(liveClearTimer);
    clearTimeout(nativeFallbackTimer);
    document.documentElement.classList.remove("dualsub-native-fallback");
    if (restorePlayer) {
      window.dispatchEvent(new CustomEvent("dualsub:restore-native-captions"));
    }
  }

  function useYouTubeNativeCaptions() {
    sourceTrackState = "unavailable";
    loadGeneration += 1;
    stopNativeCapture(true);
    stopAheadTranslation();
    stopVideoWordWarmup();
    sourceCues = [];
    targetCues = [];
    alignedTargetCues = [];
    lastPlaybackCueIndex = -1;
    loopCueRange = null;
    renderCueText("", "");
    hideSelectionCard();
    clearTimeout(statusTimer);
    status = { state: "native-only", message: "YouTube captions active · no French track" };
    if (statusNode) {
      statusNode.classList.remove("is-visible");
      statusTextNode.textContent = "";
    }
    applySettings();
  }

  async function loadTracks(payload) {
    if (!payload.ok) {
      setStatus("waiting", payload.error || "Waiting for captions…");
      return;
    }
    if (!settings.enabled) return;
    if (
      payload.videoId &&
      payload.videoId === currentVideoId &&
      (sourceTrackState === "unavailable" || sourceCues.length || usingNativeSource || usingNativeTranslation || usingAheadTranslation)
    ) return;

    const generation = ++loadGeneration;
    currentVideoId = payload.videoId || "";
    currentVideoProfile = null;
    if (currentVideoId) {
      const profileResponse = await browser.runtime.sendMessage({ type: "get-video-profile", videoId: currentVideoId }).catch(() => null);
      currentVideoProfile = profileResponse?.profile || null;
      applySettings();
    }
    currentVideoTitle = payload.title || document.title.replace(/\s*-\s*YouTube\s*$/i, "");
    sourceCues = [];
    targetCues = [];
    alignedTargetCues = [];
    lastPlaybackCueIndex = -1;
    renderCueText("", "");

    const sourceTrack = chooseTrack(payload.tracks || [], settings.sourceLanguage);
    if (!sourceTrack) {
      useYouTubeNativeCaptions();
      return;
    }

    sourceTrackState = "available";
    applySettings();
    const nativeTargetTrack = chooseTrack(payload.tracks || [], settings.targetLanguage);
    setStatus("loading", "Loading French + English subtitles…");
    try {
      const targetTrack = nativeTargetTrack || sourceTrack;
      const translatedLanguage = nativeTargetTrack ? "" : settings.targetLanguage;
      const [sourceResult, targetResult] = await Promise.allSettled([
        loadCaptionCues(sourceTrack, "", "French"),
        loadCaptionCues(
          targetTrack,
          translatedLanguage,
          nativeTargetTrack ? "English" : "English auto-translation"
        )
      ]);
      if (generation !== loadGeneration) return;

      if (sourceResult.status === "rejected") {
        // Start the live/native path immediately instead of waiting for the
        // transcript-panel request to finish. Besides giving the learner a
        // usable fallback sooner, this prompts YouTube to issue the
        // authenticated caption request needed for complete timed tracks.
        startNativeSourceCapture(sourceTrack);
        setStatus(
          "loading",
          "Live captions active · loading complete timed tracks for better synchronization…"
        );
        status = {
          state: "loading",
          message: "Live fallback active · improving synchronization in the background"
        };
        let transcriptCues;
        try {
          transcriptCues = await requestFullTranscript();
        } catch (_transcriptError) {
          // Native recovery continues in parallel and will upgrade the timing
          // as soon as YouTube exposes its authenticated caption URL.
          return;
        }
        if (generation !== loadGeneration || !usingNativeSource) return;
        stopNativeCapture(true);
        sourceCues = transcriptCues;
        if (targetResult.status === "fulfilled") {
          targetCues = targetResult.value.cues;
          refreshCueAlignment();
          stopAheadTranslation();
          scheduleVideoWordWarmup();
          setStatus("ready", "French transcript + English captions ready.", 2200);
          status = { state: "ready", message: "French + English active · full tracks loaded" };
          return;
        }
        startAheadTranslation();
        return;
      }
      sourceCues = sourceResult.value.cues;

      if (targetResult.status === "rejected" && !nativeTargetTrack) {
        startAheadTranslation();
        return;
      }
      if (targetResult.status === "rejected") throw targetResult.reason;

      stopNativeCapture(true);
      stopAheadTranslation();
      targetCues = targetResult.value.cues;
      refreshCueAlignment();
      scheduleVideoWordWarmup();

      const targetMode = nativeTargetTrack ? "native English track" : "YouTube auto-translation";
      setStatus("ready", `French + English ready (${targetMode}).`, 2200);
      status = {
        state: "ready",
        message: `French + English active · ${sourceCues.length} / ${targetCues.length} cues`
      };
    } catch (error) {
      if (generation !== loadGeneration) return;
      setStatus("error", error.message || "Could not load both subtitle tracks.");
    }
  }

  function cueAt(cues, timeMs) {
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = cues[middle];
      if (cue.start <= timeMs) low = middle + 1;
      else high = middle - 1;
    }

    // Auto-generated cues often overlap. Prefer the most recently started
    // active cue rather than whichever overlap a binary search encounters.
    for (let index = high, inspected = 0; index >= 0 && inspected < 24; index -= 1, inspected += 1) {
      if (timeMs < cues[index].end) return cues[index];
    }
    return null;
  }

  function cueIndexAt(cues, timeMs) {
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const cue = cues[middle];
      if (cue.start <= timeMs) low = middle + 1;
      else high = middle - 1;
    }
    for (let index = high, inspected = 0; index >= 0 && inspected < 24; index -= 1, inspected += 1) {
      if (timeMs < cues[index].end) return index;
    }
    return Math.max(0, Math.min(cues.length - 1, low));
  }

  function refreshCueAlignment() {
    alignedTargetCues = [];
    if (!sourceCues.length || !targetCues.length) return;

    let targetCursor = 0;
    for (const sourceCue of sourceCues) {
      while (
        targetCursor + 1 < targetCues.length &&
        targetCues[targetCursor + 1].end <= sourceCue.start
      ) {
        targetCursor += 1;
      }

      let bestCue = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      const sourceMidpoint = (sourceCue.start + sourceCue.end) / 2;
      for (let index = Math.max(0, targetCursor - 1); index < targetCues.length; index += 1) {
        const targetCue = targetCues[index];
        if (targetCue.start > sourceCue.end + 2500) break;
        const overlap = Math.max(0, Math.min(sourceCue.end, targetCue.end) - Math.max(sourceCue.start, targetCue.start));
        const targetMidpoint = (targetCue.start + targetCue.end) / 2;
        const distance = Math.abs(sourceMidpoint - targetMidpoint);
        const score = overlap * 4 - distance;
        if (score > bestScore) {
          bestScore = score;
          bestCue = targetCue;
          targetCursor = index;
        }
      }
      alignedTargetCues.push(bestCue);
    }
  }

  function stopAheadTranslation() {
    const sessionId = aheadTranslationSessionId;
    usingAheadTranslation = false;
    aheadTranslationGeneration += 1;
    aheadTranslations.clear();
    aheadAlignments.clear();
    aheadAlignmentKinds.clear();
    aheadTranslationProvenance.clear();
    aheadTranslationPending.clear();
    aheadTranslationFailed.clear();
    aheadTranslationQueue.length = 0;
    aheadTranslationActive = 0;
    aheadTranslationFocusIndex = -1;
    aheadTranslationBlockedUntil = 0;
    aheadTranslationLastError = "";
    clearTimeout(aheadTranslationRetryTimer);
    aheadTranslationRetryTimer = null;
    aheadTranslationSessionId = "";
    if (sessionId) browser.runtime.sendMessage({ type: "cancel-translation-session", sessionId }).catch(() => {});
  }

  function translationPrefetchOrder(cues, timeMs, leadMs = 60000, backfillMs = 8000) {
    if (!cues.length) return [];
    let focusIndex = Math.max(0, cueIndexAt(cues, timeMs));
    if (timeMs >= cues[focusIndex].end && cues[focusIndex + 1]) focusIndex += 1;
    const firstIndex = Math.max(0, cueIndexAt(cues, Math.max(0, timeMs - backfillMs)));
    let lastIndex = focusIndex;
    while (lastIndex + 1 < cues.length && cues[lastIndex + 1].start <= timeMs + leadMs) {
      lastIndex += 1;
    }

    const order = [focusIndex];
    for (let index = firstIndex; index < focusIndex; index += 1) order.push(index);
    for (let index = focusIndex + 1; index <= lastIndex; index += 1) order.push(index);
    return order;
  }

  function videoWordWarmupOrder(cues, timeMs, limit = 36) {
    const words = new Map();
    for (const cue of cues || []) {
      const distance = Math.abs(((Number(cue.start) + Number(cue.end)) / 2 || 0) - timeMs);
      const tokens = String(cue.text || "").match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) || [];
      for (const token of tokens) {
        const surface = token.normalize("NFC").toLocaleLowerCase("fr");
        if (!surface || surface.length > 40) continue;
        const current = words.get(surface) || { text: surface, count: 0, nearestDistance: Number.POSITIVE_INFINITY };
        current.count += 1;
        current.nearestDistance = Math.min(current.nearestDistance, distance);
        words.set(surface, current);
      }
    }
    return Array.from(words.values())
      .sort((left, right) =>
        right.count - left.count || left.nearestDistance - right.nearestDistance || left.text.localeCompare(right.text, "fr")
      )
      .slice(0, Math.max(0, limit))
      .map((entry) => entry.text);
  }

  function learningTokens(text) {
    return (String(text || "").match(/[\p{L}]+(?:['\u2019][\p{L}]+)*/gu) || [])
      .map((word) => word.normalize("NFC").toLocaleLowerCase("fr"))
      .filter((word) => word.length > 1);
  }

  async function buildTranscriptState(request = {}) {
    const sourceChanged = transcriptSourceReference !== sourceCues;
    const targetChanged = transcriptTargetReference !== targetCues;
    const translationCountChanged = transcriptTranslationCount !== aheadTranslations.size;
    if (sourceChanged || targetChanged || translationCountChanged) {
      transcriptRevision += 1;
      if (sourceChanged) transcriptSourceRevision += 1;
      transcriptSourceReference = sourceCues;
      transcriptTargetReference = targetCues;
      transcriptTranslationCount = aheadTranslations.size;
    }
    const analysisKey = `${transcriptSourceRevision}:${wordStatesRevision}`;
    if (!transcriptAnalysisCache || transcriptAnalysisCache.key !== analysisKey) {
      const wordStates = wordStatesCache;
      const counts = new Map();
      const phraseCounts = new Map();
      sourceCues.forEach((cue) => {
        const tokens = learningTokens(cue.text);
        tokens.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
        for (const length of [2, 3]) {
          for (let index = 0; index <= tokens.length - length; index += 1) {
            const phrase = tokens.slice(index, index + length).join(" ");
            phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1);
          }
        }
      });
      const vocabulary = Array.from(counts, ([word, count]) => ({
        word,
        count,
        state: wordStates[word]?.state || "unknown"
      })).sort((left, right) => right.count - left.count || left.word.localeCompare(right.word, "fr"));
      const considered = vocabulary.filter((item) => item.state !== "ignored");
      const knownOccurrences = considered.reduce((total, item) => total + (["known", "learning"].includes(item.state) ? item.count : 0), 0);
      const totalOccurrences = considered.reduce((total, item) => total + item.count, 0);
      transcriptAnalysisCache = {
        key: analysisKey,
        vocabulary,
        coveragePercent: totalOccurrences ? Math.round(knownOccurrences / totalOccurrences * 100) : 0,
        topUnknown: vocabulary.filter((item) => item.state === "unknown").slice(0, 12),
        topPhrases: Array.from(phraseCounts, ([phrase, count]) => ({ phrase, count }))
          .filter((item) => item.count >= 2)
          .sort((left, right) => right.count - left.count || right.phrase.length - left.phrase.length)
          .slice(0, 10)
      };
    }
    const revision = `${transcriptRevision}:${wordStatesRevision}`;
    return {
      ok: true,
      revision,
      videoId: currentVideoId,
      title: currentVideoTitle,
      status: status.message,
      currentCueIndex: currentSourceCueIndex,
      currentTimeMs: Math.round((video?.currentTime || 0) * 1000),
      bufferAheadSeconds: translationBufferAheadSeconds(),
      provider: settings.translationProvider,
      studyMode: effectiveStudyMode(),
      coveragePercent: transcriptAnalysisCache.coveragePercent,
      topUnknown: transcriptAnalysisCache.topUnknown,
      topPhrases: transcriptAnalysisCache.topPhrases,
      vocabulary: transcriptAnalysisCache.vocabulary,
      cues: request.lastRevision === revision ? null : sourceCues.slice(0, 5000).map((cue, index) => ({
        index,
        start: cue.start,
        end: cue.end,
        text: cue.text,
        translation: aheadTranslations.get(index) || alignedTargetCues[index]?.text || "",
        provenance: aheadTranslationProvenance.get(index) || (alignedTargetCues[index] ? "YouTube track" : ""),
        active: index === currentSourceCueIndex
      }))
    };
  }

  function cueContainsLearningWord(cue) {
    return learningTokens(cue?.text).some((word) => !["known", "ignored"].includes(wordStatesCache[word]?.state));
  }

  function stopVideoWordWarmup() {
    wordWarmupGeneration += 1;
    clearTimeout(wordWarmupTimer);
    wordWarmupTimer = null;
    wordWarmupQueued = 0;
    wordWarmupCompleted = 0;
    wordWarmupFailed = 0;
  }

  function scheduleVideoWordWarmup(delayMs = 1800) {
    stopVideoWordWarmup();
    if (!settings.enabled || !settings.preloadVideoWords || !sourceCues.length || !targetCues.length || usingAheadTranslation) return;
    const generation = wordWarmupGeneration;
    wordWarmupTimer = setTimeout(() => warmVideoWordCache(generation), delayMs);
  }

  async function warmVideoWordCache(generation) {
    if (generation !== wordWarmupGeneration || !settings.preloadVideoWords) return;
    const limit = settings.translationProvider === "mymemory" ? 12 : 36;
    const queue = videoWordWarmupOrder(sourceCues, (video?.currentTime || 0) * 1000, limit);
    wordWarmupQueued = queue.length;
    if (!queue.length) return;
    const response = await browser.runtime.sendMessage({
      type: "translate-batch",
      items: queue.map((word) => ({ text: word, cacheId: `word:${normalizeLookupWord(word)}` })),
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      videoId: currentVideoId,
      sessionId: `warmup-${currentVideoId}-${generation}`
    }).catch((error) => ({ ok: false, error: error.message }));
    if (generation !== wordWarmupGeneration) return;
    if (!response?.ok) {
      wordWarmupFailed = queue.length;
      return;
    }
    response.results.forEach((result, index) => {
      if (!result?.translatedText) return;
      const cacheKey = lookupTranslationKey(queue[index]);
      rememberLookupTranslation(cacheKey, result.translatedText, result);
      wordWarmupCompleted += 1;
    });
  }

  function startAheadTranslation() {
    stopNativeCapture(true);
    stopAheadTranslation();
    usingAheadTranslation = true;
    aheadTranslationSessionId = `video-${currentVideoId}-${aheadTranslationGeneration}-${Date.now()}`;
    lastAheadPrefetchAt = performance.now();
    const timeMs = (video?.currentTime || 0) * 1000;
    prefetchAheadTranslations(timeMs, Number(settings.translationBufferSeconds || 90) * 1000);
    setStatus("loading", "Timed French loaded · preparing English around the current position…");
    status = { state: "loading", message: "Timed French ready · prioritizing English near playback" };
  }

  function prefetchAheadTranslations(timeMs, leadMs = 60000) {
    if (!usingAheadTranslation || !sourceCues.length) return;
    const priorityOrder = translationPrefetchOrder(sourceCues, timeMs, leadMs);
    aheadTranslationFocusIndex = priorityOrder[0] ?? -1;
    for (const index of priorityOrder) {
      if (
        aheadTranslations.has(index) ||
        aheadTranslationPending.has(index) ||
        aheadTranslationFailed.has(index)
      ) continue;
      aheadTranslationPending.add(index);
      aheadTranslationQueue.push(index);
    }
    const priority = new Map(priorityOrder.map((index, rank) => [index, rank]));
    aheadTranslationQueue.sort((left, right) =>
      (priority.get(left) ?? Number.MAX_SAFE_INTEGER) - (priority.get(right) ?? Number.MAX_SAFE_INTEGER)
    );
    if (
      aheadTranslationFocusIndex >= 0 &&
      !aheadTranslations.has(aheadTranslationFocusIndex) &&
      status.state === "ready"
    ) {
      setStatus("loading", "Preparing English around the current position…");
      status = { state: "loading", message: "Preparing English near playback" };
    }
    pumpAheadTranslationQueue();
  }

  function pumpAheadTranslationBatch() {
    const generation = aheadTranslationGeneration;
    if (!usingAheadTranslation || aheadTranslationActive || !aheadTranslationQueue.length) return;
    if (aheadTranslationBlockedUntil > Date.now()) {
      clearTimeout(aheadTranslationRetryTimer);
      aheadTranslationRetryTimer = setTimeout(pumpAheadTranslationBatch, aheadTranslationBlockedUntil - Date.now() + 25);
      return;
    }
    const providerLimit = { mymemory: 2, libretranslate: 10, google: 30, deepl: 50, azure: 100 }[settings.translationProvider] || 30;
    const batchSize = Math.max(1, Math.min(providerLimit, Number(settings.translationBatchSize || 30)));
    const indices = aheadTranslationQueue.splice(0, batchSize).filter((index) => sourceCues[index]);
    if (!indices.length) return;
    let requeued = false;
    aheadTranslationActive = 1;
    browser.runtime.sendMessage({
      type: "translate-batch",
      items: indices.map((index) => ({
        text: sourceCues[index].text,
        start: sourceCues[index].start,
        end: sourceCues[index].end,
        cacheId: `${sourceCues[index].start}:${sourceCues[index].end}:${sourceCues[index].text}`
      })),
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      videoId: currentVideoId,
      context: sourceCues.slice(Math.max(0, indices[0] - 1), Math.min(sourceCues.length, indices[indices.length - 1] + 2)).map((cue) => cue.text).join(" "),
      sessionId: aheadTranslationSessionId
    }).then((response) => {
      if (!usingAheadTranslation || generation !== aheadTranslationGeneration) return;
      if (!response?.ok) {
        const retryable = ["PROVIDER_RATE_LIMITED", "PROVIDER_TEMPORARY_FAILURE", "PROVIDER_CIRCUIT_OPEN"].includes(response?.errorCode);
        aheadTranslationLastError = response?.error || "Translation batch failed.";
        if (retryable) {
          requeued = true;
          aheadTranslationBlockedUntil = Date.now() + Math.max(1500, Number(response.retryAfterMs || 3000));
          indices.reverse().forEach((index) => aheadTranslationQueue.unshift(index));
          setStatus("loading", `${aheadTranslationLastError} French remains available while English waits.`);
        } else {
          indices.forEach((index) => aheadTranslationFailed.add(index));
        }
        return;
      }
      aheadTranslationBlockedUntil = 0;
      aheadTranslationLastError = "";
      indices.forEach((index, resultIndex) => {
        const result = response.results?.[resultIndex];
        if (!result?.translatedText) return;
        aheadTranslations.set(index, result.translatedText);
        aheadAlignments.set(index, result.alignment || []);
        aheadAlignmentKinds.set(index, result.alignmentKind || (result.provider === "azure" && result.alignment?.length ? "character" : "none"));
        aheadTranslationProvenance.set(index, result.provenance || result.provider || "translated");
      });
      if (aheadTranslations.has(aheadTranslationFocusIndex) && status.state !== "ready") {
        setStatus("ready", `English ready here · ${translationBufferAheadSeconds()}s buffered ahead.`, 2200);
        status = { state: "ready", message: "French + English active · buffering ahead" };
      }
    }).catch((error) => {
      if (generation !== aheadTranslationGeneration) return;
      aheadTranslationLastError = error.message || "Translation batch failed.";
      indices.forEach((index) => aheadTranslationFailed.add(index));
    }).finally(() => {
      if (generation !== aheadTranslationGeneration) return;
      aheadTranslationActive = 0;
      if (!requeued) indices.forEach((index) => aheadTranslationPending.delete(index));
      pumpAheadTranslationBatch();
    });
  }

  function translationBufferAheadSeconds(timeMs = (video?.currentTime || 0) * 1000) {
    if (!sourceCues.length) return 0;
    let index = Math.max(0, cueIndexAt(sourceCues, timeMs));
    let bufferedUntil = timeMs;
    while (index < sourceCues.length && aheadTranslations.has(index)) {
      bufferedUntil = Math.max(bufferedUntil, sourceCues[index].end);
      index += 1;
    }
    return Math.max(0, Math.round((bufferedUntil - timeMs) / 1000));
  }

  function pumpAheadTranslationQueue() {
    pumpAheadTranslationBatch();
  }

  const WORD_GROUP_LABELS = Object.freeze({
    noun: "Noun", verb: "Verb", adjective: "Adjective", adverb: "Adverb",
    pronoun: "Pronoun", determiner: "Determiner", preposition: "Preposition",
    conjunction: "Conjunction", interjection: "Interjection", unknown: "Word"
  });

  function splitFrenchElision(value) {
    const match = String(value || "").match(/^((?:qu|[jmtslncd])['’])([\p{L}\p{N}][\p{L}\p{N}-]*)$/iu);
    if (!match) return null;
    return { particle: match[1], base: match[2], compound: match[0] };
  }

  function lookupTextForWord(word) {
    return word?.dataset.lookupWord || word?.dataset.word || word?.textContent || "";
  }

  function tagFrenchWord(word, sentence = currentSourceText) {
    if (!word) return { group: "unknown", alternatives: [] };
    const text = word.dataset.word || word.textContent;
    const particle = word.dataset.elisionParticle === "true"
      ? globalThis.DualSubFrench?.analyzeElisionParticle(text)
      : null;
    if (particle) {
      const nextGroup = word.dataset.elisionNextGroup;
      const group = particle.key === "l" && ["noun", "adjective"].includes(nextGroup)
        ? "determiner"
        : particle.group;
      const alternatives = particle.key === "l"
        ? [group === "determiner" ? "pronoun" : "determiner"]
        : [];
      word.dataset.lookupWord = text;
      word.dataset.wordGroup = group;
      word.dataset.wordGroupAlternatives = alternatives.join(",");
      word.setAttribute("aria-label", `${text}, ${WORD_GROUP_LABELS[group]}: ${particle.expanded}`);
      return { group, alternatives, confidence: "grammar", particle };
    }
    const compound = word.dataset.elisionCompound || "";
    const compoundAnalysis = compound
      ? globalThis.DualSubFrench?.analyzeWord(compound, sentence)
      : null;
    const analysis = compoundAnalysis || globalThis.DualSubFrench?.analyzeWord(text, sentence);
    const classification = globalThis.DualSubFrench?.classifyWord(text, sentence, analysis) || {
      group: analysis?.partOfSpeech === "verb" ? "verb" : "unknown",
      alternatives: []
    };
    word.dataset.lookupWord = compoundAnalysis?.partOfSpeech === "verb" ? compound : text;
    word.dataset.wordGroup = classification.group;
    word.dataset.wordGroupAlternatives = (classification.alternatives || []).join(",");
    word.setAttribute(
      "aria-label",
      `Look up ${text}${classification.group !== "unknown" ? `, ${WORD_GROUP_LABELS[classification.group]}` : ""}`
    );
    return classification;
  }

  function retagCurrentFrenchWords() {
    sourceLine?.querySelectorAll(".dualsub-word").forEach((word) => tagFrenchWord(word));
  }

  function renderTokenizedText(line, text, language) {
    if (line === sourceLine && phraseSelectionAnchor) phraseSelectionAnchor = null;
    const fragment = document.createDocumentFragment();
    let segments;
    try {
      const segmenter = new Intl.Segmenter(language, { granularity: "word" });
      segments = Array.from(segmenter.segment(text), (item) => ({
        text: item.segment,
        isWordLike: item.isWordLike
      }));
    } catch (_error) {
      segments = text.split(/([\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*)/gu).filter(Boolean).map((part) => ({
        text: part,
        isWordLike: /[\p{L}\p{N}]/u.test(part)
      }));
    }

    let wordIndex = 0;
    const appendWord = (displayText, options = {}) => {
      const word = document.createElement("span");
      word.className = "dualsub-word";
      word.dataset.wordIndex = String(wordIndex);
      word.dataset.word = displayText;
      word.textContent = displayText;
      if (options.particle) word.dataset.elisionParticle = "true";
      if (options.compound) word.dataset.elisionCompound = options.compound;
      if (line === sourceLine) {
        word.tabIndex = 0;
        word.setAttribute("role", "button");
      }
      fragment.appendChild(word);
      wordIndex += 1;
      return word;
    };
    for (const segment of segments) {
      if (!segment.isWordLike) {
        fragment.appendChild(document.createTextNode(segment.text));
        continue;
      }
      const elision = line === sourceLine && String(language).toLocaleLowerCase().startsWith("fr")
        ? splitFrenchElision(segment.text)
        : null;
      if (elision) {
        const particleWord = appendWord(elision.particle, { particle: true, compound: elision.compound });
        const baseWord = appendWord(elision.base, { compound: elision.compound });
        const baseClassification = tagFrenchWord(baseWord, text);
        particleWord.dataset.elisionNextGroup = baseClassification.group;
        tagFrenchWord(particleWord, text);
      } else {
        const word = appendWord(segment.text);
        if (line === sourceLine) tagFrenchWord(word, text);
      }
    }
    line.replaceChildren(fragment);
  }

  function renderCueText(sourceText, targetText, sourceCue = null, targetCue = null, sourceIndex = -1) {
    if (!sourceLine || !targetLine) return;
    if (sourceText !== currentSourceText) {
      renderTokenizedText(sourceLine, sourceText, settings.sourceLanguage);
      currentSourceText = sourceText;
    }
    if (targetText !== currentTargetText) {
      renderTokenizedText(targetLine, targetText, settings.targetLanguage);
      currentTargetText = targetText;
    }
    currentSourceCue = sourceCue;
    currentTargetCue = targetCue;
    currentSourceCueIndex = sourceIndex;
    sourceLine.parentElement.classList.toggle(
      "is-visible",
      settings.enabled && settings.showSource && Boolean(sourceText)
    );
    targetLine.parentElement.classList.toggle(
      "is-visible",
      settings.enabled && settings.showTranslation && Boolean(targetText)
    );
  }

  function renderLoop() {
    if (loopCueRange && video && video.currentTime * 1000 >= loopCueRange.end - 45) {
      video.currentTime = Math.max(0, loopCueRange.start / 1000 - 0.08);
      video.play().catch(() => {});
    }
    if (settings.enabled && video && usingNativeSource) {
      const nativeSourceText = readNativeCaptionText();
      handleObservedNativeSource(nativeSourceText);
      renderCueText(liveSourceText, liveTargetText);
    } else if (
      settings.enabled &&
      video &&
      sourceCues.length &&
      (targetCues.length || usingNativeTranslation || usingAheadTranslation)
    ) {
      // Translation is prefetched separately. Keep display timing tied to the
      // media clock, with only the user's explicit synchronization correction.
      const timeMs = video.currentTime * 1000 + effectiveCaptionOffsetMs();
      let sourceIndex = cueIndexAt(sourceCues, timeMs);
      if (
        settings.skipCaptionGaps &&
        !video.paused &&
        sourceCues[sourceIndex]?.start - timeMs > 1500 &&
        lastSkippedGapIndex !== sourceIndex
      ) {
        lastSkippedGapIndex = sourceIndex;
        video.currentTime = Math.max(0, (sourceCues[sourceIndex].start - effectiveCaptionOffsetMs() - 250) / 1000);
        requestRender();
        return;
      }
      if (sourceCues[sourceIndex]?.start <= timeMs) lastSkippedGapIndex = -1;
      if (sourceCues[sourceIndex]?.start > timeMs && sourceIndex > 0) {
        const previousCue = sourceCues[sourceIndex - 1];
        const heldUntil = Math.min(sourceCues[sourceIndex].start, previousCue.end + Math.max(0, Number(settings.captionHoldMs || 0)));
        if (timeMs < heldUntil) sourceIndex -= 1;
      }
      const sourceCue = sourceCues[sourceIndex];
      const nextSourceCue = sourceCues[sourceIndex + 1];
      const sourceCueVisibleUntil = Math.min(nextSourceCue?.start ?? Number.POSITIVE_INFINITY, sourceCue.end + Math.max(0, Number(settings.captionHoldMs || 0)));
      const sourceCueIsActive = sourceCue && timeMs >= sourceCue.start && timeMs < sourceCueVisibleUntil;
      if (
        (settings.autoPause || effectiveStudyMode() === "shadow") &&
        (effectiveStudyMode() === "shadow" || !settings.smartPauseUnknownOnly || cueContainsLearningWord(sourceCue)) &&
        sourceCueIsActive &&
        lastPlaybackCueIndex >= 0 &&
        sourceIndex === lastPlaybackCueIndex + 1 &&
        timeMs - sourceCue.start < 300 &&
        !video.paused
      ) {
        video.pause();
      }
      if (sourceCueIsActive) lastPlaybackCueIndex = sourceIndex;
      let targetCue = sourceCueIsActive ? alignedTargetCues[sourceIndex] : null;
      let targetText = sourceCueIsActive
        ? (targetCue?.text || (targetCues.length ? (cueAt(targetCues, timeMs)?.text || "") : ""))
        : "";
      if (usingAheadTranslation) {
        if (performance.now() - lastAheadPrefetchAt >= 1000) {
          prefetchAheadTranslations(timeMs);
          lastAheadPrefetchAt = performance.now();
        }
        if (sourceCue && timeMs >= sourceCue.start && timeMs < sourceCue.end) {
          targetText = aheadTranslations.get(sourceIndex) || "";
          targetCue = targetText ? { start: sourceCue.start, end: sourceCue.end, text: targetText } : null;
        }
      }
      if (usingNativeTranslation && performance.now() - nativeTranslationActivatedAt > 350) {
        const liveText = readNativeCaptionText();
        // Avoid briefly copying the old French native caption before YouTube
        // switches its renderer to the requested English translation.
        if (liveText && (liveText !== nativeTextBeforeFallback || performance.now() - nativeTranslationActivatedAt > 1800)) {
          targetText = liveText;
          if (status.state !== "ready") {
            clearTimeout(nativeFallbackTimer);
            status = { state: "ready", message: "French + English active · YouTube live translation" };
            setStatus("ready", "French + English ready (YouTube live translation).", 2200);
          }
        }
      }
      renderCueText(sourceCueIsActive ? sourceCue.text : "", targetText, sourceCueIsActive ? sourceCue : null, targetCue, sourceIndex);
    }
    scheduleNextRender();
  }

  function handleSubtitleSelection(event) {
    if (!settings.selectionTranslation || !settings.enabled) return;
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, " ").trim();
    if (!text || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedElement = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
    // Selection translation is intentionally attached to the French row. The
    // English row is already the translation and sending it as French would
    // produce misleading results for learners.
    if (!selectedElement?.closest(".dualsub-source .dualsub-line-text")) return;

    phraseSelectionAnchor = null;
    showSelectionCard(text, event.clientX, event.clientY, "selection");
  }

  function clearWordHighlights() {
    root?.querySelectorAll(".dualsub-word.is-hovered, .dualsub-word.is-aligned, .dualsub-word.is-range-anchor, .dualsub-word.is-range-selected").forEach((word) => {
      word.classList.remove("is-hovered", "is-aligned", "is-range-anchor", "is-range-selected");
    });
  }

  function beginPhraseSelection(word) {
    if (!word?.isConnected) return;
    clearWordHighlights();
    phraseSelectionAnchor = word;
    word.classList.add("is-range-anchor");
    lookupSequence += 1;
    lookupContext = null;
    lookupPinned = false;
    selectionCard?.classList.remove("is-visible");
    root?.classList.remove("dualsub-learning-open");
    setStatus("ready", "Phrase selection · click the final French word.", 3200);
  }

  function completePhraseSelection(word, clientX, clientY) {
    const words = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
    const anchorIndex = words.indexOf(phraseSelectionAnchor);
    const wordIndex = words.indexOf(word);
    if (anchorIndex < 0 || wordIndex < 0) {
      beginPhraseSelection(word);
      return;
    }
    const firstIndex = Math.min(anchorIndex, wordIndex);
    const lastIndex = Math.max(anchorIndex, wordIndex);
    const range = document.createRange();
    range.setStartBefore(words[firstIndex]);
    range.setEndAfter(words[lastIndex]);
    const text = range.toString().replace(/\s+/g, " ").trim();
    clearWordHighlights();
    words.slice(firstIndex, lastIndex + 1).forEach((selectedWord) => selectedWord.classList.add("is-range-selected"));
    phraseSelectionAnchor = null;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    showSelectionCard(text, clientX, clientY, "selection");
  }

  function highlightAlignedWord(sourceWord) {
    clearWordHighlights();
    sourceWord.classList.add("is-hovered");
    applyPreciseProviderAlignment(sourceWord);
  }

  function wordCharacterRange(word, line, text) {
    const words = Array.from(line?.querySelectorAll(".dualsub-word") || []);
    let cursor = 0;
    for (const candidate of words) {
      const surface = candidate.textContent || "";
      const start = String(text || "").indexOf(surface, cursor);
      const safeStart = start >= 0 ? start : cursor;
      const range = { start: safeStart, end: safeStart + Math.max(0, surface.length - 1) };
      if (candidate === word) return range;
      cursor = range.end + 1;
    }
    return null;
  }

  function rangesOverlap(left, right) {
    return left && right && left.start <= right.end && right.start <= left.end;
  }

  function applyPreciseProviderAlignment(sourceWord) {
    if (!settings.wordAlignment || currentSourceCueIndex < 0) return false;
    if (aheadAlignmentKinds.get(currentSourceCueIndex) !== "character") return false;
    const alignment = aheadAlignments.get(currentSourceCueIndex);
    if (!alignment?.length) return false;
    const sourceRange = wordCharacterRange(sourceWord, sourceLine, currentSourceText);
    if (!sourceRange) return false;
    const targetRanges = alignment
      .filter((entry) => rangesOverlap(sourceRange, { start: entry.sourceStart, end: entry.sourceEnd }))
      .map((entry) => ({ start: entry.targetStart, end: entry.targetEnd }));
    if (!targetRanges.length) return false;
    let highlighted = false;
    targetLine.querySelectorAll(".dualsub-word").forEach((targetWord) => {
      const range = wordCharacterRange(targetWord, targetLine, currentTargetText);
      if (targetRanges.some((targetRange) => rangesOverlap(range, targetRange))) {
        targetWord.classList.add("is-aligned");
        highlighted = true;
      }
    });
    return highlighted;
  }

  function normalizeLookupWord(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLocaleLowerCase();
  }

  function rememberLookupTranslation(cacheKey, translatedText, metadata = {}) {
    if (!cacheKey || !translatedText) return;
    lookupTranslationCache.set(cacheKey, translatedText);
    lookupTranslationMetadata.set(cacheKey, {
      provider: metadata.provider || settings.translationProvider,
      provenance: metadata.provenance || "",
      cacheHit: Boolean(metadata.cacheHit)
    });
    if (lookupTranslationCache.size > 1200) {
      const oldestKey = lookupTranslationCache.keys().next().value;
      lookupTranslationCache.delete(oldestKey);
      lookupTranslationMetadata.delete(oldestKey);
    }
  }

  function translationProviderLink(provider, text) {
    const encoded = encodeURIComponent(text);
    if (provider === "google") return `https://translate.google.com/?sl=fr&tl=en&text=${encoded}&op=translate`;
    if (provider === "mymemory") return `https://mymemory.translated.net/en/French/English/${encoded}`;
    if (provider === "deepl") return `https://www.deepl.com/translator#fr/en/${encoded}`;
    if (provider === "azure") return `https://www.bing.com/translator?from=fr&to=en&text=${encoded}`;
    return "";
  }

  function showLookupProvenance(response, sourceText) {
    const node = selectionCard.querySelector(".dualsub-card-provenance");
    const label = node.querySelector("span");
    const link = node.querySelector("a");
    const provider = response?.provider || settings.translationProvider;
    const providerLabel = { google: "Google", mymemory: "MyMemory", azure: "Azure", deepl: "DeepL", libretranslate: "LibreTranslate", correction: "Saved correction" }[provider] || provider;
    if (provider === "correction") {
      label.textContent = "Source: your saved correction";
    } else if (response?.memoryCache) {
      label.textContent = `Source: instant session cache · ${providerLabel}`;
    } else if (response?.cacheHit) {
      label.textContent = `Source: local translation cache · ${providerLabel}`;
    } else {
      label.textContent = `Source: ${response?.provenance || `${providerLabel} engine lookup`}`;
    }
    const href = translationProviderLink(provider, sourceText);
    link.hidden = !href;
    if (href) {
      link.href = href;
      link.textContent = `Open in ${providerLabel} ↗`;
    }
    node.hidden = false;
  }

  function lookupTranslationKey(value) {
    return `${settings.translationProvider}|${settings.sourceLanguage}|${settings.targetLanguage}|${normalizeLookupWord(value)}`;
  }

  function stemEnglishWord(value) {
    const word = normalizeLookupWord(value);
    const irregular = {
      being: "be", doing: "do", does: "do", did: "do", done: "do",
      going: "go", went: "go", gone: "go", having: "have", making: "make",
      taking: "take", coming: "come"
    };
    if (irregular[word]) return irregular[word];
    if (word.length > 6 && word.endsWith("ing")) {
      const stem = word.slice(0, -3);
      return /(.)\1$/.test(stem) ? stem.slice(0, -1) : stem;
    }
    if (word.length > 4 && word.endsWith("ied")) return `${word.slice(0, -3)}y`;
    if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
    if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
    if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
    return word;
  }

  function editDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  function wordSimilarity(left, right) {
    const normalizedLeft = normalizeLookupWord(left);
    const normalizedRight = normalizeLookupWord(right);
    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft === normalizedRight) return 1;
    if (stemEnglishWord(normalizedLeft) === stemEnglishWord(normalizedRight)) return 0.9;
    return 1 - editDistance(normalizedLeft, normalizedRight) / Math.max(normalizedLeft.length, normalizedRight.length);
  }

  function refineAlignedTargetWords(translatedText, alignmentContext = lookupContext) {
    if (!settings.wordAlignment || alignmentContext?.sentence !== currentSourceText) return;
    const hoveredSourceWord = sourceLine?.querySelector(".dualsub-word.is-hovered");
    if (hoveredSourceWord && applyPreciseProviderAlignment(hoveredSourceWord)) return;
    const evidencePhrases = (Array.isArray(translatedText) ? translatedText : [translatedText])
      .map((text) => (String(text || "").match(/[\p{L}\p{N}]+/gu) || []).map(normalizeLookupWord).filter(Boolean))
      .filter((words) => words.length);
    if (!evidencePhrases.length) return;
    const translatedWords = evidencePhrases.flat();
    const targetWords = Array.from(targetLine.querySelectorAll(".dualsub-word"));
    const targetValues = targetWords.map((word) => normalizeLookupWord(word.textContent));
    const estimatedCenter = Number.isFinite(alignmentContext?.alignmentRatio)
      ? alignmentContext.alignmentRatio * targetWords.length - 0.5
      : targetWords.length / 2;
    const matches = [];
    for (const phrase of evidencePhrases) {
      for (let start = 0; start <= targetValues.length - phrase.length; start += 1) {
        if (phrase.every((word, offset) => targetValues[start + offset] === word)) {
          matches.push({
            start,
            length: phrase.length,
            distance: Math.abs(start + (phrase.length - 1) / 2 - estimatedCenter)
          });
        }
      }
    }
    let best = null;
    if (matches.length) {
      matches.sort((left, right) => left.distance - right.distance);
      best = matches[0];
    } else {
      const fuzzyMatches = targetValues.map((targetWord, index) => ({
        start: index,
        length: 1,
        score: Math.max(...translatedWords.map((translatedWord) => wordSimilarity(targetWord, translatedWord))),
        distance: Math.abs(index - estimatedCenter)
      })).filter((match) => match.score >= 0.86);
      fuzzyMatches.sort((left, right) => right.score - left.score || left.distance - right.distance);
      best = fuzzyMatches[0] || null;
    }
    if (!best) return;
    targetWords.forEach((word) => word.classList.remove("is-aligned"));
    for (let index = best.start; index < best.start + best.length; index += 1) {
      targetWords[index]?.classList.add("is-aligned");
    }
  }

  function handleWordPointerOver(event) {
    if (!settings.enabled || (!settings.hoverLookup && effectiveStudyMode() !== "study")) return;
    if (event.altKey) return;
    if (phraseSelectionAnchor || event.buttons) return;
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || word.contains(event.relatedTarget)) return;
    cancelLookupDismiss();
    clearTimeout(hoverLookupTimer);
    clearTimeout(hoverPrefetchTimer);
    highlightAlignedWord(word);
    const rect = word.getBoundingClientRect();
    const sourceWords = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
    const wordIndex = sourceWords.indexOf(word);
    const alignmentContext = {
      sentence: currentSourceText,
      alignmentRatio: wordIndex >= 0 && sourceWords.length ? (wordIndex + 0.5) / sourceWords.length : Number.NaN
    };
    if (word.dataset.elisionParticle !== "true") hoverPrefetchTimer = setTimeout(async () => {
      try {
        const wordText = lookupTextForWord(word);
        const conjugation = globalThis.DualSubFrench?.analyzeWord(wordText, currentSourceText);
        const evidenceTexts = [wordText, conjugation?.pronominalLemma || conjugation?.lemma]
          .filter((text, index, values) => text && values.indexOf(text) === index);
        const results = await Promise.allSettled(evidenceTexts.map((text) => browser.runtime.sendMessage({
          type: "translate-selection", text,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          cacheMode: "word",
          context: currentSourceText
        })));
        const translations = results
          .filter((result) => result.status === "fulfilled" && result.value?.ok)
          .map((result) => result.value.translatedText);
        const surfaceResponse = results[0]?.status === "fulfilled" ? results[0].value : null;
        if (surfaceResponse?.ok) {
          const cacheKey = lookupTranslationKey(wordText);
          rememberLookupTranslation(cacheKey, surfaceResponse.translatedText, surfaceResponse);
        }
        if (translations.length && word.isConnected && word.classList.contains("is-hovered")) {
          refineAlignedTargetWords(translations, alignmentContext);
        }
      } catch (_error) {
        // The lookup card will show a provider error if the hover continues.
      }
    }, 90);
    const delay = Math.max(120, Math.min(1500, Number(settings.hoverDelay) || 420));
    hoverLookupTimer = setTimeout(() => {
      showSelectionCard(lookupTextForWord(word), rect.left + rect.width / 2, rect.bottom, "word");
    }, delay);
  }

  function handleWordPointerOut(event) {
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || word.contains(event.relatedTarget)) return;
    clearTimeout(hoverLookupTimer);
    clearTimeout(hoverPrefetchTimer);
    if (selectionCard?.classList.contains("is-visible")) scheduleLookupDismiss(650);
    else clearWordHighlights();
  }

  function cancelLookupDismiss() {
    clearTimeout(lookupDismissTimer);
  }

  function scheduleLookupDismiss(delay = 300) {
    clearTimeout(lookupDismissTimer);
    lookupDismissTimer = setTimeout(() => {
      if (!lookupPinned && !selectionCard?.matches(":hover") && !sourceLine?.querySelector(".dualsub-word.is-hovered:hover")) {
        hideSelectionCard();
      }
    }, delay);
  }

  function positionSelectionCard(clientX, clientY) {
    const mode = settings.lookupCardPosition || "smart";
    const rootRect = root.getBoundingClientRect();
    selectionCard.style.left = "auto";
    selectionCard.style.right = mode === "top-right" ? "12px" : "auto";
    selectionCard.style.top = "12px";
    if (mode === "top-right") return;
    requestAnimationFrame(() => {
      if (!selectionCard?.classList.contains("is-visible")) return;
      const cardRect = selectionCard.getBoundingClientRect();
      const stackRect = root.querySelector(".dualsub-stack").getBoundingClientRect();
      const anchorX = Number.isFinite(clientX) ? clientX - rootRect.left : rootRect.width / 2;
      let left = anchorX - cardRect.width / 2;
      let top = mode === "cursor" && Number.isFinite(clientY)
        ? clientY - rootRect.top - cardRect.height - 14
        : stackRect.top - rootRect.top - cardRect.height - 14;
      left = Math.max(12, Math.min(rootRect.width - cardRect.width - 12, left));
      top = Math.max(12, Math.min(rootRect.height - cardRect.height - 12, top));
      selectionCard.style.left = `${left}px`;
      selectionCard.style.top = `${top}px`;
    });
  }

  function showElisionParticleCard(word, particle, clientX, clientY) {
    lookupContext = null;
    lookupPinned = false;
    if (pausedByLookup && video?.paused) video.play().catch(() => {});
    pausedByLookup = false;
    const group = word.dataset.wordGroup || particle.group || "unknown";
    selectionCard.classList.add("is-particle-card");
    selectionCard.querySelector(".dualsub-card-provenance").hidden = true;
    selectionCard.querySelector(".dualsub-card-source").textContent = particle.surface;
    const translationNode = selectionCard.querySelector(".dualsub-card-translation");
    translationNode.dataset.group = group;
    const groupNode = selectionCard.querySelector(".dualsub-card-group");
    groupNode.hidden = false;
    groupNode.dataset.group = group;
    groupNode.textContent = WORD_GROUP_LABELS[group] || "Particle";
    selectionCard.querySelector(".dualsub-card-result").textContent = `${particle.expanded} · ${particle.role} · ${particle.meaning}`;
    selectionCard.classList.add("is-visible");
    root.classList.add("dualsub-learning-open");
    cancelLookupDismiss();
    positionSelectionCard(clientX, clientY);
  }

  async function showSelectionCard(text, clientX, clientY, kind = "selection") {
    const cleanText = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleanText) return;
    const sequence = ++lookupSequence;
    const sourceWords = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
    const hoveredWord = sourceLine.querySelector(".dualsub-word.is-hovered");
    const particle = kind === "word" && hoveredWord?.dataset.elisionParticle === "true"
      ? globalThis.DualSubFrench?.analyzeElisionParticle(hoveredWord.dataset.word || hoveredWord.textContent)
      : null;
    if (particle) {
      showElisionParticleCard(hoveredWord, particle, clientX, clientY);
      return;
    }
    selectionCard.classList.remove("is-particle-card");
    const sourceNode = selectionCard.querySelector(".dualsub-card-source");
    const translationNode = selectionCard.querySelector(".dualsub-card-translation");
    const groupNode = selectionCard.querySelector(".dualsub-card-group");
    const resultNode = selectionCard.querySelector(".dualsub-card-result");
    const sentenceSourceNode = selectionCard.querySelector(".dualsub-card-sentence-source");
    const sentenceTargetNode = selectionCard.querySelector(".dualsub-card-sentence-target");
    const lexicalNode = selectionCard.querySelector(".dualsub-card-lexical");
    const lexicalInfoNode = selectionCard.querySelector(".dualsub-card-lexical-info");
    const infinitiveNode = selectionCard.querySelector(".dualsub-card-infinitive");
    const linkNode = selectionCard.querySelector(".dualsub-card-link");
    const wiktionaryNode = selectionCard.querySelector(".dualsub-card-wiktionary");
    const provenanceNode = selectionCard.querySelector(".dualsub-card-provenance");
    const pinButton = selectionCard.querySelector('[data-action="pin"]');
    const saveButton = selectionCard.querySelector('[data-action="save"]');
    const phraseButton = selectionCard.querySelector('[data-action="phrase"]');
    const replayButton = selectionCard.querySelector('[data-action="replay"]');
    const previousButton = selectionCard.querySelector('[data-action="previous"]');
    const nextButton = selectionCard.querySelector('[data-action="next"]');
    const slowButton = selectionCard.querySelector('[data-action="slow"]');
    const loopButton = selectionCard.querySelector('[data-action="loop"]');
    const correctionForm = selectionCard.querySelector(".dualsub-correction-form");
    const sentence = currentSourceText || cleanText;
    const hoveredWordIndex = sourceWords.indexOf(hoveredWord);
    const conjugation = kind === "word" ? globalThis.DualSubFrench?.analyzeWord(cleanText, currentSourceText) : null;
    const lexicalInfo = kind === "word" ? globalThis.DualSubFrench?.lexicalInfo(cleanText) : null;
    const wordGroup = kind === "word"
      ? (hoveredWord
          ? tagFrenchWord(hoveredWord)
          : globalThis.DualSubFrench?.classifyWord(cleanText, currentSourceText, conjugation))
      : null;
    lookupContext = {
      kind,
      sourceText: cleanText,
      translatedText: "",
      sentence,
      sentenceTranslation: currentTargetText || "",
      videoId: currentVideoId,
      videoTitle: currentVideoTitle,
      timeMs: currentSourceCue?.start ?? Math.round((video?.currentTime || 0) * 1000),
      cueEndMs: currentSourceCue?.end ?? null,
      alignmentRatio: hoveredWordIndex >= 0 && sourceWords.length
        ? (hoveredWordIndex + 0.5) / sourceWords.length
        : Number.NaN,
      wordIndex: hoveredWordIndex,
      conjugation
    };
    sourceNode.textContent = cleanText;
    correctionForm.hidden = true;
    translationNode.dataset.group = wordGroup?.group || "unknown";
    groupNode.hidden = !wordGroup;
    groupNode.dataset.group = wordGroup?.group || "unknown";
    groupNode.textContent = wordGroup
      ? [WORD_GROUP_LABELS[wordGroup.group] || "Word", ...(wordGroup.alternatives || []).map((group) => `also ${WORD_GROUP_LABELS[group]?.toLocaleLowerCase() || group}`)].join(" · ")
      : "";
    const lookupCacheKey = lookupTranslationKey(cleanText);
    const cachedLookup = kind === "word" ? lookupTranslationCache.get(lookupCacheKey) : null;
    const cachedMetadata = lookupTranslationMetadata.get(lookupCacheKey) || {};
    provenanceNode.hidden = true;
    resultNode.textContent = cachedLookup || "Translating…";
    sentenceSourceNode.textContent = sentence;
    sentenceTargetNode.textContent = lookupContext.sentenceTranslation || "Translation available on request";
    lexicalNode.hidden = !lexicalInfo;
    lexicalInfoNode.textContent = lexicalInfo
      ? [
          lexicalInfo.pronunciation ? `/${lexicalInfo.pronunciation}/` : "",
          lexicalInfo.gender,
          lexicalInfo.number
        ].filter(Boolean).join(" · ")
      : "";
    const infinitive = conjugation?.partOfSpeech === "verb"
      ? (conjugation.pronominalLemma || conjugation.lemma || "")
      : "";
    infinitiveNode.hidden = !infinitive;
    infinitiveNode.textContent = infinitive ? `Infinitive: ${infinitive}` : "";
    saveButton.disabled = true;
    saveButton.textContent = "+ Vocabulary";
    phraseButton.disabled = kind !== "word" || hoveredWordIndex < 0;
    phraseButton.textContent = kind === "selection" ? "Phrase selected" : "Select phrase";
    replayButton.disabled = !video;
    previousButton.disabled = hoveredWordIndex <= 0;
    nextButton.disabled = hoveredWordIndex < 0 || hoveredWordIndex >= sourceWords.length - 1;
    slowButton.disabled = !video;
    slowButton.textContent = video?.playbackRate <= 0.76 ? "Normal speed" : "0.75× replay";
    loopButton.disabled = !currentSourceCue || usingNativeSource;
    loopButton.textContent = loopCueRange ? "Stop loop" : "Loop line";
    loopButton.classList.toggle("is-active", Boolean(loopCueRange));
    pinButton.textContent = lookupPinned ? "Pinned" : "Pin";
    pinButton.classList.toggle("is-active", lookupPinned);
    linkNode.href = `https://translate.google.com/?sl=${encodeURIComponent(settings.sourceLanguage)}&tl=${encodeURIComponent(settings.targetLanguage)}&text=${encodeURIComponent(cleanText)}&op=translate`;
    const dictionaryWord = conjugation?.pronominalLemma || conjugation?.lemma || cleanText;
    wiktionaryNode.href = `https://fr.wiktionary.org/wiki/${encodeURIComponent(dictionaryWord)}`;
    selectionCard.classList.add("is-visible");
    cancelLookupDismiss();
    root.classList.add("dualsub-learning-open");
    positionSelectionCard(clientX, clientY);

    if (settings.pauseOnLookup && video && !video.paused) {
      video.pause();
      pausedByLookup = true;
    }

    const surfacePromise = cachedLookup ? Promise.resolve({
      ok: true,
      translatedText: cachedLookup,
      ...cachedMetadata,
      cacheHit: true,
      memoryCache: true
    }) : browser.runtime.sendMessage({
        type: "translate-selection",
        text: cleanText,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage,
        cacheMode: kind === "word" ? "word" : "phrase",
        context: sentence
      });
    const lemmaTexts = conjugation?.partOfSpeech === "verb"
      ? [conjugation?.pronominalLemma || conjugation?.lemma]
      .filter((lemma, index, values) => lemma && values.indexOf(lemma) === index)
      .filter((lemma) => normalizeLookupWord(lemma) !== normalizeLookupWord(cleanText))
      .slice(0, 3)
      : [];
    const lemmaPromises = lemmaTexts.map((lemma) => browser.runtime.sendMessage({
      type: "translate-selection",
      text: lemma,
      sourceLanguage: settings.sourceLanguage,
      targetLanguage: settings.targetLanguage,
      cacheMode: "word",
      context: sentence
      }));
    try {
      const response = await surfacePromise;
      if (sequence !== lookupSequence || !selectionCard.classList.contains("is-visible")) return;
      resultNode.textContent = response?.ok ? response.translatedText : (response?.error || "Translation unavailable");
      if (response?.ok && lookupContext) {
        showLookupProvenance(response, cleanText);
        if (kind === "word") {
          rememberLookupTranslation(lookupCacheKey, response.translatedText, response);
        }
        lookupContext.translatedText = response.translatedText;
        saveButton.disabled = false;
        refineAlignedTargetWords(response.translatedText);
        const lemmaResponses = await Promise.allSettled(lemmaPromises);
        if (sequence !== lookupSequence || !selectionCard.classList.contains("is-visible")) return;
        const evidence = [response.translatedText];
        lemmaResponses.forEach((result) => {
          if (result.status === "fulfilled" && result.value?.ok) evidence.push(result.value.translatedText);
        });
        refineAlignedTargetWords(evidence);
      }
    } catch (error) {
      if (sequence !== lookupSequence) return;
      resultNode.textContent = error.message || "Translation unavailable";
    }
  }

  function chooseFrenchVoice(voices, preferredVoiceURI = "") {
    const candidates = Array.from(voices || []).filter((voice) =>
      /^fr(?:[-_]|$)/i.test(voice.lang || "") || /french|fran[cç]ais|france/i.test(voice.name || "")
    );
    return candidates.sort((left, right) => {
      const score = (voice) =>
        (voice.voiceURI === preferredVoiceURI ? 10000 : 0) +
        (/^fr-FR$/i.test(voice.lang || "") ? 500 : 300) +
        (/natural|neural|premium/i.test(voice.name || "") ? 120 : 0) +
        (voice.localService ? 30 : 0) +
        (voice.default ? 10 : 0);
      return score(right) - score(left) || left.name.localeCompare(right.name);
    })[0] || null;
  }

  async function handleLearningCardAction(event) {
    const button = event.target.closest?.("[data-action]");
    if (!button) {
      const word = event.target.closest?.(".dualsub-source .dualsub-word");
      if (word && phraseSelectionAnchor) {
        event.preventDefault();
        completePhraseSelection(word, event.clientX, event.clientY);
      } else if (word && window.getSelection()?.isCollapsed) {
        clearTimeout(hoverLookupTimer);
        highlightAlignedWord(word);
        const rect = word.getBoundingClientRect();
        showSelectionCard(lookupTextForWord(word), rect.left + rect.width / 2, rect.bottom, "word");
      }
      return;
    }
    if (!selectionCard?.contains(button)) return;
    event.preventDefault();
    const action = button.dataset.action;
    if (action === "close") {
      hideSelectionCard();
      return;
    }
    if (!lookupContext) return;

    if (action === "pin") {
      lookupPinned = !lookupPinned;
      button.textContent = lookupPinned ? "Pinned" : "Pin";
      button.classList.toggle("is-active", lookupPinned);
      if (lookupPinned) cancelLookupDismiss();
      else scheduleLookupDismiss(500);
      return;
    }

    if (action === "previous" || action === "next") {
      const words = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
      const nextIndex = lookupContext.wordIndex + (action === "previous" ? -1 : 1);
      const word = words[nextIndex];
      if (!word) return;
      highlightAlignedWord(word);
      const rect = word.getBoundingClientRect();
      showSelectionCard(lookupTextForWord(word), rect.left + rect.width / 2, rect.bottom, "word");
      return;
    }

    if (action === "phrase") {
      const words = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
      const word = words[lookupContext.wordIndex];
      if (word) beginPhraseSelection(word);
      return;
    }

    if (action === "copy") {
      const value = [lookupContext.sourceText, lookupContext.translatedText].filter(Boolean).join(" — ");
      try {
        await navigator.clipboard.writeText(value);
      } catch (_error) {
        const field = document.createElement("textarea");
        field.value = value;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        document.execCommand("copy");
        field.remove();
      }
      button.textContent = "Copied ✓";
      setTimeout(() => {
        if (button.isConnected) button.textContent = "Copy";
      }, 1200);
      return;
    }

    if (action === "correct") {
      const form = selectionCard.querySelector(".dualsub-correction-form");
      const input = form.querySelector(".dualsub-correction-input");
      form.hidden = false;
      input.value = lookupContext.translatedText;
      cancelLookupDismiss();
      input.focus();
      input.select();
      return;
    }

    if (action === "cancel-correction") {
      selectionCard.querySelector(".dualsub-correction-form").hidden = true;
      scheduleLookupDismiss(500);
      return;
    }

    if (action === "save-correction") {
      const form = selectionCard.querySelector(".dualsub-correction-form");
      const corrected = form.querySelector(".dualsub-correction-input").value.trim();
      if (!corrected) return;
      button.disabled = true;
      button.textContent = "Saving…";
      const response = await browser.runtime.sendMessage({
        type: "save-translation-correction",
        sourceText: lookupContext.sourceText,
        translatedText: corrected,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage
      }).catch((error) => ({ ok: false, error: error.message }));
      if (!response?.ok) {
        button.disabled = false;
        button.textContent = "Try again";
        return;
      }
      lookupContext.translatedText = corrected;
      selectionCard.querySelector(".dualsub-card-result").textContent = corrected;
      const correctionMetadata = { provider: "correction", provenance: "Your correction", cacheHit: true };
      rememberLookupTranslation(lookupTranslationKey(lookupContext.sourceText), corrected, correctionMetadata);
      showLookupProvenance(correctionMetadata, lookupContext.sourceText);
      form.hidden = true;
      const correctionButton = selectionCard.querySelector('[data-action="correct"]');
      correctionButton.textContent = "Corrected ✓";
      setTimeout(() => { if (correctionButton.isConnected) correctionButton.textContent = "Correct meaning"; }, 1600);
      button.disabled = false;
      button.textContent = "Save correction";
      return;
    }

    if (action === "replay" && video) {
      video.currentTime = Math.max(0, lookupContext.timeMs / 1000 - 0.35);
      await video.play().catch(() => {});
      pausedByLookup = false;
      return;
    }

    if (action === "slow" && video) {
      if (video.playbackRate <= 0.76) {
        video.playbackRate = Math.max(0.25, playbackRateBeforeSlow || 1);
        button.textContent = "0.75× replay";
      } else {
        playbackRateBeforeSlow = video.playbackRate;
        video.playbackRate = 0.75;
        video.currentTime = Math.max(0, lookupContext.timeMs / 1000 - 0.35);
        await video.play().catch(() => {});
        pausedByLookup = false;
        button.textContent = "Normal speed";
      }
      return;
    }

    if (action === "loop" && video && Number.isFinite(lookupContext.cueEndMs)) {
      if (loopCueRange) {
        loopCueRange = null;
        button.textContent = "Loop line";
        button.classList.remove("is-active");
        setStatus("ready", "Caption loop stopped.", 1200);
      } else {
        loopCueRange = { start: lookupContext.timeMs, end: lookupContext.cueEndMs };
        video.currentTime = Math.max(0, loopCueRange.start / 1000 - 0.15);
        await video.play().catch(() => {});
        pausedByLookup = false;
        button.textContent = "Stop loop";
        button.classList.add("is-active");
        setStatus("ready", "Looping the current French line.", 1400);
      }
      return;
    }

    if (action === "speak") {
      const synthesis = window.speechSynthesis;
      const voice = chooseFrenchVoice(synthesis?.getVoices?.(), settings.pronunciationVoiceURI);
      if (!synthesis || typeof SpeechSynthesisUtterance !== "function" || !voice) {
        button.textContent = "Opening voice setup…";
        browser.runtime.sendMessage({ type: "open-pronunciation-help" }).catch(() => {});
        setTimeout(() => { if (button.isConnected) button.textContent = "Pronounce"; }, 1800);
        return;
      }
      synthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(lookupContext.sourceText);
      utterance.voice = voice;
      utterance.lang = voice.lang || "fr-FR";
      utterance.rate = Math.max(0.6, Math.min(1.2, Number(settings.pronunciationRate) || 0.88));
      synthesis.speak(utterance);
      return;
    }

    if (action === "save") {
      button.disabled = true;
      const response = await browser.runtime.sendMessage({
        type: "add-vocabulary",
        entry: {
          sourceText: lookupContext.sourceText,
          translatedText: lookupContext.translatedText,
          sentence: lookupContext.sentence,
          sentenceTranslation: lookupContext.sentenceTranslation,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          videoId: lookupContext.videoId,
          videoTitle: lookupContext.videoTitle,
          timeMs: lookupContext.timeMs
        }
      }).catch((error) => ({ ok: false, error: error.message }));
      button.textContent = response?.ok ? "Saved ✓" : "Could not save";
      if (!response?.ok) button.disabled = false;
    }
  }

  function hideSelectionCard() {
    lookupSequence += 1;
    lookupContext = null;
    lookupPinned = false;
    phraseSelectionAnchor = null;
    clearTimeout(lookupDismissTimer);
    clearTimeout(hoverLookupTimer);
    clearTimeout(hoverPrefetchTimer);
    clearWordHighlights();
    selectionCard?.classList.remove("is-visible");
    root?.classList.remove("dualsub-learning-open");
    if (pausedByLookup && video?.paused) video.play().catch(() => {});
    pausedByLookup = false;
  }

  function handleLearningKeydown(event) {
    if (event.key === "Escape" && (selectionCard?.classList.contains("is-visible") || phraseSelectionAnchor)) {
      hideSelectionCard();
      return;
    }
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    highlightAlignedWord(word);
    const rect = word.getBoundingClientRect();
    showSelectionCard(lookupTextForWord(word), rect.left + rect.width / 2, rect.bottom, "word");
  }

  function handleNavigation() {
    hideOcrPopup();
    stopNativeCapture(false);
    window.dispatchEvent(new CustomEvent("dualsub:reset-native-caption-state"));
    stopAheadTranslation();
    stopVideoWordWarmup();
    currentVideoId = "";
    currentVideoProfile = null;
    sourceTrackState = "unknown";
    dismissedStatusKeys.clear();
    lastPlaybackCueIndex = -1;
    sourceCues = [];
    targetCues = [];
    alignedTargetCues = [];
    loopCueRange = null;
    loadGeneration += 1;
    renderCueText("", "");
    hideSelectionCard();
    clearTimeout(statusTimer);
    status = { state: "waiting", message: "Checking for French captions" };
    statusNode?.classList.remove("is-visible");
    attachToPlayer();
    applySettings();
    setTimeout(requestTrackData, 350);
    setTimeout(requestTrackData, 1200);
  }

  function handleNavigationStart() {
    // Restore the user's original YouTube caption choice while the old player
    // is still active. The finish handler then forgets that per-video snapshot.
    if (usingNativeTranslation || usingNativeSource) stopNativeCapture(true);
  }

  function attachToPlayer() {
    if (!createOverlay()) return;
    video = document.querySelector(".html5-video-player video");
    if (video && !observedVideos.has(video)) {
      observedVideos.add(video);
      ["play", "pause", "seeking", "seeked", "ratechange", "loadedmetadata"].forEach((eventName) => {
        video.addEventListener(eventName, requestRender, { passive: true });
      });
    }
    requestRender();
  }

  function injectBridge() {
    if (document.getElementById("dualsub-page-bridge")) return;
    const script = document.createElement("script");
    script.id = "dualsub-page-bridge";
    script.src = browser.runtime.getURL("page-bridge.js");
    script.addEventListener("load", () => {
      script.remove();
      requestTrackData();
    });
    (document.head || document.documentElement).appendChild(script);
  }

  window.addEventListener("dualsub:tracks", (event) => {
    try {
      loadTracks(JSON.parse(event.detail));
    } catch (error) {
      setStatus("error", `Could not read YouTube caption data: ${error.message}`);
    }
  });

  window.addEventListener("dualsub:caption-track-result", (event) => {
    let result;
    try {
      result = JSON.parse(event.detail || "{}");
    } catch (_error) {
      return;
    }
    const pending = pendingPageCaptionRequests.get(result.id);
    if (!pending) return;
    pendingPageCaptionRequests.delete(result.id);
    clearTimeout(pending.timeout);
    if (result.ok) pending.resolve(result.text || "");
    else pending.reject(new Error(result.error || "YouTube page-context caption request failed."));
  });

  window.addEventListener("dualsub:full-transcript-result", (event) => {
    let result;
    try {
      result = JSON.parse(event.detail || "{}");
    } catch (_error) {
      return;
    }
    const pending = pendingTranscriptRequests.get(result.id);
    if (!pending) return;
    pendingTranscriptRequests.delete(result.id);
    clearTimeout(pending.timeout);
    if (result.ok && Array.isArray(result.segments)) pending.resolve(result.segments);
    else pending.reject(new Error(result.error || "YouTube full-transcript request failed."));
  });

  window.addEventListener("dualsub:player-caption-url-result", (event) => {
    let result;
    try {
      result = JSON.parse(event.detail || "{}");
    } catch (_error) {
      return;
    }
    const pending = pendingPlayerCaptionUrlRequests.get(result.id);
    if (!pending) return;
    pendingPlayerCaptionUrlRequests.delete(result.id);
    clearTimeout(pending.timeout);
    if (result.ok) pending.resolve(result.url || "");
    else pending.reject(new Error(result.error || "Native player caption URL lookup failed."));
  });

  window.addEventListener("dualsub:authenticated-caption-url", (event) => {
    if (!usingNativeSource || !nativeSourceTrack) return;
    try {
      const result = JSON.parse(event.detail || "{}");
      if (!languageMatches(result.language, nativeSourceTrack.languageCode || settings.sourceLanguage)) return;
      recoverTracksFromNativePlayer(nativeSourceTrack, result.url || "");
    } catch (_error) {
      // The existing recovery loop remains active as a fallback.
    }
  });

  window.addEventListener("dualsub:native-translation-result", (event) => {
    try {
      const result = JSON.parse(event.detail || "{}");
      if (usingNativeTranslation && !result.ok) {
        setStatus(
          "waiting",
          "Open YouTube Settings → Subtitles → Auto-translate → English once; DualSub will capture it."
        );
      }
    } catch (_error) {
      // The seven-second fallback notice will still guide the user.
    }
  });

  window.addEventListener("dualsub:native-source-result", (event) => {
    try {
      const result = JSON.parse(event.detail || "{}");
      if (usingNativeSource && !result.ok) {
        setStatus(
          "waiting",
          "Choose YouTube Settings → Subtitles → French (auto-generated) once; DualSub will translate the live line."
        );
      }
    } catch (_error) {
      // The five-second fallback notice will still guide the user.
    }
  });

  function stopOcrSelection({ resume = false } = {}) {
    const session = ocrSelectionSession;
    if (!session) return;
    ocrSelectionSession = null;
    session.overlay.remove();
    window.removeEventListener("keydown", session.onKeyDown, true);
    window.removeEventListener("resize", session.onResize, true);
    if (resume && session.wasPlaying) session.video.play().catch(() => {});
  }

  function hideOcrPopup() {
    ocrPopup?.remove();
    ocrPopup = null;
  }

  function showOcrPopup() {
    hideOcrPopup();
    const modal = document.createElement("div");
    modal.className = "dualsub-ocr-modal";
    modal.setAttribute("role", "presentation");
    const frame = document.createElement("iframe");
    frame.className = "dualsub-ocr-modal-frame";
    frame.src = browser.runtime.getURL("tools/translator.html?embedded=1#ocr");
    frame.title = "DualSub OCR translation";
    frame.allow = "clipboard-write";
    modal.appendChild(frame);
    modal.addEventListener("pointerdown", (event) => {
      if (event.target === modal) hideOcrPopup();
    });
    (document.fullscreenElement || document.documentElement).appendChild(modal);
    ocrPopup = modal;
    return { ok: true };
  }

  function startOcrSelection() {
    stopOcrSelection({ resume: true });
    const activeVideo = video?.isConnected ? video : document.querySelector("video");
    if (!activeVideo) return { ok: false, error: "No video is visible on this page." };
    const videoRect = activeVideo.getBoundingClientRect();
    const bounds = {
      left: Math.max(0, videoRect.left),
      top: Math.max(0, videoRect.top),
      right: Math.min(window.innerWidth, videoRect.right),
      bottom: Math.min(window.innerHeight, videoRect.bottom)
    };
    if (bounds.right - bounds.left < 8 || bounds.bottom - bounds.top < 8) {
      return { ok: false, error: "The video is not currently visible." };
    }

    const wasPlaying = !activeVideo.paused;
    activeVideo.pause();
    const overlay = document.createElement("div");
    overlay.className = "dualsub-ocr-selector";
    overlay.innerHTML = `
      <div class="dualsub-ocr-video-frame"></div>
      <div class="dualsub-ocr-instructions"><strong>Select French text</strong><span>Drag over text and release to capture · Esc to cancel</span></div>
      <div class="dualsub-ocr-drag-box" hidden></div>`;
    const frame = overlay.querySelector(".dualsub-ocr-video-frame");
    const box = overlay.querySelector(".dualsub-ocr-drag-box");
    Object.assign(frame.style, {
      left: `${bounds.left}px`, top: `${bounds.top}px`,
      width: `${bounds.right - bounds.left}px`, height: `${bounds.bottom - bounds.top}px`
    });
    document.documentElement.appendChild(overlay);

    const session = {
      overlay,
      video: activeVideo,
      wasPlaying,
      bounds,
      start: null,
      selection: null,
      completing: false,
      onKeyDown: null,
      onResize: () => stopOcrSelection({ resume: true })
    };
    ocrSelectionSession = session;
    const point = (event) => ({
      x: Math.max(bounds.left, Math.min(bounds.right, event.clientX)),
      y: Math.max(bounds.top, Math.min(bounds.bottom, event.clientY))
    });
    const renderSelection = (end) => {
      const left = Math.min(session.start.x, end.x);
      const top = Math.min(session.start.y, end.y);
      session.selection = {
        left,
        top,
        width: Math.max(1, Math.abs(end.x - session.start.x)),
        height: Math.max(1, Math.abs(end.y - session.start.y)),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      };
      Object.assign(box.style, {
        left: `${session.selection.left}px`, top: `${session.selection.top}px`,
        width: `${session.selection.width}px`, height: `${session.selection.height}px`
      });
      box.hidden = false;
    };
    const completeOcrSelection = async () => {
      if (session.completing) return;
      if (!session.selection || session.selection.width < 8 || session.selection.height < 8) {
        overlay.querySelector(".dualsub-ocr-instructions span").textContent = "Drag a larger box around the text";
        return;
      }
      session.completing = true;
      const crop = session.selection;
      stopOcrSelection();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const response = await browser.runtime.sendMessage({ type: "complete-video-ocr-selection", crop })
        .catch((error) => ({ ok: false, error: error.message }));
      if (!response?.ok) {
        if (wasPlaying) activeVideo.play().catch(() => {});
        setStatus("error", response?.error || "The selected video text could not be captured.", 4000);
      }
    };
    overlay.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      event.preventDefault();
      overlay.setPointerCapture(event.pointerId);
      session.start = point(event);
      renderSelection(session.start);
    });
    overlay.addEventListener("pointermove", (event) => {
      if (session.start) renderSelection(point(event));
    });
    overlay.addEventListener("pointerup", async (event) => {
      if (!session.start) return;
      renderSelection(point(event));
      session.start = null;
      await completeOcrSelection();
    });
    overlay.addEventListener("pointercancel", () => { session.start = null; });
    session.onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stopOcrSelection({ resume: true });
      }
    };
    window.addEventListener("keydown", session.onKeyDown, true);
    window.addEventListener("resize", session.onResize, true);
    return { ok: true };
  }

  document.addEventListener("yt-navigate-start", handleNavigationStart);
  document.addEventListener("yt-navigate-finish", handleNavigation);
  document.addEventListener("fullscreenchange", () => setTimeout(() => {
    attachToPlayer();
    if (ocrPopup) (document.fullscreenElement || document.documentElement).appendChild(ocrPopup);
  }, 50));
  document.addEventListener("mousedown", (event) => {
    if (phraseSelectionAnchor && !event.target.closest?.(".dualsub-source .dualsub-word")) {
      phraseSelectionAnchor = null;
      clearWordHighlights();
    }
    if (!lookupPinned && selectionCard?.classList.contains("is-visible") && !selectionCard.contains(event.target)) {
      hideSelectionCard();
    }
  }, true);
  window.addEventListener("message", (event) => {
    const frame = ocrPopup?.querySelector(".dualsub-ocr-modal-frame");
    if (event.data?.type === "dualsub:close-ocr-popup" && frame && event.source === frame.contentWindow) {
      hideOcrPopup();
    }
  });

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "get-status") return Promise.resolve(status);
    if (message?.type === "start-video-ocr-selection") return Promise.resolve(startOcrSelection());
    if (message?.type === "show-video-ocr-popup") return Promise.resolve(showOcrPopup());
    if (message?.type === "hide-video-ocr-popup") {
      hideOcrPopup();
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "get-transcript-state") return buildTranscriptState(message);
    if (message?.type === "save-current-video-profile") {
      if (!currentVideoId) return Promise.resolve({ ok: false, error: "Open a video first." });
      const profile = {
        captionOffsetMs: Number(message.profile?.captionOffsetMs ?? settings.captionOffsetMs ?? 0),
        studyMode: message.profile?.studyMode || settings.studyMode || "watch"
      };
      return browser.runtime.sendMessage({ type: "save-video-profile", videoId: currentVideoId, profile }).then((response) => {
        if (response?.ok) {
          currentVideoProfile = response.profile;
          applySettings();
          requestRender();
        }
        return response;
      });
    }
    if (message?.type === "seek-to-cue") {
      const cue = sourceCues[Number(message.index)];
      if (!video || !cue) return Promise.resolve({ ok: false });
      video.currentTime = Math.max(0, cue.start / 1000 - 0.08);
      if (message.play !== false) video.play().catch(() => {});
      requestRender();
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "navigate-cue") {
      const direction = Number(message.direction) < 0 ? -1 : 1;
      const index = Math.max(0, Math.min(sourceCues.length - 1, currentSourceCueIndex + direction));
      const cue = sourceCues[index];
      if (!video || !cue) return Promise.resolve({ ok: false });
      video.currentTime = Math.max(0, cue.start / 1000 - 0.08);
      requestRender();
      return Promise.resolve({ ok: true, index });
    }
    if (message?.type === "adjust-caption-offset") {
      const nextOffset = Math.max(-5000, Math.min(5000, effectiveCaptionOffsetMs() + Number(message.deltaMs || 0)));
      if (currentVideoProfile && currentVideoId) {
        return browser.runtime.sendMessage({
          type: "save-video-profile",
          videoId: currentVideoId,
          profile: { ...currentVideoProfile, captionOffsetMs: nextOffset }
        }).then((response) => {
          if (response?.ok) currentVideoProfile = response.profile;
          requestRender();
          return { ok: Boolean(response?.ok), captionOffsetMs: nextOffset };
        });
      }
      browser.storage.sync.set({ settings: { ...settings, captionOffsetMs: nextOffset } });
      requestRender();
      return Promise.resolve({ ok: true, captionOffsetMs: nextOffset });
    }
    if (message?.type === "get-diagnostics") {
      const mode = usingNativeSource
        ? "live-source"
        : usingNativeTranslation
          ? "live-youtube-translation"
          : usingAheadTranslation
            ? "prefetched-provider-translation"
            : sourceTrackState === "unavailable"
              ? "youtube-native-captions"
              : sourceCues.length && targetCues.length
                ? "full-tracks"
                : "waiting";
      return Promise.resolve({
        ok: true,
        diagnostics: {
          extensionVersion: browser.runtime.getManifest().version,
          videoId: currentVideoId,
          mode,
          status: status.message,
          sourceCueCount: sourceCues.length,
          targetCueCount: targetCues.length,
          rawSourceFragmentCount: sourceCues.reduce((total, cue) => total + (cue.fragments?.length || 1), 0),
          alignedCueCount: alignedTargetCues.filter(Boolean).length,
          currentCueIndex: currentSourceCueIndex,
          currentTimeSeconds: Number((video?.currentTime || 0).toFixed(2)),
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          translationProvider: settings.translationProvider,
          translationBufferAheadSeconds: translationBufferAheadSeconds(),
          translationQueueLength: aheadTranslationQueue.length,
          translationBatchActive: Boolean(aheadTranslationActive),
          translationBlockedUntil: aheadTranslationBlockedUntil || null,
          translationLastError: aheadTranslationLastError,
          currentTranslationProvenance: aheadTranslationProvenance.get(currentSourceCueIndex) || "",
          currentAlignmentSpanCount: aheadAlignments.get(currentSourceCueIndex)?.length || 0,
          currentAlignmentKind: aheadAlignmentKinds.get(currentSourceCueIndex) || "none",
          captionOffsetMs: effectiveCaptionOffsetMs(),
          studyMode: effectiveStudyMode(),
          cueWindow: sourceCues.slice(Math.max(0, currentSourceCueIndex - 3), currentSourceCueIndex + 4).map((cue, offset) => ({
            index: Math.max(0, currentSourceCueIndex - 3) + offset,
            start: cue.start,
            end: cue.end,
            text: String(cue.text || "").slice(0, 200)
          })),
          timedTrackUpgradePending,
          timedTrackRecoveryAttempt,
          timedTrackRecoveryLastError,
          wordWarmupQueued,
          wordWarmupCompleted,
          wordWarmupFailed
        }
      });
    }
    if (message?.type === "replay-current-cue") {
      if (video) {
        const startMs = currentSourceCue?.start ?? Math.max(0, (video.currentTime - 3) * 1000);
        video.currentTime = Math.max(0, startMs / 1000 - 0.35);
        video.play().catch(() => {});
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({ ok: false });
    }
    return undefined;
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.wordStatesV1) {
      wordStatesCache = changes.wordStatesV1.newValue || {};
      wordStatesRevision += 1;
      return;
    }
    if (areaName !== "sync" || !changes.settings) return;
    const previousSource = settings.sourceLanguage;
    const previousTarget = settings.targetLanguage;
    const previousWholeLiveLines = settings.wholeLiveLines;
    const previousTranslationProvider = settings.translationProvider;
    const previousPreloadVideoWords = settings.preloadVideoWords;
    settings = mergeSettings(changes.settings.newValue);
    if (previousSource !== settings.sourceLanguage) sourceTrackState = "unknown";
    if (previousWholeLiveLines !== settings.wholeLiveLines) {
      observedNativeText = "";
      pendingLiveSourceText = "";
      liveTranslationRequestText = "";
      liveTranslationSequence += 1;
      clearTimeout(pendingLiveTimer);
    }
    applySettings();
    if (usingAheadTranslation && previousTranslationProvider !== settings.translationProvider) {
      startAheadTranslation();
    }
    if (previousPreloadVideoWords !== settings.preloadVideoWords || previousTranslationProvider !== settings.translationProvider) {
      if (settings.preloadVideoWords) scheduleVideoWordWarmup();
      else stopVideoWordWarmup();
    }
    if (settings.enabled && (previousSource !== settings.sourceLanguage || previousTarget !== settings.targetLanguage)) {
      currentVideoId = "";
      currentVideoProfile = null;
      requestTrackData();
    }
  });

  browser.storage.sync.get("settings").then((stored) => {
    settings = mergeSettings(stored.settings);
    injectBridge();
    attachToPlayer();
    applySettings();
    if (!animationFrame) renderLoop();
    setTimeout(requestTrackData, 500);
  });
  browser.runtime.sendMessage({ type: "get-word-states" }).then((response) => {
    if (response?.ok) {
      wordStatesCache = response.states || {};
      wordStatesRevision += 1;
    }
  }).catch(() => {});

  globalThis.DualSubFrench?.ready?.then(() => retagCurrentFrenchWords()).catch(() => {});

  const playerObserver = new MutationObserver(() => {
    if (!root?.isConnected || !video?.isConnected) attachToPlayer();
    else if (usingNativeSource || usingNativeTranslation) requestRender();
  });
  playerObserver.observe(document.querySelector("ytd-app") || document.body || document.documentElement, { childList: true, subtree: true });
})();
