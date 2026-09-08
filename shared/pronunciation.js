(() => {
  // Picking a French voice was implemented three times, in the subtitle lookup
  // card, the settings preview and the vocabulary review, with three different
  // scoring rules. One copy also ignored the reader's saved choice entirely.
  function isFrenchVoice(voice) {
    return /^fr(?:[-_]|$)/i.test(voice?.lang || "") || /french|fran[cç]ais|france/i.test(voice?.name || "");
  }

  function voiceScore(voice, preferredVoiceURI) {
    return (voice.voiceURI === preferredVoiceURI ? 10000 : 0) +
      (/^fr-FR$/i.test(voice.lang || "") ? 500 : 300) +
      (/natural|neural|premium/i.test(voice.name || "") ? 120 : 0) +
      (voice.localService ? 30 : 0) +
      (voice.default ? 10 : 0);
  }

  function frenchVoices(voices, preferredVoiceURI = "") {
    return Array.from(voices || [])
      .filter(isFrenchVoice)
      .sort((left, right) =>
        voiceScore(right, preferredVoiceURI) - voiceScore(left, preferredVoiceURI) ||
        String(left.name).localeCompare(String(right.name))
      );
  }

  function chooseFrenchVoice(voices, preferredVoiceURI = "") {
    return frenchVoices(voices, preferredVoiceURI)[0] || null;
  }

  // Firefox often reports an empty list on the first call and fills it
  // asynchronously, which sent the first click to the voice-setup page even
  // when a French voice was installed.
  function waitForFrenchVoice(synthesis, preferredVoiceURI = "", timeoutMs = 1200) {
    const pick = () => chooseFrenchVoice(synthesis?.getVoices?.(), preferredVoiceURI);
    const immediate = pick();
    if (immediate) return Promise.resolve(immediate);
    if (typeof synthesis?.addEventListener !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        synthesis.removeEventListener?.("voiceschanged", finish);
        resolve(pick());
      };
      const timer = setTimeout(finish, timeoutMs);
      synthesis.addEventListener("voiceschanged", finish);
    });
  }

  function speechRate(value) {
    return Math.max(0.6, Math.min(1.2, Number(value) || 0.88));
  }

  globalThis.DualSubPronunciation = Object.freeze({
    isFrenchVoice, frenchVoices, chooseFrenchVoice, waitForFrenchVoice, speechRate
  });
})();
