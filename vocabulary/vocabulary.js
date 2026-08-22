let entries = [];
let reviewQueue = [];
let reviewIndex = 0;
let answerVisible = false;

const element = (id) => document.getElementById(id);
const dayMs = 86400000;

function isDue(entry) {
  return (Number(entry.dueAt) || 0) <= Date.now();
}

function videoUrl(entry) {
  if (!entry.videoId) return "";
  return `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}&t=${Math.max(0, Math.floor((Number(entry.timeMs) || 0) / 1000))}s`;
}

function formatDate(value) {
  if (!value) return "Not reviewed";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function levelLabel(entry) {
  const stage = Number(entry.stage) || 0;
  if (stage >= 5) return "Well learned";
  if (stage >= 2) return `Level ${stage}`;
  return "New";
}

function createTextElement(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text || "";
  return node;
}

function createWordCard(entry) {
  const card = document.createElement("article");
  card.className = "word-card";
  card.dataset.id = entry.id;
  card.appendChild(createTextElement("div", "word-source", entry.sourceText));
  card.appendChild(createTextElement("div", "word-translation", entry.translatedText));

  const context = document.createElement("div");
  context.className = "word-context";
  context.appendChild(createTextElement("div", "sentence", entry.sentence || "No sentence saved"));
  if (entry.sentenceTranslation) {
    context.appendChild(createTextElement("div", "sentence-translation", entry.sentenceTranslation));
  }
  if (entry.notes) context.appendChild(createTextElement("div", "word-notes", entry.notes));
  const meta = document.createElement("div");
  meta.className = "meta";
  const level = createTextElement("span", "level", levelLabel(entry));
  meta.appendChild(level);
  meta.appendChild(createTextElement("span", "", `${entry.encounters || 1} encounter${entry.encounters === 1 ? "" : "s"}`));
  meta.appendChild(createTextElement("span", "", isDue(entry) ? "Due now" : `Due ${formatDate(entry.dueAt)}`));
  const url = videoUrl(entry);
  if (url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = entry.videoTitle ? `Open “${entry.videoTitle}”` : "Open video";
    meta.appendChild(link);
  }
  context.appendChild(meta);
  card.appendChild(context);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const review = document.createElement("button");
  review.type = "button";
  review.dataset.action = "review";
  review.textContent = "Review";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.action = "remove";
  remove.className = "danger";
  remove.textContent = "Remove";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.dataset.action = "edit";
  edit.textContent = "Edit";
  actions.append(review, edit, remove);
  card.appendChild(actions);
  return card;
}

function filteredEntries() {
  const query = element("search").value.trim().toLocaleLowerCase();
  const filter = element("filter").value;
  const videoFilter = element("videoFilter").value;
  const result = entries.filter((entry) => {
    const searchable = [entry.sourceText, entry.translatedText, entry.sentence, entry.sentenceTranslation, entry.videoTitle, entry.notes]
      .join(" ").toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (videoFilter !== "all" && entry.videoId !== videoFilter) return false;
    if (filter === "due") return isDue(entry);
    if (filter === "learning") return (Number(entry.stage) || 0) < 5;
    if (filter === "mastered") return (Number(entry.stage) || 0) >= 5;
    return true;
  });
  const sort = element("sort").value;
  result.sort((left, right) => {
    if (sort === "alphabetical") return left.sourceText.localeCompare(right.sourceText, left.sourceLanguage || "fr");
    if (sort === "due") return (left.dueAt || 0) - (right.dueAt || 0);
    if (sort === "encounters") return (right.encounters || 1) - (left.encounters || 1);
    return (right.createdAt || 0) - (left.createdAt || 0);
  });
  return result;
}

function render() {
  const list = element("wordList");
  const visible = filteredEntries();
  list.replaceChildren(...visible.map(createWordCard));
  element("emptyState").hidden = Boolean(visible.length);
  const due = entries.filter(isDue).length;
  element("totalCount").textContent = entries.length;
  element("dueCount").textContent = due;
  element("learningCount").textContent = entries.filter((entry) => (Number(entry.stage) || 0) < 5).length;
  element("masteredCount").textContent = entries.filter((entry) => (Number(entry.stage) || 0) >= 5).length;
  element("sourceCount").textContent = new Set(entries.map((entry) => entry.videoId).filter(Boolean)).size;
  element("reviewButton").disabled = !entries.length;
}

async function loadEntries() {
  const response = await browser.runtime.sendMessage({ type: "get-vocabulary" });
  if (!response?.ok) throw new Error(response?.error || "Could not load vocabulary.");
  entries = response.entries;
  updateVideoFilter();
  render();
}

function updateVideoFilter() {
  const select = element("videoFilter");
  const selected = select.value;
  const videos = new Map();
  for (const entry of entries) {
    if (entry.videoId && !videos.has(entry.videoId)) videos.set(entry.videoId, entry.videoTitle || entry.videoId);
  }
  const options = [new Option("All videos", "all")];
  for (const [id, title] of Array.from(videos).sort((left, right) => left[1].localeCompare(right[1]))) {
    options.push(new Option(title, id));
  }
  select.replaceChildren(...options);
  select.value = videos.has(selected) ? selected : "all";
}

function showReview(entryIds) {
  reviewQueue = entryIds.map((id) => entries.find((entry) => entry.id === id)).filter(Boolean);
  reviewIndex = 0;
  if (!reviewQueue.length) return;
  element("reviewModal").hidden = false;
  renderReviewCard();
}

function renderReviewCard() {
  const entry = reviewQueue[reviewIndex];
  if (!entry) {
    closeReview();
    loadEntries();
    return;
  }
  answerVisible = false;
  element("reviewProgress").textContent = `${reviewIndex + 1} / ${reviewQueue.length}`;
  element("reviewTitle").textContent = entry.sourceText;
  element("reviewSentence").textContent = entry.sentence || "";
  element("reviewTranslation").textContent = entry.translatedText;
  element("reviewSentenceTranslation").textContent = entry.sentenceTranslation || "";
  element("reviewAnswer").hidden = true;
  element("typedAnswer").value = "";
  element("typedAnswer").disabled = false;
  element("answerFeedback").hidden = true;
  element("answerFeedback").classList.remove("is-correct");
  element("revealAnswer").hidden = false;
  element("ratingButtons").hidden = true;
}

function revealAnswer() {
  answerVisible = true;
  const entry = reviewQueue[reviewIndex];
  const typed = element("typedAnswer").value.trim();
  if (typed && entry) {
    const normalize = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLocaleLowerCase();
    const correct = normalize(typed) === normalize(entry.translatedText);
    element("answerFeedback").textContent = correct ? "Exact match" : "Compare your answer with the saved translation below";
    element("answerFeedback").classList.toggle("is-correct", correct);
    element("answerFeedback").hidden = false;
  }
  element("typedAnswer").disabled = true;
  element("reviewAnswer").hidden = false;
  element("revealAnswer").hidden = true;
  element("ratingButtons").hidden = false;
}

async function rateCurrent(rating) {
  const entry = reviewQueue[reviewIndex];
  if (!entry) return;
  await browser.runtime.sendMessage({ type: "review-vocabulary", id: entry.id, rating });
  reviewIndex += 1;
  renderReviewCard();
}

function closeReview() {
  element("reviewModal").hidden = true;
  reviewQueue = [];
}

function csvCell(value) {
  let clean = String(value || "");
  if (/^[=+\-@]/.test(clean)) clean = `'${clean}`;
  return `"${clean.replace(/"/g, '""')}"`;
}

function downloadFile(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  const header = ["French", "English", "French sentence", "English sentence", "Notes", "Video", "Timestamp seconds", "Encounters", "Level"];
  const rows = entries.map((entry) => [
    entry.sourceText, entry.translatedText, entry.sentence, entry.sentenceTranslation, entry.notes,
    entry.videoTitle, Math.floor((entry.timeMs || 0) / 1000), entry.encounters || 1, entry.stage || 0
  ]);
  downloadFile("dualsub-vocabulary.csv", "text/csv;charset=utf-8", [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

element("search").addEventListener("input", render);
element("filter").addEventListener("change", render);
element("videoFilter").addEventListener("change", render);
element("sort").addEventListener("change", render);
element("reviewButton").addEventListener("click", () => {
  const due = entries.filter(isDue);
  showReview((due.length ? due : entries).map((entry) => entry.id));
});
element("exportCsv").addEventListener("click", exportCsv);
element("exportJson").addEventListener("click", () => {
  downloadFile("dualsub-vocabulary-backup.json", "application/json", JSON.stringify({ version: 1, exportedAt: Date.now(), entries }, null, 2));
});
element("importJson").addEventListener("click", () => element("importFile").click());
element("importFile").addEventListener("change", async () => {
  const file = element("importFile").files?.[0];
  element("importFile").value = "";
  if (!file) return;
  if (file.size > 2_000_000) {
    alert("That backup is larger than the 2 MB import limit.");
    return;
  }
  try {
    const payload = JSON.parse(await file.text());
    const importedEntries = Array.isArray(payload) ? payload : payload.entries;
    const response = await browser.runtime.sendMessage({ type: "import-vocabulary", entries: importedEntries });
    if (!response?.ok) throw new Error(response?.error || "Import failed.");
    await loadEntries();
    alert(`Vocabulary restored: ${response.imported} added, ${response.updated} updated.`);
  } catch (error) {
    alert(`Could not restore backup: ${error.message}`);
  }
});
element("wordList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  const card = event.target.closest(".word-card");
  if (!button || !card) return;
    if (button.dataset.action === "review") {
    showReview([card.dataset.id]);
  } else if (button.dataset.action === "edit") {
    const entry = entries.find((item) => item.id === card.dataset.id);
    if (!entry) return;
    const translatedText = prompt(`Edit the English translation for “${entry.sourceText}”:`, entry.translatedText);
    if (translatedText === null) return;
    const notes = prompt("Add a personal note (usage, gender, mnemonic, etc.):", entry.notes || "");
    if (notes === null) return;
    const response = await browser.runtime.sendMessage({
      type: "update-vocabulary",
      id: entry.id,
      updates: { translatedText, notes }
    });
    if (!response?.ok) alert(response?.error || "Could not update this word.");
    await loadEntries();
  } else if (button.dataset.action === "remove") {
    const entry = entries.find((item) => item.id === card.dataset.id);
    if (!entry || !confirm(`Remove “${entry.sourceText}” from your vocabulary?`)) return;
    await browser.runtime.sendMessage({ type: "remove-vocabulary", id: card.dataset.id });
    await loadEntries();
  }
});
element("closeReview").addEventListener("click", closeReview);
element("revealAnswer").addEventListener("click", revealAnswer);
element("speakReview").addEventListener("click", () => {
  const entry = reviewQueue[reviewIndex];
  if (!entry || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(entry.sourceText);
  utterance.lang = entry.sourceLanguage === "fr" ? "fr-FR" : (entry.sourceLanguage || "fr");
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
});
element("ratingButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (button) rateCurrent(button.dataset.rating);
});
document.addEventListener("keydown", (event) => {
  if (element("reviewModal").hidden) return;
  if (event.key === "Escape") closeReview();
  else if ((event.code === "Space" && event.target !== element("typedAnswer") || event.key === "Enter") && !answerVisible) { event.preventDefault(); revealAnswer(); }
  else if (answerVisible && ["1", "2", "3"].includes(event.key)) {
    rateCurrent({ "1": "again", "2": "hard", "3": "good" }[event.key]);
  }
});

loadEntries().catch((error) => {
  element("emptyState").hidden = false;
  element("emptyState").querySelector("h2").textContent = "Could not load vocabulary";
  element("emptyState").querySelector("p").textContent = error.message;
});
