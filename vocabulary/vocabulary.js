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
  actions.append(review, remove);
  card.appendChild(actions);
  return card;
}

function filteredEntries() {
  const query = element("search").value.trim().toLocaleLowerCase();
  const filter = element("filter").value;
  const result = entries.filter((entry) => {
    const searchable = [entry.sourceText, entry.translatedText, entry.sentence, entry.sentenceTranslation, entry.videoTitle]
      .join(" ").toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
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
  render();
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
  element("revealAnswer").hidden = false;
  element("ratingButtons").hidden = true;
}

function revealAnswer() {
  answerVisible = true;
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
  return `"${String(value || "").replace(/"/g, '""')}"`;
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
  const header = ["French", "English", "French sentence", "English sentence", "Video", "Timestamp seconds", "Encounters", "Level"];
  const rows = entries.map((entry) => [
    entry.sourceText, entry.translatedText, entry.sentence, entry.sentenceTranslation,
    entry.videoTitle, Math.floor((entry.timeMs || 0) / 1000), entry.encounters || 1, entry.stage || 0
  ]);
  downloadFile("dualsub-vocabulary.csv", "text/csv;charset=utf-8", [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

element("search").addEventListener("input", render);
element("filter").addEventListener("change", render);
element("sort").addEventListener("change", render);
element("reviewButton").addEventListener("click", () => {
  const due = entries.filter(isDue);
  showReview((due.length ? due : entries).map((entry) => entry.id));
});
element("exportCsv").addEventListener("click", exportCsv);
element("exportJson").addEventListener("click", () => {
  downloadFile("dualsub-vocabulary-backup.json", "application/json", JSON.stringify({ version: 1, exportedAt: Date.now(), entries }, null, 2));
});
element("wordList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  const card = event.target.closest(".word-card");
  if (!button || !card) return;
  if (button.dataset.action === "review") {
    showReview([card.dataset.id]);
  } else if (button.dataset.action === "remove") {
    const entry = entries.find((item) => item.id === card.dataset.id);
    if (!entry || !confirm(`Remove “${entry.sourceText}” from your vocabulary?`)) return;
    await browser.runtime.sendMessage({ type: "remove-vocabulary", id: card.dataset.id });
    await loadEntries();
  }
});
element("closeReview").addEventListener("click", closeReview);
element("revealAnswer").addEventListener("click", revealAnswer);
element("ratingButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating]");
  if (button) rateCurrent(button.dataset.rating);
});
document.addEventListener("keydown", (event) => {
  if (element("reviewModal").hidden) return;
  if (event.key === "Escape") closeReview();
  else if (event.code === "Space" && !answerVisible) { event.preventDefault(); revealAnswer(); }
  else if (answerVisible && ["1", "2", "3"].includes(event.key)) {
    rateCurrent({ "1": "again", "2": "hard", "3": "good" }[event.key]);
  }
});

loadEntries().catch((error) => {
  element("emptyState").hidden = false;
  element("emptyState").querySelector("h2").textContent = "Could not load vocabulary";
  element("emptyState").querySelector("p").textContent = error.message;
});
