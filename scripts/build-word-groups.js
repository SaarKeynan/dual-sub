const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(projectRoot, "vendor", "lexique", "Lexique383.tsv");
const outputPath = process.argv[3] || path.join(projectRoot, "vendor", "lexique", "french-word-groups.txt");
const infoOutputPath = process.argv[4] || path.join(projectRoot, "vendor", "lexique", "french-lexical-info.txt");

// Shipped as sorted "key\tvalue" lines rather than JSON. Parsed into objects
// these indexes cost four to five times their file size in heap, in every
// YouTube tab, because the cost is the 175,000 JavaScript strings and object
// slots rather than the data. The runtime holds the text as one string with a
// Uint32Array of line offsets and binary-searches it.
//
// That search compares with <, so the sort here must use code-unit order too.
// localeCompare("fr") orders differently, and a file sorted that way would lose
// lookups quietly instead of failing.
const byCodeUnit = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function writeIndex(file, entries) {
  const lines = entries
    .slice()
    .sort(([left], [right]) => byCodeUnit(left, right))
    .map(([key, value]) => key + "\t" + value);
  for (let position = 1; position < lines.length; position++) {
    if (!(lines[position - 1] < lines[position])) throw new Error(`${file} is not sorted at line ${position}`);
  }
  fs.writeFileSync(file, lines.join("\n"));
  return lines.length;
}
const groupCodes = new Map([
  ["NOM", "n"], ["VER", "v"], ["AUX", "v"], ["ADJ", "j"], ["ADV", "r"],
  ["PRO", "p"], ["DET", "d"], ["ART", "d"], ["PRE", "s"], ["CON", "c"],
  ["ONO", "i"], ["INT", "i"]
]);
// Lexique 3.83 has no DET category. Demonstrative, possessive, indefinite and
// interrogative determiners are filed as ADJ subcategories, so they need an
// explicit mapping; ADJ:num stays adjectival because the subcategory also
// collects ordinary plural adjectives.
const subcategoryGroupCodes = new Map([
  ["ADJ:DEM", "d"], ["ADJ:POS", "d"], ["ADJ:IND", "d"], ["ADJ:INT", "d"]
]);

const lines = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/u);
const headers = lines.shift().split("\t");
const column = Object.fromEntries(headers.map((name, index) => [name, index]));
const entries = new Map();
const categoryCounts = new Map();
const lexicalInfo = new Map();

for (const line of lines) {
  if (!line) continue;
  const cells = line.split("\t");
  const word = String(cells[column.ortho] || "").trim().toLocaleLowerCase("fr").normalize("NFC");
  // Lexique subcategorizes closed classes as ART:def, PRO:per, ADJ:dem and so
  // on. Matching the whole field silently discards every article, pronoun and
  // demonstrative, so consult the subcategory first and then its prefix.
  const rawCategory = String(cells[column.cgram] || "").trim().toUpperCase();
  const group = subcategoryGroupCodes.get(rawCategory) || groupCodes.get(rawCategory.split(":")[0]);
  if (!word || !group || !/^[\p{L}][\p{L}'\u2019-]*$/u.test(word)) continue;
  const frequency = Number(cells[column.freqfilms2] || 0) + Number(cells[column.freqlivres] || 0);
  const scores = entries.get(word) || new Map();
  scores.set(group, Math.max(scores.get(group) || 0, Number.isFinite(frequency) ? frequency : 0));
  entries.set(word, scores);
  categoryCounts.set(rawCategory, (categoryCounts.get(rawCategory) || 0) + 1);
  const existingInfo = lexicalInfo.get(word);
  if (!existingInfo || frequency > existingInfo.frequency) {
    lexicalInfo.set(word, {
      lemma: String(cells[column.lemme] || word).trim().toLocaleLowerCase("fr").normalize("NFC"),
      phonetic: String(cells[column.phon] || "").trim(),
      gender: String(cells[column.genre] || "").trim().toLocaleLowerCase(),
      number: String(cells[column.nombre] || "").trim().toLocaleLowerCase(),
      syllables: Math.max(0, Number(cells[column.nbsyll] || 0)),
      frequency: Number.isFinite(frequency) ? Math.round(frequency * 100) / 100 : 0
    });
  }
}

const compact = {};
for (const [word, scores] of Array.from(entries).sort(([left], [right]) => left.localeCompare(right, "fr"))) {
  compact[word] = Array.from(scores)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([group]) => group)
    .join("");
}

const wordCount = writeIndex(outputPath, Object.entries(compact));
const infoCount = writeIndex(infoOutputPath, Array.from(lexicalInfo)
  .sort((left, right) => right[1].frequency - left[1].frequency)
  .slice(0, 50_000)
  .map(([word, info]) => [word, JSON.stringify([info.lemma, info.phonetic, info.gender, info.number, info.syllables, info.frequency])]));
console.log(JSON.stringify({
  words: wordCount,
  bytes: fs.statSync(outputPath).size,
  lexicalInfoWords: infoCount,
  lexicalInfoBytes: fs.statSync(infoOutputPath).size,
  categories: Object.fromEntries(Array.from(categoryCounts).sort())
}, null, 2));
