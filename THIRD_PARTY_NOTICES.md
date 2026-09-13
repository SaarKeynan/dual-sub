# Third-party notices

## ablaut 0.7.0

DualSub includes a WebAssembly build of the `ablaut` morphology engine with a
French-only adapter exposing its existing reverse-analysis API.
`ablaut` is copyright its contributors and is distributed under MIT OR
Apache-2.0. Both license texts are included in `vendor/ablaut/`.

Source: https://github.com/ablaut-dev/ablaut

## Lefff 3.4 / french-verbs-lefff 3.4.0

DualSub includes a reduced list of 7,820 French infinitives derived from the
Lefff-based `french-verbs-lefff` resource. The transformation and source are
documented in `vendor/lefff/SOURCE.md`; the linguistic resource remains under
LGPL-LR, included as `vendor/lefff/LICENSE-LGPLLR`.

Lefff reference: Benoît Sagot, “The Lefff, a freely available and large-coverage
morphological and syntactic lexicon for French,” LREC 2010.

## Lexique 3.83

DualSub includes reduced grammatical-category and lexical-information indexes
derived from Lexique 3.83 by Boris New, Christophe Pallier, and contributors.
The transformation, source checksum, and retained fields are documented in
`vendor/lexique/SOURCE.md`. The derivative remains under CC BY-SA 4.0, included
as `vendor/lexique/LICENSE-CC-BY-SA-4.0`.

Project: https://www.lexique.org/

## Tesseract.js 7.0.0 and Tesseract.js Core

DualSub bundles the Tesseract.js worker, its SIMD LSTM WebAssembly core, and a
compact French trained-data package so optical character recognition runs
locally. Tesseract.js and Tesseract.js Core are distributed under the Apache
License 2.0; the French trained data is distributed by `@tesseract.js-data/fra`
under the MIT License and originates from the Tesseract tessdata project. The
license texts and the full component notice are included in
`vendor/tesseract/`.

Project: https://github.com/naptha/tesseract.js

## Wiktionary (kaikki.org / wiktextract)

DualSub includes a reduced, filtered French-English dictionary derived from an
English Wiktionary extract produced by the wiktextract project and published by
kaikki.org. The transformation, source, and checksum are documented in
`vendor/wiktionary/SOURCE.md`. Wiktionary's text content is dual-licensed under
CC BY-SA 4.0 and the GNU Free Documentation License; this derivative is
distributed under CC BY-SA 4.0, included as
`vendor/wiktionary/LICENSE-CC-BY-SA-4.0`.

wiktextract reference: Ylonen, Tatu (2022). "Wiktextract: Wiktionary as
Machine-Readable Structured Data," Proceedings of the 13th Conference on
Language Resources and Evaluation (LREC 2022), pp. 1317-1325, Marseille, 20-25
June 2022.

Project: https://kaikki.org/ and https://github.com/tatuylonen/wiktextract
