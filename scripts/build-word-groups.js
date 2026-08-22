const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(projectRoot, "vendor", "lexique", "Lexique383.tsv");
const outputPath = process.argv[3] || path.join(projectRoot, "vendor", "lexique", "french-word-groups.json");
const groupCodes = new Map([
  ["NOM", "n"], ["VER", "v"], ["AUX", "v"], ["ADJ", "j"], ["ADV", "r"],
  ["PRO", "p"], ["DET", "d"], ["ART", "d"], ["PRE", "s"], ["CON", "c"],
  ["ONO", "i"], ["INT", "i"]
]);

const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/u);
const headers = lines.shift().split("\t");
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
const entries = new Map();
const categoryCounts = new Map();

for (const line of lines) {
  if (!line) continue;
  const cells = line.split("\t");
  const word = String(cells[column.ortho] || "").trim().toLocaleLowerCase("fr").normalize("NFC");
  const rawCategory = String(cells[column.cgram] || "").trim().toUpperCase();
  const group = groupCodes.get(rawCategory);
  if (!word || !group || !/^[\p{L}][\p{L}'\u2019-]*$/u.test(word)) continue;
  const frequency = Number(cells[column.freqfilms2] || 0) + Number(cells[column.freqlivres] || 0);
  const scores = entries.get(word) || new Map();
  scores.set(group, Math.max(scores.get(group) || 0, Number.isFinite(frequency) ? frequency : 0));
  entries.set(word, scores);
  categoryCounts.set(rawCategory, (categoryCounts.get(rawCategory) || 0) + 1);
}

const compact = {};
for (const [word, scores] of Array.from(entries).sort(([left], [right]) => left.localeCompare(right, "fr"))) {
  compact[word] = Array.from(scores)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([group]) => group)
    .join("");
}

fs.writeFileSync(outputPath, JSON.stringify(compact));
console.log(JSON.stringify({
  words: Object.keys(compact).length,
  bytes: fs.statSync(outputPath).size,
  categories: Object.fromEntries(Array.from(categoryCounts).sort())
}, null, 2));
