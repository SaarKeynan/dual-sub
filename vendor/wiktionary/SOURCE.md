# Wiktionary (kaikki.org extract) French-English dictionary derivative

`french-english.txt` is a reduced, filtered derivative of a French-language
extract of English Wiktionary, produced by the
[wiktextract](https://github.com/tatuylonen/wiktextract) project and published
by [kaikki.org](https://kaikki.org/). It is generated from the raw kaikki
extract with `scripts/build-dictionary.js`, run as:

```
node scripts/build-dictionary.js
```

The raw extract itself is not committed; it is downloaded to
`vendor/wiktionary/kaikki-french.jsonl`, which `.gitignore` covers, and the
build script reads it from there by default.

Source: `https://kaikki.org/dictionary/French/kaikki.org-dictionary-French.jsonl`,
served with `Last-Modified: Wed, 09 Sep 2026 21:01:41 GMT`, fetched 2026-09-13.

Extract date: 2026-09-09 (the `Last-Modified` date of the served file).

The build applies these filters and limits, in order:

- Only entries with `lang_code: "fr"` are kept; every other language, including
  the multilingual `name` part of speech, is dropped.
- Wiktionary's own part-of-speech codes are mapped onto the labels
  `language/french.js` already produces (`noun`, `verb`, `adjective`, `adverb`,
  `pronoun`, `determiner`, `preposition`, `conjunction`, `interjection`);
  numerals (`num`) map to `adjective`, which is how `language/french.js`
  classifies `deux` and `vingt`. An entry whose part of speech has no mapping,
  such as a proper noun (`name`), is dropped entirely.
- A sense tagged `obsolete`, `archaic`, `rare`, or `dated` is dropped; a learner
  will not meet it in a subtitle, and it would crowd out a sense they will.
- A sense tagged `form-of` is dropped: it is a grammar note such as "feminine
  singular of armé" or "inflection of livrer:", not a meaning. The content
  script already sends the lemma for an inflected surface form, and the
  lemma's own entry carries the real senses.
- A sense tagged `alt-of`, `nonstandard`, or `misspelling` is dropped: it is a
  pointer such as "nonstandard spelling of œil", not a meaning. A part of
  speech left with no senses after this filtering is not emitted at all.
- Gender is taken from `entry.tags` when present, else from the tags of the
  senses that survived the filters above (the first `masculine`/`feminine`
  found); real kaikki entries carry no gender on `entry.tags` at all, so this
  fallback is what actually supplies it. It covers all but 0.09% of noun parts
  (13 of 13,730) in the shipped build, so `head_templates` gender is not
  consulted.
- The ligatures `œ`, `Œ`, `æ`, and `Æ` are folded to `oe`, `OE`, `ae`, and
  `AE`, both in the headword and in the Lexique set it is tested against, and
  keys are written folded. Wiktionary files the real entries under `cœur` and
  `œil` and keeps only nonstandard-spelling pointers under `coeur` and
  `oeil`, while Lexique spells `oe` throughout; without the fold the real
  entries were dropped and the pointers shipped. `dictionary.js` folds a
  looked-up word the same way.
- The result is intersected with the lemmas in
  `vendor/lexique/french-lexical-info.txt`: this removes Wiktionary's long tail
  of forms that never occur in speech, and guarantees every surviving lemma is
  one the local morphology can produce from a surface form.
- Entries that end up under the same key with the same part of speech and the
  same gender (or both without one) are merged, their senses concatenated in
  source order and deduplicated, before any cap applies. Different genders stay
  apart: the masculine `livre` (book) and the feminine `livre` (pound).
- At most three senses are kept per part of speech, at most four parts of
  speech are kept per lemma, and each sense is truncated to 60 characters.
  A fourth part keeps, for example, the pronoun reading of `tout` and `nul`;
  ten lemmas have one, costing 537 bytes.
- A build that intersects with a lexicon fails if its output exceeds 6 MB.

Wiktionary's text content, and therefore this derivative, is dual-licensed
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and the
[GNU Free Documentation License (GFDL)](https://www.gnu.org/licenses/fdl-1.3.html).
This derivative is distributed under CC BY-SA 4.0. The license text is included
as `LICENSE-CC-BY-SA-4.0`.

The extract is produced by wiktextract, cited as:

> Ylonen, Tatu (2022). "Wiktextract: Wiktionary as Machine-Readable Structured
> Data", Proceedings of the 13th Conference on Language Resources and
> Evaluation (LREC 2022), pp. 1317-1325, Marseille, 20-25 June 2022.

Generated derivative SHA-256: F5A21D1D91F78FEB6C1424E6E961EF3989668BF756DDFCF454C5BF65841E50AE

`dictionary.js` sets `DATA_VERSION` to the first 16 hex characters of this
hash, lowercase; `tests/smoke.test.js` checks both against the shipped file.

`french-english.txt`: 21,157 lemmas, 1,885,462 bytes.

Project and documentation: https://kaikki.org/ and
https://github.com/tatuylonen/wiktextract
