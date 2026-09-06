(() => {
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


  globalThis.DualSubCaptions = Object.freeze({ joinCaptionParts, foldLateCaptionFragments, parseCaptionPayload, cueAt, cueIndexAt });
})();
