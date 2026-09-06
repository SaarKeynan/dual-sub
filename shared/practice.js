(() => {
  function compareWords(expected, actual) {
    const tokens = (value) => String(value || "").normalize("NFC").toLocaleLowerCase("fr")
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)?.map((word) => word.replace(/’/g, "'")) || [];
    const left = tokens(expected).slice(0, 500), right = tokens(actual).slice(0, 500);
    const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = 0; i <= left.length; i++) rows[i][0] = i;
    for (let j = 0; j <= right.length; j++) rows[0][j] = j;
    for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    const changes = [];
    let i = left.length, j = right.length;
    while (i || j) {
      if (i && j && rows[i][j] === rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)) {
        changes.push({ type: left[i - 1] === right[j - 1] ? "correct" : "replace", expected: left[--i], actual: right[--j] });
      } else if (i && rows[i][j] === rows[i - 1][j] + 1) {
        changes.push({ type: "missing", expected: left[--i], actual: "" });
      } else changes.push({ type: "extra", expected: "", actual: right[--j] });
    }
    return changes.reverse();
  }

  function createController({ getVideo, getCues, getOffset, hideCaptions, requestRender }) {
    let exercise = null, timer = null, generation = 0;
    function stop() {
      generation++;
      clearTimeout(timer); timer = null; exercise = null;
      hideCaptions(false);
    }
    async function start(mode, first, last = first, pauseSeconds = 2) {
      const video = getVideo(), cues = getCues();
      if (!video || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= cues.length) {
        throw new Error("Choose a valid caption range first.");
      }
      if (last - first >= 20 || cues.slice(first, last + 1).reduce((size, cue) => size + cue.text.length, 0) > 2000) throw new Error("Choose up to 20 short captions for each exercise.");
      if (!["dictation", "shadow"].includes(mode)) throw new Error("Unknown practice mode.");
      stop();
      exercise = { mode, first, last, start: Math.max(0, cues[first].start - getOffset()),
        end: Math.max(0, cues[last].end - getOffset()), pauseMs: Math.max(0, Math.min(15, Number(pauseSeconds) || 0)) * 1000,
        answer: cues.slice(first, last + 1).map((cue) => cue.text).join(" "), revealed: false, waiting: false };
      hideCaptions(mode === "dictation");
      video.currentTime = exercise.start / 1000;
      const started = generation;
      try { await video.play(); } catch (error) { if (generation === started) stop(); throw error; }
      requestRender();
    }
    function tick() {
      const video = getVideo();
      if (!exercise || !video || exercise.waiting || video.paused || video.currentTime * 1000 < exercise.end) return;
      video.pause();
      if (exercise.mode === "dictation") return;
      exercise.waiting = true;
      const expected = generation;
      timer = setTimeout(() => {
        if (expected !== generation || !exercise || getVideo() !== video) return;
        exercise.waiting = false;
        video.currentTime = exercise.start / 1000;
        video.play().catch(() => stop());
        requestRender();
      }, exercise.pauseMs);
    }
    async function replay() {
      if (!exercise) throw new Error("Start an exercise first.");
      const { mode, first, last, pauseMs } = exercise;
      return start(mode, first, last, pauseMs / 1000);
    }
    function reveal() {
      if (!exercise || exercise.mode !== "dictation") throw new Error("Start a dictation first.");
      getVideo()?.pause(); exercise.revealed = true; hideCaptions(false);
      return exercise.answer;
    }
    return { start, stop, tick, reveal, replay, get active() { return Boolean(exercise); },
      snapshot() { return exercise ? { mode: exercise.mode, first: exercise.first, last: exercise.last,
        revealed: exercise.revealed, ...(exercise.revealed ? { answer: exercise.answer } : {}) } : null; } };
  }
  globalThis.DualSubPractice = Object.freeze({ compareWords, createController });
})();
