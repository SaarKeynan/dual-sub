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
    hoverLookup: true,
    wordAlignment: true,
    pauseOnLookup: false,
    recallMode: false,
    autoPause: false,
    hoverDelay: 420,
    subtitleLeadMs: 500,
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
  let selectionCard;
  let video;
  let animationFrame;
  let sourceCues = [];
  let targetCues = [];
  let currentVideoId = "";
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
  let usingAheadTranslation = false;
  const aheadTranslations = new Map();
  const aheadTranslationPending = new Set();
  const aheadTranslationFailed = new Set();
  const aheadTranslationQueue = [];
  let aheadTranslationActive = 0;
  let aheadTranslationGeneration = 0;
  let lastAheadPrefetchAt = 0;
  let hoverLookupTimer;
  let hoverPrefetchTimer;
  let lookupSequence = 0;
  let lookupContext = null;
  let pausedByLookup = false;
  let lastPlaybackCueIndex = -1;

  function mergeSettings(value = {}) {
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      sourceStyle: { ...DEFAULT_SETTINGS.sourceStyle, ...(value.sourceStyle || {}) },
      targetStyle: { ...DEFAULT_SETTINGS.targetStyle, ...(value.targetStyle || {}) }
    };
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
    if (!root) return;
    const active = settings.enabled && location.pathname === "/watch";
    root.hidden = !active;
    document.documentElement.classList.toggle(
      "dualsub-enabled",
      active && settings.hideNativeCaptions
    );
    document.documentElement.classList.toggle(
      "dualsub-native-fallback",
      active && (usingNativeTranslation || usingNativeSource)
    );
    root.style.setProperty("--dualsub-bottom", `${settings.bottomOffset}px`);
    root.style.setProperty("--dualsub-width", `${settings.maxWidth}%`);
    root.classList.toggle("dualsub-recall-mode", Boolean(settings.recallMode));
    applyLineStyle(sourceLine, settings.sourceStyle);
    applyLineStyle(targetLine, settings.targetStyle);

    if (!active) {
      sourceLine.parentElement.classList.remove("is-visible");
      targetLine.parentElement.classList.remove("is-visible");
      hideSelectionCard();
      if (usingNativeTranslation || usingNativeSource) stopNativeCapture(true);
      if (usingAheadTranslation) stopAheadTranslation();
    } else if (!usingNativeSource && !usingNativeTranslation && !usingAheadTranslation) {
      if (sourceCues.length && !targetCues.length) startAheadTranslation();
      else if (!sourceCues.length) requestTrackData();
    }
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
          <div class="dualsub-line dualsub-source"><span class="dualsub-line-text"></span></div>
          <div class="dualsub-line dualsub-target"><span class="dualsub-line-text"></span></div>
        </div>
        <div class="dualsub-status"></div>
        <div class="dualsub-selection-card" role="dialog" aria-live="polite" aria-label="Subtitle lookup">
          <div class="dualsub-card-heading">
            <div class="dualsub-card-label">French lookup</div>
            <button class="dualsub-card-close" type="button" data-action="close" aria-label="Close lookup">&times;</button>
          </div>
          <div class="dualsub-card-source"></div>
          <div class="dualsub-card-result"></div>
          <div class="dualsub-card-context">
            <div class="dualsub-card-label">In this line</div>
            <div class="dualsub-card-sentence-source"></div>
            <div class="dualsub-card-sentence-target"></div>
          </div>
          <div class="dualsub-card-actions">
            <button type="button" data-action="speak">Pronounce</button>
            <button type="button" data-action="save">+ Vocabulary</button>
            <button type="button" data-action="sentence">Translate line</button>
            <button type="button" data-action="replay">Replay</button>
          </div>
          <a class="dualsub-card-link" target="_blank" rel="noopener noreferrer">Google Translate &nearr;</a>
        </div>`;
      player.appendChild(root);
      sourceLine = root.querySelector(".dualsub-source .dualsub-line-text");
      targetLine = root.querySelector(".dualsub-target .dualsub-line-text");
      statusNode = root.querySelector(".dualsub-status");
      selectionCard = root.querySelector(".dualsub-selection-card");
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
    status = { state, message };
    if (!statusNode) return;
    clearTimeout(statusTimer);
    statusNode.textContent = message;
    statusNode.classList.toggle("is-visible", Boolean(message) && settings.enabled);
    if (visibleForMs) {
      statusTimer = setTimeout(() => statusNode?.classList.remove("is-visible"), visibleForMs);
    }
  }

  function requestTrackData() {
    if (!settings.enabled || location.pathname !== "/watch") return;
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

    for (const cue of cues) {
      const previous = folded[folded.length - 1];
      if (!previous) {
        folded.push({ ...cue });
        continue;
      }

      const previousWords = previous.text.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) || [];
      const fragmentWords = cue.text.match(/[\p{L}\p{N}]+(?:['\u2019][\p{L}\p{N}]+)*/gu) || [];
      const lastPreviousWord = (previousWords[previousWords.length - 1] || "").toLocaleLowerCase();
      const closeInTime = cue.start >= previous.start && cue.start - previous.start <= 7000;
      const previousLooksOpen = !/[.!?\u2026]["'\u2019\u201d)\]]*$/u.test(previous.text);
      const followsConnector = connectingWords.has(lastPreviousWord) && fragmentWords.length <= 4;
      const tinyOverlappingTail = fragmentWords.length <= 2 && previousWords.length >= 6 && cue.start <= previous.end + 1200;

      if (
        closeInTime &&
        previousLooksOpen &&
        previousWords.length >= 3 &&
        previousWords.length + fragmentWords.length <= 16 &&
        fragmentWords.length > 0 &&
        (followsConnector || tinyOverlappingTail)
      ) {
        previous.text = joinCaptionParts([previous.text, cue.text]);
        previous.end = Math.max(previous.end, cue.end);
      } else {
        folded.push({ ...cue });
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

  async function recoverTracksFromNativePlayer(sourceTrack) {
    const recoveryGeneration = ++captionRecoveryGeneration;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!usingNativeSource || recoveryGeneration !== captionRecoveryGeneration) return;
      await waitFor(attempt ? 500 : 150);

      let authenticatedUrl = "";
      try {
        authenticatedUrl = await requestPlayerCaptionUrl(sourceTrack.languageCode || settings.sourceLanguage);
      } catch (_error) {
        continue;
      }
      if (!authenticatedUrl) continue;

      const authenticatedTrack = { ...sourceTrack, baseUrl: authenticatedUrl };
      const [sourceResult, targetResult] = await Promise.allSettled([
        loadCaptionCues(authenticatedTrack, "", "French"),
        loadCaptionCues(authenticatedTrack, settings.targetLanguage, "English auto-translation")
      ]);
      if (!usingNativeSource || recoveryGeneration !== captionRecoveryGeneration) return;
      if (sourceResult.status === "rejected") continue;

      sourceCues = sourceResult.value.cues;
      if (targetResult.status === "fulfilled") {
        targetCues = targetResult.value.cues;
        refreshCueAlignment();
        stopNativeCapture(true);
        stopAheadTranslation();
        setStatus("ready", "French + English ready (authenticated YouTube tracks).", 2600);
        status = { state: "ready", message: "French + English active · full authenticated tracks" };
      } else {
        stopNativeCapture(true);
        startAheadTranslation();
      }
      return;
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
          text
        };

        // YouTube auto-captions frequently emit the final few words as
        // separate `aAppend` events. The complete track is already available,
        // so fold those continuations into their original cue. This lets whole
        // lines appear at the line's start instead of revealing their last
        // words only when the speaker reaches the end.
        if (event.aAppend && provisional.length) {
          const previous = provisional[provisional.length - 1];
          previous.text = joinCaptionParts([previous.text, cue.text]);
          previous.end = Math.max(previous.end, cue.end);
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

  function readNativeCaptionText() {
    const now = performance.now();
    if (now - lastNativeCaptionReadAt < 50) return cachedNativeCaptionText;
    lastNativeCaptionReadAt = now;
    const segments = Array.from(document.querySelectorAll(
      ".ytp-caption-window-container .ytp-caption-segment"
    ));
    cachedNativeCaptionText = joinCaptionParts(segments.map((segment) => segment.textContent || ""));
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
    nativeSourceTrack = sourceTrack;
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
        targetLanguage: settings.targetLanguage
      });
      if (!usingNativeSource || sequence !== liveTranslationSequence || liveTranslationRequestText !== text) return;
      if (!response?.ok) throw new Error(response?.error || "Translation unavailable");
      if (revealTogether) liveSourceText = text;
      liveTargetText = response.translatedText;
      if (revealTogether && !observedNativeText) scheduleLiveLineClear();
      if (status.state !== "ready") {
        const providerLabel = response.provider === "google" ? "Google" : "MyMemory";
        clearTimeout(nativeFallbackTimer);
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
          targetLanguage: settings.targetLanguage
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
    if (!usingNativeTranslation && !usingNativeSource) return;
    usingNativeTranslation = false;
    usingNativeSource = false;
    nativeSourceTrack = null;
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

  async function loadTracks(payload) {
    if (!payload.ok) {
      setStatus("waiting", payload.error || "Waiting for captions…");
      return;
    }
    if (!settings.enabled) return;
    if (
      payload.videoId &&
      payload.videoId === currentVideoId &&
      (sourceCues.length || usingNativeSource || usingNativeTranslation || usingAheadTranslation)
    ) return;

    const generation = ++loadGeneration;
    currentVideoId = payload.videoId || "";
    currentVideoTitle = payload.title || document.title.replace(/\s*-\s*YouTube\s*$/i, "");
    sourceCues = [];
    targetCues = [];
    alignedTargetCues = [];
    lastPlaybackCueIndex = -1;
    renderCueText("", "");

    const sourceTrack = chooseTrack(payload.tracks || [], settings.sourceLanguage);
    if (!sourceTrack) {
      setStatus("error", "This video has no French caption track.");
      return;
    }

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
        try {
          sourceCues = await requestFullTranscript();
        } catch (_transcriptError) {
          startNativeSourceCapture(sourceTrack);
          setStatus(
            "loading",
            "Using live French captions; displayed cues will be translated through the selected engine…"
          );
          status = {
            state: "loading",
            message: "Live fallback · displayed French cues are sent for translation"
          };
          return;
        }
        if (generation !== loadGeneration) return;
        if (targetResult.status === "fulfilled") {
          targetCues = targetResult.value.cues;
          refreshCueAlignment();
          stopAheadTranslation();
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
    usingAheadTranslation = false;
    aheadTranslationGeneration += 1;
    aheadTranslations.clear();
    aheadTranslationPending.clear();
    aheadTranslationFailed.clear();
    aheadTranslationQueue.length = 0;
    aheadTranslationActive = 0;
  }

  function startAheadTranslation() {
    stopNativeCapture(true);
    stopAheadTranslation();
    usingAheadTranslation = true;
    lastAheadPrefetchAt = performance.now();
    const timeMs = (video?.currentTime || 0) * 1000;
    prefetchAheadTranslations(timeMs, 90000);
    setStatus("loading", "Transcript loaded; translating upcoming lines in advance…");
    status = { state: "loading", message: "Full transcript loaded · pre-translating upcoming lines" };
  }

  function prefetchAheadTranslations(timeMs, leadMs = 60000) {
    if (!usingAheadTranslation || !sourceCues.length) return;
    const firstIndex = cueIndexAt(sourceCues, Math.max(0, timeMs - 1000));
    for (let index = firstIndex; index < sourceCues.length; index += 1) {
      if (sourceCues[index].start > timeMs + leadMs) break;
      if (
        aheadTranslations.has(index) ||
        aheadTranslationPending.has(index) ||
        aheadTranslationFailed.has(index)
      ) continue;
      aheadTranslationPending.add(index);
      aheadTranslationQueue.push(index);
    }
    pumpAheadTranslationQueue();
  }

  function pumpAheadTranslationQueue() {
    const generation = aheadTranslationGeneration;
    while (usingAheadTranslation && aheadTranslationActive < 6 && aheadTranslationQueue.length) {
      const index = aheadTranslationQueue.shift();
      const cue = sourceCues[index];
      if (!cue) {
        aheadTranslationPending.delete(index);
        continue;
      }
      aheadTranslationActive += 1;
      browser.runtime.sendMessage({
        type: "translate-selection",
        text: cue.text,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage
      }).then((response) => {
        if (usingAheadTranslation && generation === aheadTranslationGeneration && response?.ok) {
          aheadTranslations.set(index, response.translatedText);
          if (status.state !== "ready" && aheadTranslations.size >= 2) {
            setStatus("ready", "French + English ready (prefetched translation).", 2200);
            status = { state: "ready", message: "French + English active · translations prefetched" };
          }
        } else if (generation === aheadTranslationGeneration) {
          aheadTranslationFailed.add(index);
        }
      }).catch(() => {
        if (generation === aheadTranslationGeneration) aheadTranslationFailed.add(index);
      }).finally(() => {
        if (generation !== aheadTranslationGeneration) return;
        aheadTranslationActive = Math.max(0, aheadTranslationActive - 1);
        aheadTranslationPending.delete(index);
        pumpAheadTranslationQueue();
      });
    }
  }

  function renderTokenizedText(line, text, language) {
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
    for (const segment of segments) {
      if (!segment.isWordLike) {
        fragment.appendChild(document.createTextNode(segment.text));
        continue;
      }
      const word = document.createElement("span");
      word.className = "dualsub-word";
      word.dataset.wordIndex = String(wordIndex);
      word.dataset.word = segment.text;
      word.textContent = segment.text;
      if (line === sourceLine) {
        word.tabIndex = 0;
        word.setAttribute("role", "button");
        word.setAttribute("aria-label", `Look up ${segment.text}`);
      }
      fragment.appendChild(word);
      wordIndex += 1;
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
      const timeMs = video.currentTime * 1000 + Math.max(0, Number(settings.subtitleLeadMs) || 0);
      const sourceIndex = cueIndexAt(sourceCues, timeMs);
      const sourceCue = sourceCues[sourceIndex];
      const sourceCueIsActive = sourceCue && timeMs >= sourceCue.start && timeMs < sourceCue.end;
      if (
        settings.autoPause &&
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
    animationFrame = requestAnimationFrame(renderLoop);
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

    showSelectionCard(text, event.clientX, event.clientY, "selection");
  }

  function clearWordHighlights() {
    root?.querySelectorAll(".dualsub-word.is-hovered, .dualsub-word.is-aligned").forEach((word) => {
      word.classList.remove("is-hovered", "is-aligned");
    });
  }

  function highlightAlignedWord(sourceWord) {
    clearWordHighlights();
    sourceWord.classList.add("is-hovered");
  }

  function normalizeLookupWord(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLocaleLowerCase();
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
    const translatedWords = (String(translatedText || "").match(/[\p{L}\p{N}]+/gu) || [])
      .map(normalizeLookupWord)
      .filter(Boolean);
    if (!translatedWords.length) return;
    const targetWords = Array.from(targetLine.querySelectorAll(".dualsub-word"));
    const targetValues = targetWords.map((word) => normalizeLookupWord(word.textContent));
    const estimatedCenter = Number.isFinite(alignmentContext?.alignmentRatio)
      ? alignmentContext.alignmentRatio * targetWords.length - 0.5
      : targetWords.length / 2;
    const matches = [];
    for (let start = 0; start <= targetValues.length - translatedWords.length; start += 1) {
      if (translatedWords.every((word, offset) => targetValues[start + offset] === word)) {
        matches.push({ start, distance: Math.abs(start + (translatedWords.length - 1) / 2 - estimatedCenter) });
      }
    }
    let best = null;
    if (matches.length) {
      matches.sort((left, right) => left.distance - right.distance);
      best = { ...matches[0], length: translatedWords.length };
    } else {
      const fuzzyMatches = targetValues.map((targetWord, index) => ({
        start: index,
        length: 1,
        score: Math.max(...translatedWords.map((translatedWord) => wordSimilarity(targetWord, translatedWord))),
        distance: Math.abs(index - estimatedCenter)
      })).filter((match) => match.score >= 0.78);
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
    if (!settings.enabled || !settings.hoverLookup) return;
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || word.contains(event.relatedTarget)) return;
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
    hoverPrefetchTimer = setTimeout(async () => {
      try {
        const response = await browser.runtime.sendMessage({
          type: "translate-selection",
          text: word.dataset.word || word.textContent,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage
        });
        if (response?.ok && word.isConnected && word.classList.contains("is-hovered")) {
          refineAlignedTargetWords(response.translatedText, alignmentContext);
        }
      } catch (_error) {
        // The lookup card will show a provider error if the hover continues.
      }
    }, 90);
    const delay = Math.max(120, Math.min(1500, Number(settings.hoverDelay) || 420));
    hoverLookupTimer = setTimeout(() => {
      showSelectionCard(word.dataset.word || word.textContent, rect.left + rect.width / 2, rect.bottom, "word");
    }, delay);
  }

  function handleWordPointerOut(event) {
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || word.contains(event.relatedTarget)) return;
    clearTimeout(hoverLookupTimer);
    clearTimeout(hoverPrefetchTimer);
    if (!selectionCard?.classList.contains("is-visible")) clearWordHighlights();
  }

  function positionSelectionCard(clientX, clientY) {
    const rootRect = root.getBoundingClientRect();
    selectionCard.style.left = `${Math.max(12, clientX - rootRect.left + 12)}px`;
    selectionCard.style.top = `${Math.max(12, clientY - rootRect.top + 12)}px`;
    requestAnimationFrame(() => {
      const cardRect = selectionCard.getBoundingClientRect();
      let left = parseFloat(selectionCard.style.left);
      let top = parseFloat(selectionCard.style.top);
      if (cardRect.right > rootRect.right - 12) left -= cardRect.right - rootRect.right + 12;
      if (cardRect.bottom > rootRect.bottom - 12) top -= cardRect.bottom - rootRect.bottom + 12;
      selectionCard.style.left = `${Math.max(12, left)}px`;
      selectionCard.style.top = `${Math.max(12, top)}px`;
    });
  }

  async function showSelectionCard(text, clientX, clientY, kind = "selection") {
    const cleanText = String(text || "").replace(/\s+/g, " ").trim();
    if (!cleanText) return;
    const sequence = ++lookupSequence;
    const sourceNode = selectionCard.querySelector(".dualsub-card-source");
    const resultNode = selectionCard.querySelector(".dualsub-card-result");
    const sentenceSourceNode = selectionCard.querySelector(".dualsub-card-sentence-source");
    const sentenceTargetNode = selectionCard.querySelector(".dualsub-card-sentence-target");
    const linkNode = selectionCard.querySelector(".dualsub-card-link");
    const saveButton = selectionCard.querySelector('[data-action="save"]');
    const sentenceButton = selectionCard.querySelector('[data-action="sentence"]');
    const replayButton = selectionCard.querySelector('[data-action="replay"]');
    const sentence = currentSourceText || cleanText;
    const sourceWords = Array.from(sourceLine.querySelectorAll(".dualsub-word"));
    const hoveredWord = sourceLine.querySelector(".dualsub-word.is-hovered");
    const hoveredWordIndex = sourceWords.indexOf(hoveredWord);
    lookupContext = {
      kind,
      sourceText: cleanText,
      translatedText: "",
      sentence,
      sentenceTranslation: currentTargetText || "",
      videoId: currentVideoId,
      videoTitle: currentVideoTitle,
      timeMs: currentSourceCue?.start ?? Math.round((video?.currentTime || 0) * 1000),
      alignmentRatio: hoveredWordIndex >= 0 && sourceWords.length
        ? (hoveredWordIndex + 0.5) / sourceWords.length
        : Number.NaN
    };
    sourceNode.textContent = cleanText;
    resultNode.textContent = "Translating…";
    sentenceSourceNode.textContent = sentence;
    sentenceTargetNode.textContent = lookupContext.sentenceTranslation || "Translation available on request";
    saveButton.disabled = true;
    saveButton.textContent = "+ Vocabulary";
    sentenceButton.disabled = !sentence;
    sentenceButton.textContent = "Translate line";
    replayButton.disabled = !video;
    linkNode.href = `https://translate.google.com/?sl=${encodeURIComponent(settings.sourceLanguage)}&tl=${encodeURIComponent(settings.targetLanguage)}&text=${encodeURIComponent(cleanText)}&op=translate`;
    selectionCard.classList.add("is-visible");
    root.classList.add("dualsub-learning-open");
    positionSelectionCard(clientX, clientY);

    if (settings.pauseOnLookup && video && !video.paused) {
      video.pause();
      pausedByLookup = true;
    }

    try {
      const response = await browser.runtime.sendMessage({
        type: "translate-selection",
        text: cleanText,
        sourceLanguage: settings.sourceLanguage,
        targetLanguage: settings.targetLanguage
      });
      if (sequence !== lookupSequence || !selectionCard.classList.contains("is-visible")) return;
      resultNode.textContent = response?.ok ? response.translatedText : (response?.error || "Translation unavailable");
      if (response?.ok && lookupContext) {
        lookupContext.translatedText = response.translatedText;
        refineAlignedTargetWords(response.translatedText);
        saveButton.disabled = false;
      }
    } catch (error) {
      if (sequence !== lookupSequence) return;
      resultNode.textContent = error.message || "Translation unavailable";
    }
  }

  async function handleLearningCardAction(event) {
    const button = event.target.closest?.("[data-action]");
    if (!button) {
      const word = event.target.closest?.(".dualsub-source .dualsub-word");
      if (word && window.getSelection()?.isCollapsed) {
        clearTimeout(hoverLookupTimer);
        highlightAlignedWord(word);
        const rect = word.getBoundingClientRect();
        showSelectionCard(word.dataset.word || word.textContent, rect.left + rect.width / 2, rect.bottom, "word");
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

    if (action === "replay" && video) {
      video.currentTime = Math.max(0, lookupContext.timeMs / 1000 - 0.35);
      await video.play().catch(() => {});
      pausedByLookup = false;
      return;
    }

    if (action === "speak") {
      window.speechSynthesis?.cancel();
      const utterance = new SpeechSynthesisUtterance(lookupContext.sourceText);
      utterance.lang = settings.sourceLanguage === "fr" ? "fr-FR" : settings.sourceLanguage;
      utterance.rate = 0.88;
      window.speechSynthesis?.speak(utterance);
      return;
    }

    if (action === "sentence") {
      button.disabled = true;
      button.textContent = "Translating…";
      const targetNode = selectionCard.querySelector(".dualsub-card-sentence-target");
      try {
        const response = await browser.runtime.sendMessage({
          type: "translate-selection",
          text: lookupContext.sentence,
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage
        });
        targetNode.textContent = response?.ok ? response.translatedText : (response?.error || "Translation unavailable");
        if (response?.ok) lookupContext.sentenceTranslation = response.translatedText;
      } catch (error) {
        targetNode.textContent = error.message || "Translation unavailable";
      } finally {
        button.disabled = false;
        button.textContent = "Translate line";
      }
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
    clearTimeout(hoverLookupTimer);
    clearTimeout(hoverPrefetchTimer);
    clearWordHighlights();
    selectionCard?.classList.remove("is-visible");
    root?.classList.remove("dualsub-learning-open");
    if (pausedByLookup && video?.paused) video.play().catch(() => {});
    pausedByLookup = false;
  }

  function handleLearningKeydown(event) {
    if (event.key === "Escape" && selectionCard?.classList.contains("is-visible")) {
      hideSelectionCard();
      return;
    }
    const word = event.target.closest?.(".dualsub-source .dualsub-word");
    if (!word || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    highlightAlignedWord(word);
    const rect = word.getBoundingClientRect();
    showSelectionCard(word.dataset.word || word.textContent, rect.left + rect.width / 2, rect.bottom, "word");
  }

  function handleNavigation() {
    stopNativeCapture(false);
    stopAheadTranslation();
    currentVideoId = "";
    lastPlaybackCueIndex = -1;
    sourceCues = [];
    targetCues = [];
    alignedTargetCues = [];
    loadGeneration += 1;
    renderCueText("", "");
    hideSelectionCard();
    attachToPlayer();
    setTimeout(requestTrackData, 350);
    setTimeout(requestTrackData, 1200);
  }

  function attachToPlayer() {
    if (!createOverlay()) return;
    video = document.querySelector(".html5-video-player video");
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
      recoverTracksFromNativePlayer(nativeSourceTrack);
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

  document.addEventListener("yt-navigate-finish", handleNavigation);
  document.addEventListener("fullscreenchange", () => setTimeout(attachToPlayer, 50));
  document.addEventListener("mousedown", (event) => {
    if (selectionCard?.classList.contains("is-visible") && !selectionCard.contains(event.target)) {
      hideSelectionCard();
    }
  }, true);

  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "get-status") return Promise.resolve(status);
    if (message?.type === "get-diagnostics") {
      const mode = usingNativeSource
        ? "live-source"
        : usingNativeTranslation
          ? "live-youtube-translation"
          : usingAheadTranslation
            ? "prefetched-provider-translation"
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
          alignedCueCount: alignedTargetCues.filter(Boolean).length,
          currentCueIndex: currentSourceCueIndex,
          currentTimeSeconds: Number((video?.currentTime || 0).toFixed(2)),
          sourceLanguage: settings.sourceLanguage,
          targetLanguage: settings.targetLanguage,
          translationProvider: settings.translationProvider,
          subtitleLeadMs: settings.subtitleLeadMs
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
    if (areaName !== "sync" || !changes.settings) return;
    const previousSource = settings.sourceLanguage;
    const previousTarget = settings.targetLanguage;
    const previousWholeLiveLines = settings.wholeLiveLines;
    const previousTranslationProvider = settings.translationProvider;
    settings = mergeSettings(changes.settings.newValue);
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
    if (settings.enabled && (previousSource !== settings.sourceLanguage || previousTarget !== settings.targetLanguage)) {
      currentVideoId = "";
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

  const playerObserver = new MutationObserver(() => {
    if (!root?.isConnected || !video?.isConnected) attachToPlayer();
  });
  playerObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
