let currentTabId = null;
let refreshGeneration = 0;
let state = null;
let lastActiveIndex = -1;
let lastTranscriptRenderKey = "";
let selectedView = "transcript";

const element = (id) => document.getElementById(id);
const normalize = (value) => String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
const WATCH_URL = /^https?:\/\/www\.youtube\.com\/watch(?:\?|$)/;

function formatTime(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// The one place that decides which tab the sidebar is reading. In a panel that
// is whichever tab is in front; a tab-mode page cannot ask that question,
// because the answer would be itself.
async function resolveTab() {
  return activeTab();
}

async function send(message) {
  if (!currentTabId) currentTabId = (await resolveTab())?.id || null;
  if (!currentTabId) return null;
  return browser.tabs.sendMessage(currentTabId, message).catch(() => null);
}

function unknownWordsInCue(cue, unknownWords) {
  return (cue.text.match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) || []).some((word) => unknownWords.has(word.toLocaleLowerCase("fr")));
}

// Dictation hides the French until the answer is checked. The word list gives
// the same answer away as the transcript does, so both are withheld together.
function dictationHidesCaptions() {
  const exercise = state?.practice;
  return exercise?.mode === "dictation" && !exercise.revealed;
}

function setView(view) {
  selectedView = view;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.setAttribute("aria-selected", String(tab.dataset.view === view));
  }
  for (const pane of document.querySelectorAll(".pane")) {
    pane.dataset.active = String(pane.dataset.pane === view);
  }
}

function renderTabs() {
  const locked = dictationHidesCaptions();
  const words = state?.studyWords?.length || 0;
  if (locked && selectedView !== "practice") setView("practice");
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    tab.disabled = locked && tab.dataset.view !== "practice";
  }
  const badge = element("wordCount");
  const count = globalThis.DualSubWordList ? globalThis.DualSubWordList.addableCount() : words;
  badge.textContent = String(count);
  badge.hidden = !count;
}

function renderWordList() {
  if (!globalThis.DualSubWordList) return;
  globalThis.DualSubWordList.render(element("wordList"), {
    words: state?.studyWords || [],
    cues: state?.cues || [],
    videoId: state?.videoId || "",
    videoTitle: state?.title || "",
    hasCaptions: Boolean(state?.cues?.length)
  });
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
  // Distinguish a video with no French captions from a search or filter that
  // simply matched nothing; both used to show the "no captions" notice.
  const hasCaptions = Boolean(state?.cues?.length);
  element("empty").hidden = hasCaptions || !state;
  document.querySelector(".status-strip").hidden = !hasCaptions;
  document.querySelector(".tabs").hidden = !hasCaptions;
  document.querySelector(".panes").hidden = !hasCaptions;
  element("noMatches").hidden = Boolean(cues.length) || !hasCaptions;
  // A short count is the part worth announcing. The transcript itself is
  // browsable content and re-announcing all of it on every render is noise.
  const total = state?.cues?.length || 0;
  element("transcriptCount").textContent = !hasCaptions ? ""
    : cues.length === total ? `${total} caption${total === 1 ? "" : "s"}`
    : `${cues.length} of ${total} captions shown`;
  if (state && state.currentCueIndex !== lastActiveIndex && !query) {
    lastActiveIndex = state.currentCueIndex;
    requestAnimationFrame(() => element("transcript").querySelector(".is-active")?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
}

function render() {
  element("dictationPanel").hidden = state?.practice?.mode !== "dictation";
  element("sessionSummary").textContent = state?.session
    ? state.session.encountered + " different words encountered; " + state.session.saved + " words saved this session"
    : "Start watching to collect a session recap.";
  for (const id of ["startShadow", "startDictation", "useCurrent"]) element(id).disabled = !state?.cues?.length;
  element("reviewSession").disabled = !state?.session?.words?.length;
  element("videoTitle").textContent = state?.title || state?.status || "Open a French YouTube video";
  element("coverage").textContent = `${state?.coveragePercent || 0}%`;
  element("coverageBar").style.width = `${Math.min(100, Math.max(0, state?.coveragePercent || 0))}%`;
  element("provider").textContent = state?.provider || "";
  element("studyMode").value = ["study", "shadow"].includes(state?.studyMode) ? state.studyMode : "watch";
  renderTranscript();
  renderWordList();
  renderTabs();
}

async function refresh() {
  if (document.hidden) return;
  const generation = ++refreshGeneration;
  const tab = await resolveTab();
  if (generation !== refreshGeneration) return;
  if (currentTabId !== tab?.id) {
    currentTabId = tab?.id || null;
    state = null;
    lastTranscriptRenderKey = "";
    lastActiveIndex = -1;
    setView("transcript");
  }
  if (!tab || (tab.url && !WATCH_URL.test(tab.url))) {
    state = null; render(); return;
  }
  const response = await browser.tabs.sendMessage(tab.id, { type: "get-transcript-state", lastRevision: state?.revision || "" }).catch(() => null);
  if (generation !== refreshGeneration || currentTabId !== tab.id) return;
  state = response?.ok ? { ...response, cues: response.cues || (response.videoId === state?.videoId ? state.cues : []) } : null;
  render();
}

async function startPractice(mode) {
  element("dictationFeedback").replaceChildren(); element("dictationAnswer").value = "";
  const response = await send({ type: "start-practice", mode,
    first: Number(element("practiceFirst").value) - 1, last: Number(element("practiceLast").value) - 1,
    pauseSeconds: Number(element("practicePause").value) });
  element("practiceStatus").textContent = response?.ok ? (mode === "dictation" ? "Listen and type. Captions are hidden until you check." : "Range repeats with a speaking pause.") : response?.error || "Open a video with timed captions.";
  refresh();
}

function bindEvents() {
  document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (tab && !tab.disabled) setView(tab.dataset.view);
  });
  element("transcript").addEventListener("click", (event) => {
    const cue = event.target.closest(".cue");
    if (cue) send({ type: "seek-to-cue", index: Number(cue.dataset.index) });
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
  element("replayDictation").addEventListener("click", async () => {
    const response = await send({ type: "replay-practice" });
    if (!response?.ok) element("practiceStatus").textContent = response?.error || "Start a dictation first.";
    else element("dictationFeedback").replaceChildren();
    refresh();
  });
  element("reviewSession").addEventListener("click", async () => {
    const response = await browser.runtime.sendMessage({ type: "get-vocabulary" });
    const words = new Set(state?.session?.words || []);
    const ids = (response?.entries || []).filter((entry) => words.has(entry.normalized) || (entry.videoId === state?.videoId && entry.sourceText.split(/\s+/).every((word) => words.has(word.toLocaleLowerCase("fr"))))).slice(0, 10).map((entry) => entry.id);
    if (!ids.length) { element("practiceStatus").textContent = "Save some words from this video to review them here."; return; }
    await browser.tabs.create({ url: browser.runtime.getURL("vocabulary/vocabulary.html") + "?review=" + encodeURIComponent(ids.join(",")) });
  });

  // A word saved from the in-video lookup card has to withdraw its Save here
  // too, and that write happens outside this page.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.vocabulary) globalThis.DualSubWordList?.refreshSaved().then(render);
  });
  browser.tabs.onActivated.addListener(refresh);
  browser.tabs.onUpdated.addListener((_tabId, changeInfo) => { if (changeInfo.url || changeInfo.status === "complete") refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  globalThis.DualSubWordList?.connect({ send, onChange: render });
}

if (typeof document !== "undefined" && document.getElementById("transcript")) {
  bindEvents();
  refresh();
  setInterval(refresh, 900);
}
