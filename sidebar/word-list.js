/*
  The video's words, as one list that can actually be studied.

  This replaces four surfaces that all claimed to show "words from this video":
  frequency chips whose buttons only wrote a word state, a session counter, a
  review launcher that could only find words saved elsewhere, and a repeated
  phrase panel with no handler at all. None of them could add a word.

  Two rules shape the code. Meanings come from the cache before they are ever
  fetched, because the keyless Google endpoint starts refusing after very few
  requests. And Save is one click from any row, including a word that has never
  been looked up, which is why saving may have to resolve a meaning first:
  background.js rejects a vocabulary entry that has no translation.
*/
(() => {
  const state = new Map();
  let host = null;
  let signature = "";
  let video = { id: "", title: "" };
  let cues = [];
  let transport = { send: null, onChange: null };

  const key = (word) => String(word || "").normalize("NFC").toLocaleLowerCase("fr");

  function connect({ send, onChange }) {
    transport = { send, onChange };
  }

  function entryFor(word) {
    const identity = key(word);
    if (!state.has(identity)) state.set(identity, { meaning: "", saved: false, status: "idle", error: "" });
    return state.get(identity);
  }

  function addableCount() {
    let count = 0;
    for (const entry of state.values()) if (!entry.saved) count += 1;
    return count;
  }

  async function message(payload) {
    return browser.runtime.sendMessage(payload).catch((error) => ({ ok: false, error: error.message }));
  }

  // Fills the whole visible list from the translation cache and the vocabulary
  // in one round trip, without contacting a provider. Safe to call while a
  // provider is in backoff, which is exactly when it matters most.
  async function peek(words) {
    if (!words.length) return;
    const response = await message({
      type: "peek-word-meanings",
      words: words.map((item) => ({ text: item.word, lookupText: item.lookupText || item.word, readingKey: item.readingKey || "", context: cues[item.cueIndex]?.text || "" }))
    });
    if (!response?.ok) return;
    words.forEach((item, index) => {
      const entry = entryFor(item.word);
      const result = response.meanings[index];
      if (!result) return;
      entry.saved = Boolean(result.saved);
      if (result.translatedText && entry.status !== "saving") entry.meaning = result.translatedText;
    });
  }

  // Re-reads only the saved flags, for a save made from the in-video lookup
  // card while this page is open.
  async function refreshSaved() {
    const words = Array.from(state.keys());
    if (!words.length) return;
    const response = await message({
      type: "peek-word-meanings",
      words: words.map((word) => ({ text: word, lookupText: word, readingKey: "", context: "" }))
    });
    if (!response?.ok) return;
    words.forEach((word, index) => {
      const result = response.meanings[index];
      if (result?.saved) state.get(word).saved = true;
    });
  }

  // The interactive lookup path, reused verbatim so the word-quality checks,
  // the concise fallback and the reading-specific cache key all still apply.
  async function resolveMeaning(item) {
    const entry = entryFor(item.word);
    if (entry.meaning) return entry.meaning;
    const response = await message({
      type: "translate-selection",
      text: item.word,
      lookupText: item.lookupText || item.word,
      readingKey: item.readingKey || "",
      cacheMode: "word",
      context: cues[item.cueIndex]?.text || ""
    });
    if (!response?.ok) {
      entry.error = response?.error || "No meaning available.";
      return "";
    }
    entry.error = "";
    entry.meaning = response.translatedText;
    return entry.meaning;
  }

  async function save(item) {
    const entry = entryFor(item.word);
    if (entry.saved || entry.status === "saving") return;
    entry.status = "saving";
    entry.error = "";
    transport.onChange?.();
    const meaning = await resolveMeaning(item);
    if (!meaning) {
      entry.status = "idle";
      transport.onChange?.();
      return;
    }
    const cue = cues[item.cueIndex];
    const response = await message({
      type: "add-vocabulary",
      entry: {
        sourceText: item.word,
        translatedText: meaning,
        sentence: cue?.text || "",
        sentenceTranslation: cue?.translation || "",
        videoId: video.id,
        videoTitle: video.title,
        timeMs: cue?.start || 0
      }
    });
    entry.status = "idle";
    if (response?.ok) entry.saved = true;
    else entry.error = response?.error || "Could not save.";
    transport.onChange?.();
  }

  async function setWordState(word, value) {
    await message({ type: "set-word-state", word, state: value });
    transport.onChange?.();
  }

  function buildRow(item) {
    const row = document.createElement("div");
    row.className = "word-row";
    row.dataset.word = key(item.word);
    row.dataset.open = "false";

    const main = document.createElement("button");
    main.type = "button";
    main.className = "word-main";
    main.setAttribute("aria-expanded", "false");
    const head = document.createElement("span");
    head.className = "word-head";
    const word = document.createElement("span"); word.className = "word"; word.textContent = item.word;
    const label = document.createElement("span"); label.className = "label"; label.textContent = item.label || "";
    const count = document.createElement("span"); count.className = "count"; count.textContent = `×${item.count}`;
    head.append(word, label, count);
    const meaning = document.createElement("span");
    meaning.className = "word-meaning";
    main.append(head, meaning);

    const more = document.createElement("div");
    more.className = "word-more";
    const context = document.createElement("div");
    context.className = "word-context";
    context.append(document.createTextNode(cues[item.cueIndex]?.text || ""));
    const translated = document.createElement("em");
    translated.textContent = cues[item.cueIndex]?.translation || "";
    context.appendChild(translated);
    const minor = document.createElement("div");
    minor.className = "word-minor";
    for (const [action, text] of [["known", "I know this"], ["ignored", "Ignore"], ["seek", "Go to line"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.textContent = text;
      minor.appendChild(button);
    }
    more.append(context, minor);

    row.append(main, more);
    row._item = item;
    return row;
  }

  function paintRow(row) {
    const item = row._item;
    const entry = entryFor(item.word);
    const meaning = row.querySelector(".word-meaning");
    meaning.classList.toggle("is-pending", !entry.meaning && !entry.error);
    meaning.classList.toggle("is-error", Boolean(entry.error));
    meaning.textContent = entry.error || entry.meaning || "tap to look up";

    let action = row.querySelector(".word-save, .word-saved");
    const wanted = entry.saved ? "word-saved" : "word-save";
    if (!action || !action.classList.contains(wanted)) {
      action?.remove();
      action = document.createElement(entry.saved ? "span" : "button");
      action.className = wanted;
      if (!entry.saved) {
        action.type = "button";
        action.dataset.action = "save";
        action.setAttribute("aria-label", `Save ${item.word} to vocabulary`);
      }
      row.insertBefore(action, row.querySelector(".word-more"));
    }
    action.textContent = entry.saved ? "Saved ✓" : entry.status === "saving" ? "Saving…" : "Save";
    if (!entry.saved) action.disabled = entry.status === "saving";
  }

  function render(target, data) {
    host = target;
    cues = data.cues || [];
    video = { id: data.videoId, title: data.videoTitle };
    const words = data.words || [];

    if (!words.length) {
      signature = "";
      state.clear();
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = data.hasCaptions
        ? "Nothing left to study in this video."
        : "Waiting for captions…";
      host.replaceChildren(empty);
      return;
    }

    const next = `${data.videoId}|${words.map((item) => item.word).join(",")}`;
    if (next !== signature) {
      signature = next;
      state.clear();
      const fragment = document.createDocumentFragment();
      const heading = document.createElement("div");
      heading.className = "word-list-head";
      const title = document.createElement("b"); title.textContent = "Words in this video";
      const total = document.createElement("span"); total.textContent = `${words.length} found`;
      heading.append(title, total);
      fragment.appendChild(heading);
      for (const item of words) fragment.appendChild(buildRow(item));
      host.replaceChildren(fragment);
      peek(words).then(() => {
        // A late peek must not repaint a list the user has since navigated away
        // from, which would show one video's meanings against another's words.
        if (signature === next) { paint(); transport.onChange?.(); }
      });
    }
    paint();
  }

  function paint() {
    if (!host) return;
    for (const row of host.querySelectorAll(".word-row")) paintRow(row);
  }

  document.addEventListener("click", async (event) => {
    const row = event.target.closest(".word-row");
    if (!row || !host?.contains(row)) return;
    const item = row._item;

    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "save") { await save(item); paint(); return; }
    if (action?.dataset.action === "known" || action?.dataset.action === "ignored") {
      await setWordState(item.word, action.dataset.action);
      return;
    }
    if (action?.dataset.action === "seek") {
      transport.send?.({ type: "seek-to-cue", index: item.cueIndex });
      return;
    }

    const main = event.target.closest(".word-main");
    if (!main) return;
    const open = row.dataset.open === "true";
    row.dataset.open = open ? "false" : "true";
    main.setAttribute("aria-expanded", String(!open));
    if (open || entryFor(item.word).meaning) return;
    await resolveMeaning(item);
    paintRow(row);
  });

  globalThis.DualSubWordList = Object.freeze({ render, connect, addableCount, refreshSaved });
})();
