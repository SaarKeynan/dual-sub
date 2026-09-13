const fs = require("fs");
const path = require("path");
const readline = require("readline");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = process.argv[2] || path.join(projectRoot, "vendor", "wiktionary", "kaikki-french.jsonl");
const outputPath = process.argv[3] || path.join(projectRoot, "vendor", "wiktionary", "french-english.txt");
// Fourth argument overrides the lexicon to intersect with; an empty string
// disables the intersection, which the build test uses to isolate the other
// filters. Defaults to the shipped Lexique index.
const lexicalInfoPath = process.argv[4] === undefined
  ? path.join(projectRoot, "vendor", "lexique", "french-lexical-info.txt")
  : process.argv[4];

// Wiktionary names parts of speech its own way. Map onto the labels
// language/french.js already produces, so a reading and a sense compare directly.
const PARTS = new Map([
  ["noun", "noun"], ["verb", "verb"], ["adj", "adjective"], ["adv", "adverb"],
  ["pron", "pronoun"], ["det", "determiner"], ["article", "determiner"],
  ["prep", "preposition"], ["conj", "conjunction"], ["intj", "interjection"]
]);
// A sense a learner will not meet in a subtitle, and which would crowd out one
// they will. "name" is excluded as a part of speech entirely. "form-of" senses
// are grammar notes ("feminine singular of armé", "inflection of livrer:"),
// not meanings: the content script already sends the lemma for inflected
// forms, and the lemma's own entry carries the real senses.
const DROP_TAGS = new Set(["obsolete", "archaic", "rare", "dated", "form-of"]);
const MAX_SENSES = 3;
const MAX_PARTS = 3;
const MAX_SENSE_LENGTH = 60;
const SIZE_BUDGET = 6 * 1024 * 1024;

// Only lemmas Lexique knows: it removes Wiktionary's long tail of forms that
// never occur in speech, and guarantees every lemma is one the morphology can
// produce from a surface form. Read as text, the way the runtime reads it.
function lexiqueLemmas() {
  const text = fs.readFileSync(lexicalInfoPath, "utf8");
  const known = new Set();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    known.add(line.slice(0, tab));
    const value = JSON.parse(line.slice(tab + 1));
    if (value[0]) known.add(value[0]);
  }
  return known;
}

function cleanGloss(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, MAX_SENSE_LENGTH);
}

function genderOf(tags) {
  if (tags.includes("feminine")) return "f";
  if (tags.includes("masculine")) return "m";
  return "";
}

(async () => {
  const known = lexicalInfoPath && fs.existsSync(lexicalInfoPath) ? lexiqueLemmas() : null;
  const collected = new Map();
  const input = readline.createInterface({ input: fs.createReadStream(sourcePath), crlfDelay: Infinity });

  for await (const line of input) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_error) { continue; }
    if (entry.lang_code !== "fr") continue;
    const pos = PARTS.get(entry.pos);
    if (!pos) continue;
    const word = String(entry.word || "");
    if (!word || (known && !known.has(word))) continue;

    const senses = [];
    // Real kaikki entries carry no gender on entry.tags at all; it lives on
    // the tags of the senses that were kept. Take the first one found.
    let senseGender = "";
    for (const sense of entry.senses || []) {
      const tags = sense.tags || [];
      if (tags.some((tag) => DROP_TAGS.has(tag))) continue;
      if (!senseGender) senseGender = genderOf(tags);
      for (const gloss of sense.glosses || []) {
        const cleaned = cleanGloss(gloss);
        if (cleaned && !senses.includes(cleaned)) senses.push(cleaned);
      }
    }
    if (!senses.length) continue;

    const parts = collected.get(word) || [];
    const gender = genderOf(entry.tags || []) || senseGender;
    parts.push({ pos, ...(gender ? { gender } : {}), senses: senses.slice(0, MAX_SENSES) });
    collected.set(word, parts);
  }

  const lines = Array.from(collected)
    .map(([word, parts]) => [word, JSON.stringify(parts.slice(0, MAX_PARTS))])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([word, value]) => word + "\t" + value);

  for (let position = 1; position < lines.length; position++) {
    if (!(lines[position - 1] < lines[position])) throw new Error(`output is not sorted at line ${position}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"));
  const bytes = fs.statSync(outputPath).size;
  if (bytes > SIZE_BUDGET && sourcePath.includes("kaikki-french")) {
    throw new Error(`output is ${bytes} bytes, over the ${SIZE_BUDGET} budget`);
  }
  console.log(JSON.stringify({ lemmas: lines.length, bytes }, null, 2));
})();
