let currentTabId = null;
let refreshGeneration = 0;
let state = null;
let lastActiveIndex = -1;
let lastTranscriptRenderKey = "";

const element = (id) => document.getElementById(id);
const normalize = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(message) {
  if (!currentTabId) currentTabId = (await activeTab())?.id || null;
  if (!currentTabId) return null;
  return browser.tabs.sendMessage(currentTabId, message).catch(() => null);
}

function unknownWordsInCue(cue, unknownWords) {
  return (cue.text.match(/[\p{L}]+(?:['\u2019][\p{L}]+)*/gu) || []).some((word) => unknownWords.has(word.toLocaleLowerCase("fr")));
}

function renderUnknownWords() {
  const container = element("unknownWords");
  const words = state?.topUnknown || [];
  element("phrases").replaceChildren(...(state?.topPhrases || []).map((item) => {
    const chip = document.createElement("span");
    chip.className = "phrase-chip";
    chip.textContent = `${item.phrase} ×${item.count}`;
    return chip;
  }));
  if (!words.length) {
    container.replaceChildren(Object.assign(document.createElement("span"), { className: "muted", textContent: state ? "No repeated unknown words here." : "Waiting for captions…" }));
    return;
  }
  container.replaceChildren(...words.map((item) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.dataset.word = item.word;
    const text = document.createElement("span");
    text.textContent = item.word;
    const count = document.createElement("small");
    count.textContent = `×${item.count}`;
    const known = document.createElement("button");
    known.type = "button"; known.dataset.state = "known"; known.title = "Mark known"; known.setAttribute("aria-label", `Mark ${item.word} as known`); known.textContent = "✓";
    const learning = document.createElement("button");
    learning.type = "button"; learning.dataset.state = "learning"; learning.title = "Learn this word"; learning.setAttribute("aria-label", `Add ${item.word} to learning`); learning.textContent = "+";
    const ignore = document.createElement("button");
    ignore.type = "button"; ignore.dataset.state = "ignored"; ignore.title = "Ignore name or noise"; ignore.setAttribute("aria-label", `Ignore ${item.word}`); ignore.textContent = "×";
    chip.append(text, count, known, learning, ignore);
    return chip;
  }));
}

function renderTranscript() {
  const query = normalize(element("search").value.trim());
  const showEnglish = element("showEnglish").checked;
  const unknownOnly = element("unknownOnly").checked;
  const unknownWords = new Set((state?.vocabulary || []).filter((item) => item.state === "unknown").map((item) => item.word));
  const renderKey = `${state?.revision || "none"}|${query}|${showEnglish}|${unknownOnly}`;
  if (renderKey === lastTranscriptRenderKey) {
    if (state && state.currentCueIndex !== lastActiveIndex) {
      element("transcript").querySelector(`[data-index="${lastActiveIndex}"]`)?.classList.remove("is-active");
      const active = element("transcript").querySelector(`[data-index="${state.currentCueIndex}"]`);
      active?.classList.add("is-active");
      lastActiveIndex = state.currentCueIndex;
      if (!query) active?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    return;
  }
  lastTranscriptRenderKey = renderKey;
  const cues = (state?.cues || []).filter((cue) => {
    if (query && !normalize(`${cue.text} ${cue.translation}`).includes(query)) return false;
    return !unknownOnly || unknownWordsInCue(cue, unknownWords);
  });
  const fragment = document.createDocumentFragment();
  for (const cue of cues) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cue${cue.index === state.currentCueIndex ? " is-active" : ""}`;
    button.dataset.index = cue.index;
    const time = document.createElement("span"); time.className = "time"; time.textContent = formatTime(cue.start);
    const content = document.createElement("span");
    const french = document.createElement("span"); french.className = "french"; french.textContent = cue.text;
    content.appendChild(french);
    if (showEnglish && cue.translation) {
      const english = document.createElement("span"); english.className = "english"; english.textContent = cue.translation;
      if (cue.provenance) {
        const provenance = document.createElement("span"); provenance.className = "provenance"; provenance.textContent = cue.provenance;
        english.appendChild(provenance);
      }
      content.appendChild(english);
    }
    button.append(time, content);
    fragment.appendChild(button);
  }
  element("transcript").replaceChildren(fragment);
  element("empty").hidden = Boolean(cues.length);
  if (state && state.currentCueIndex !== lastActiveIndex && !query) {
    lastActiveIndex = state.currentCueIndex;
    requestAnimationFrame(() => element("transcript").querySelector(".is-active")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
}

function render() {
  const exercise = state?.practice;
  const hidden = exercise?.mode === "dictation" && !exercise.revealed;
  document.querySelector(".transcript-panel").hidden = hidden;
  document.querySelector(".unknown-panel").hidden = hidden;
  element("dictationPanel").hidden = exercise?.mode !== "dictation";
  element("sessionSummary").textContent = state?.session
    ? state.session.encountered + " different words encountered; " + state.session.saved + " words saved this session"
    : "Start watching to collect a session recap.";
  for (const id of ["startShadow", "startDictation", "useCurrent"]) element(id).disabled = !state?.cues?.length;
  element("reviewSession").disabled = !state?.session?.words?.length;
  element("videoTitle").textContent = state?.title || state?.status || "Open a French YouTube video";
  element("buffer").textContent = `${state?.bufferAheadSeconds || 0}s`;
  element("coverage").textContent = `${state?.coveragePercent || 0}%`;
  element("coverageBar").style.width = `${Math.min(100, Math.max(0, state?.coveragePercent || 0))}%`;
  element("provider").textContent = state?.provider || "";
  element("studyMode").value = ["study", "shadow"].includes(state?.studyMode) ? state.studyMode : "watch";
  renderUnknownWords();
  renderTranscript();
}

async function refresh() {
  const generation = ++refreshGeneration;
  const tab = await activeTab();
  if (generation !== refreshGeneration) return;
  if (currentTabId !== tab?.id) {
    currentTabId = tab?.id || null;
    state = null;
    lastTranscriptRenderKey = "";
    lastActiveIndex = -1;
  }
  if (!tab || (tab.url && !/^https?:\/\/www\.youtube\.com\/watch(?:\?|$)/.test(tab.url))) {
    state = null; render(); return;
  }
  const response = await browser.tabs.sendMessage(tab.id, { type: "get-transcript-state", lastRevision: state?.revision || "" }).catch(() => null);
  if (generation !== refreshGeneration || currentTabId !== tab.id) return;
  state = response?.ok ? { ...response, cues: response.cues || (response.videoId === state?.videoId ? state.cues : []) } : null;
  render();
}

element("transcript").addEventListener("click", (event) => {
  const cue = event.target.closest(".cue");
  if (cue) send({ type: "seek-to-cue", index: Number(cue.dataset.index) });
});
element("unknownWords").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-state]");
  const word = event.target.closest(".chip")?.dataset.word;
  if (!button || !word) return;
  await browser.runtime.sendMessage({ type: "set-word-state", word, state: button.dataset.state });
  refresh();
});
element("previous").addEventListener("click", () => send({ type: "navigate-cue", direction: -1 }));
element("next").addEventListener("click", () => send({ type: "navigate-cue", direction: 1 }));
element("replay").addEventListener("click", () => send({ type: "replay-current-cue" }));
element("search").addEventListener("input", renderTranscript);
element("showEnglish").addEventListener("change", renderTranscript);
element("unknownOnly").addEventListener("change", renderTranscript);
element("studyMode").addEventListener("change", async () => {
  const stored = await browser.storage.sync.get("settings");
  const settings = DualSubSettings.applyStudyMode(stored.settings, element("studyMode").value);
  await browser.storage.sync.set({ settings });
  refresh();
});
element("settings").addEventListener("click", () => browser.runtime.openOptionsPage());
element("vocabulary").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") }));
browser.tabs.onActivated.addListener(refresh);
browser.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.url || changeInfo.status === "complete") refresh(); });
refresh();
setInterval(refresh, 900);

async function startPractice(mode) {
  element("dictationFeedback").replaceChildren(); element("dictationAnswer").value = "";
  const response = await send({ type: "start-practice", mode,
    first: Number(element("practiceFirst").value) - 1, last: Number(element("practiceLast").value) - 1,
    pauseSeconds: Number(element("practicePause").value) });
  element("practiceStatus").textContent = response?.ok ? (mode === "dictation" ? "Listen and type. Captions are hidden until you check." : "Range repeats with a speaking pause.") : response?.error || "Open a video with timed captions.";
  refresh();
}
element("useCurrent").addEventListener("click", () => {
  element("practiceFirst").value = element("practiceLast").value = Math.max(1, (state?.currentCueIndex ?? 0) + 1);
});
element("startShadow").addEventListener("click", () => startPractice("shadow"));
element("startDictation").addEventListener("click", () => startPractice("dictation"));
element("stopPractice").addEventListener("click", async () => { await send({ type: "stop-practice" }); element("practiceStatus").textContent = "Practice stopped."; refresh(); });
element("checkDictation").addEventListener("click", async () => {
  const response = await send({ type: "reveal-dictation" });
  if (!response?.ok) { element("practiceStatus").textContent = response?.error || "Start a dictation first."; return; }
  const changes = DualSubPractice.compareWords(response.answer, element("dictationAnswer").value);
  element("dictationFeedback").replaceChildren(...changes.map((change) => {
    const word = document.createElement("span"); word.className = "answer-" + change.type;
    word.textContent = (change.type === "replace" ? change.actual + " -> " + change.expected : change.expected || change.actual) + " ";
    word.title = change.type; return word;
  }));
  refresh();
});
element("reviewSession").addEventListener("click", async () => {
  const response = await browser.runtime.sendMessage({ type: "get-vocabulary" });
  const words = new Set(state?.session?.words || []);
  const ids = (response?.entries || []).filter((entry) => words.has(entry.normalized) || (entry.videoId === state?.videoId && entry.sourceText.split(/\s+/).every((word) => words.has(word.toLocaleLowerCase("fr"))))).slice(0, 10).map((entry) => entry.id);
  if (!ids.length) { element("practiceStatus").textContent = "Save some words from this video to review them here."; return; }
  await browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") + "?review=" + encodeURIComponent(ids.join(",")) });
});

element("replayDictation").addEventListener("click", async () => {
  const response = await send({ type: "replay-practice" });
  if (!response?.ok) element("practiceStatus").textContent = response?.error || "Start a dictation first.";
  else element("dictationFeedback").replaceChildren();
  refresh();
});
