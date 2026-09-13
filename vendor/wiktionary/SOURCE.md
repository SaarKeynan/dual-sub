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

Source: pending first download — see Task 6, step 1. The per-language file
was expected at `https://kaikki.org/dictionary/French/`, but that path is
marked deprecated on kaikki.org and may be gone by the time it is fetched; if
so, the English-edition raw dump at `https://kaikki.org/dictionary/rawdata.html`
is used instead, since the build filters by `lang_code` either way. Record the
exact URL that served the file here once it has been downloaded. Do not guess
it.

Extract date: pending first download — see Task 6, step 1.

The build applies these filters and limits, in order:

- Only entries with `lang_code: "fr"` are kept; every other language, including
  the multilingual `name` part of speech, is dropped.
- Wiktionary's own part-of-speech codes are mapped onto the labels
  `language/french.js` already produces (`noun`, `verb`, `adjective`, `adverb`,
  `pronoun`, `determiner`, `preposition`, `conjunction`, `interjection`); an
  entry whose part of speech has no mapping, such as a proper noun (`name`), is
  dropped entirely.
- A sense tagged `obsolete`, `archaic`, `rare`, or `dated` is dropped; a learner
  will not meet it in a subtitle, and it would crowd out a sense they will.
- The result is intersected with the lemmas in
  `vendor/lexique/french-lexical-info.txt`: this removes Wiktionary's long tail
  of forms that never occur in speech, and guarantees every surviving lemma is
  one the local morphology can produce from a surface form.
- At most three senses are kept per part of speech, at most three parts of
  speech are kept per lemma, and each sense is truncated to 60 characters.

Wiktionary's text content, and therefore this derivative, is dual-licensed
under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) and the
[GNU Free Documentation License (GFDL)](https://www.gnu.org/licenses/fdl-1.3.html).
This derivative is distributed under CC BY-SA 4.0. The license text is included
as `LICENSE-CC-BY-SA-4.0`.

The extract is produced by wiktextract, cited as:

> Ylonen, Tatu (2022). "Wiktextract: Wiktionary as Machine-Readable Structured
> Data", Proceedings of the 13th Conference on Language Resources and
> Evaluation (LREC 2022), pp. 1317-1325, Marseille, 20-25 June 2022.

Generated derivative SHA-256: pending first build

Project and documentation: https://kaikki.org/ and
https://github.com/tatuylonen/wiktextract
