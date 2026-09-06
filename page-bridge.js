(() => {
  if (window.__dualSubBridgeInstalled) return;
  window.__dualSubBridgeInstalled = true;
  if (typeof performance.setResourceTimingBufferSize === "function") {
    performance.setResourceTimingBufferSize(5000);
  }

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
    return "";
  }

  function getTrackData() {
    const player = document.getElementById("movie_player");
    if (!player || typeof player.getPlayerResponse !== "function") {
      return { ok: false, error: "YouTube player is not ready." };
    }

    const response = player.getPlayerResponse();
    const list = response?.captions?.playerCaptionsTracklistRenderer;
    const tracks = (list?.captionTracks || []).map((track) => ({
      baseUrl: track.baseUrl,
      languageCode: track.languageCode,
      name: textFromRuns(track.name),
      kind: track.kind || "",
      vssId: track.vssId || "",
      isTranslatable: track.isTranslatable !== false
    }));

    return {
      ok: true,
      videoId: response?.videoDetails?.videoId || "",
      title: response?.videoDetails?.title || "",
      tracks,
      translationLanguages: (list?.translationLanguages || []).map((language) => ({
        languageCode: language.languageCode,
        name: textFromRuns(language.languageName)
      }))
    };
  }

  window.addEventListener("dualsub:request-tracks", () => {
    let detail;
    try {
      detail = JSON.stringify(getTrackData());
    } catch (error) {
      detail = JSON.stringify({ ok: false, error: error.message });
    }
    window.dispatchEvent(new CustomEvent("dualsub:tracks", { detail }));
  });

  window.addEventListener("dualsub:fetch-caption-track", async (event) => {
    let request = {};
    let result;
    try {
      request = JSON.parse(event.detail || "{}");
      const url = new URL(request.url);
      const allowedHost = url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com");
      if (url.protocol !== "https:" || !allowedHost || url.pathname !== "/api/timedtext") {
        throw new Error("Blocked an unexpected captions URL.");
      }

      // Running this request in YouTube's page context preserves the same
      // cookies, referrer, and origin context used by the native player.
      const response = await fetch(url.toString(), {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`YouTube captions request failed (${response.status}).`);
      result = { id: request.id, ok: true, text: await response.text() };
    } catch (error) {
      result = { id: request.id, ok: false, error: error.message };
    }
    window.dispatchEvent(new CustomEvent("dualsub:caption-track-result", {
      detail: JSON.stringify(result)
    }));
  });

  function findTranscriptParams(root) {
    const stack = [root];
    const seen = new WeakSet();
    let inspected = 0;
    while (stack.length && inspected < 50000) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;
      if (value.getTranscriptEndpoint?.params) return value.getTranscriptEndpoint.params;
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    return "";
  }

  function collectTranscriptSegments(root) {
    const segments = [];
    const stack = [root];
    const seen = new WeakSet();
    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      const renderer = value.transcriptSegmentRenderer;
      if (renderer) {
        const text = textFromRuns(renderer.snippet).replace(/\s+/g, " ").trim();
        const start = Number(renderer.startMs);
        const end = Number(renderer.endMs);
        if (text && Number.isFinite(start)) {
          segments.push({ start, end: Number.isFinite(end) && end > start ? end : start + 5000, text });
        }
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    segments.sort((left, right) => left.start - right.start);
    return segments.filter((segment, index) => (
      !index || segment.start !== segments[index - 1].start || segment.text !== segments[index - 1].text
    ));
  }

  window.addEventListener("dualsub:request-full-transcript", async (event) => {
    let request = {};
    let result;
    try {
      request = JSON.parse(event.detail || "{}");
      const watchData = document.querySelector("ytd-watch-flexy")?.data;
      const params = findTranscriptParams(watchData) || findTranscriptParams(window.ytInitialData);
      if (!params) throw new Error("YouTube did not expose a transcript continuation.");

      const config = window.ytcfg;
      const apiKey = config?.get?.("INNERTUBE_API_KEY");
      const context = config?.get?.("INNERTUBE_CONTEXT");
      if (!apiKey || !context) throw new Error("YouTube transcript configuration is unavailable.");

      const response = await fetch(`/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context, params })
      });
      if (!response.ok) throw new Error(`YouTube transcript request failed (${response.status}).`);
      const segments = collectTranscriptSegments(await response.json());
      if (!segments.length) throw new Error("YouTube returned an empty transcript panel.");
      result = { id: request.id, ok: true, segments };
    } catch (error) {
      result = { id: request.id, ok: false, error: error.message };
    }
    window.dispatchEvent(new CustomEvent("dualsub:full-transcript-result", {
      detail: JSON.stringify(result)
    }));
  });

  function findAuthenticatedCaptionUrl(language) {
    const wantedLanguage = String(language || "fr").toLowerCase();
    const entries = performance.getEntriesByType("resource");
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const rawUrl = entries[index]?.name;
      if (!rawUrl || !rawUrl.includes("/api/timedtext")) continue;
      const url = new URL(rawUrl);
      const trackLanguage = String(url.searchParams.get("lang") || "").toLowerCase();
      if (
        url.pathname === "/api/timedtext" &&
        (trackLanguage === wantedLanguage || trackLanguage.startsWith(`${wantedLanguage}-`))
      ) return url.toString();
    }
    return "";
  }

  let lastAuthenticatedCaptionUrl = "";
  if (typeof PerformanceObserver === "function") {
    const captionObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const rawUrl = entry?.name;
        if (!rawUrl || rawUrl === lastAuthenticatedCaptionUrl || !rawUrl.includes("/api/timedtext")) continue;
        try {
          const url = new URL(rawUrl);
          if (url.pathname !== "/api/timedtext" || !url.searchParams.get("lang")) continue;
          lastAuthenticatedCaptionUrl = rawUrl;
          window.dispatchEvent(new CustomEvent("dualsub:authenticated-caption-url", {
            detail: JSON.stringify({ url: rawUrl, language: url.searchParams.get("lang") || "" })
          }));
        } catch (_error) {
          // Ignore unrelated or malformed resource timing entries.
        }
      }
    });
    try {
      captionObserver.observe({ type: "resource", buffered: true });
    } catch (_error) {
      captionObserver.observe({ entryTypes: ["resource"] });
    }
  }

  window.addEventListener("dualsub:request-player-caption-url", (event) => {
    let request = {};
    let result;
    try {
      request = JSON.parse(event.detail || "{}");
      const matchedUrl = findAuthenticatedCaptionUrl(request.language);
      result = { id: request.id, ok: true, url: matchedUrl };
    } catch (error) {
      result = { id: request.id, ok: false, error: error.message };
    }
    window.dispatchEvent(new CustomEvent("dualsub:player-caption-url-result", {
      detail: JSON.stringify(result)
    }));
  });

  let previousCaptionState = null;

  window.addEventListener("dualsub:enable-native-translation", (event) => {
    let result;
    try {
      const request = JSON.parse(event.detail || "{}");
      const player = document.getElementById("movie_player");
      if (!player || typeof player.setOption !== "function") {
        throw new Error("YouTube's live caption controls are unavailable.");
      }

      if (!previousCaptionState) {
        const loadedModules = typeof player.getOptions === "function" ? player.getOptions() : [];
        previousCaptionState = {
          moduleWasLoaded: Array.isArray(loadedModules) && loadedModules.includes("captions"),
          track: typeof player.getOption === "function"
            ? player.getOption("captions", "track")
            : null
        };
      }

      if (typeof player.loadModule === "function") player.loadModule("captions");
      player.setOption("captions", "track", {
        languageCode: request.sourceLanguage,
        kind: request.sourceKind || "",
        vssId: request.sourceVssId || "",
        translationLanguage: { languageCode: request.targetLanguage }
      });
      player.setOption("captions", "reload", true);
      result = { ok: true };
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    window.dispatchEvent(new CustomEvent("dualsub:native-translation-result", {
      detail: JSON.stringify(result)
    }));
  });

  window.addEventListener("dualsub:enable-native-source", (event) => {
    let result;
    try {
      const request = JSON.parse(event.detail || "{}");
      const player = document.getElementById("movie_player");
      if (!player || typeof player.setOption !== "function") {
        throw new Error("YouTube's live caption controls are unavailable.");
      }

      if (!previousCaptionState) {
        const loadedModules = typeof player.getOptions === "function" ? player.getOptions() : [];
        previousCaptionState = {
          moduleWasLoaded: Array.isArray(loadedModules) && loadedModules.includes("captions"),
          track: typeof player.getOption === "function"
            ? player.getOption("captions", "track")
            : null
        };
      }

      if (typeof player.loadModule === "function") player.loadModule("captions");
      player.setOption("captions", "track", {
        languageCode: request.sourceLanguage,
        kind: request.sourceKind || "",
        vssId: request.sourceVssId || ""
      });
      player.setOption("captions", "reload", true);
      result = { ok: true };
    } catch (error) {
      result = { ok: false, error: error.message };
    }
    window.dispatchEvent(new CustomEvent("dualsub:native-source-result", {
      detail: JSON.stringify(result)
    }));
  });

  window.addEventListener("dualsub:restore-native-captions", () => {
    const player = document.getElementById("movie_player");
    try {
      if (player && previousCaptionState) {
        if (previousCaptionState.track && typeof player.setOption === "function") {
          player.setOption("captions", "track", previousCaptionState.track);
        } else if (!previousCaptionState.moduleWasLoaded && typeof player.unloadModule === "function") {
          player.unloadModule("captions");
        }
      }
    } finally {
      previousCaptionState = null;
    }
  });

  window.addEventListener("dualsub:reset-native-caption-state", () => {
    // YouTube owns caption state again after SPA navigation. Do not apply a
    // track saved from the previous video to the newly loaded player.
    previousCaptionState = null;
  });
})();
