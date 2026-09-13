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
  `pronoun`, `determiner`, `preposition`, `conjunction`, `interjection`); an
  entry whose part of speech has no mapping, such as a proper noun (`name`), is
  dropped entirely.
- A sense tagged `obsolete`, `archaic`, `rare`, or `dated` is dropped; a learner
  will not meet it in a subtitle, and it would crowd out a sense they will.
- A sense tagged `form-of` is dropped: it is a grammar note such as "feminine
  singular of armé" or "inflection of livrer:", not a meaning. The content
  script already sends the lemma for an inflected surface form, and the
  lemma's own entry carries the real senses. A part of speech left with no
  senses after this filtering is not emitted at all.
- Gender is taken from `entry.tags` when present, else from the tags of the
  senses that survived the filters above (the first `masculine`/`feminine`
  found); real kaikki entries carry no gender on `entry.tags` at all, so this
  fallback is what actually supplies it. It covers all but 0.12% of nouns
  (17 of 14,196) in the shipped build, so `head_templates` gender is not
  consulted.
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

Generated derivative SHA-256: 3D0FDD074AB6F5909722F6AABA50B27C694EABF0592E3A9F2E2E0AA83AAF4F9B

`french-english.txt`: 21,211 lemmas, 1,915,665 bytes.

Project and documentation: https://kaikki.org/ and
https://github.com/tatuylonen/wiktextract
