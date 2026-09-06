# Lexique 3.83 grammatical-category derivative

`french-word-groups.json` and `french-lexical-info.json` are modified, reduced
resources generated from Lexique 3.83's `Lexique383.tsv` with
`scripts/build-word-groups.js`.

The derivative retains only normalized written word forms and their grammatical
categories, ordered by the source database's film and book frequency fields.
Category codes are compacted as follows: noun `n`, verb or
auxiliary `v`, adjective `j`, adverb `r`, pronoun `p`, determiner `d`,
preposition `s`, conjunction `c`, and interjection/onomatopoeia `i`.

The lexical-info derivative retains the 50,000 highest-frequency normalized
forms and only their lemma, Lexique phonological transcription, gender, number,
syllable count, and combined film/book frequency. Definitions and all other
source columns are omitted. DualSub converts the compact transcription to a
learner-facing IPA approximation locally.

Lexique is by Boris New, Christophe Pallier, and contributors and is distributed
under CC BY-SA 4.0. This modified derivative is distributed under the same
license. The license text is included as `LICENSE-CC-BY-SA-4.0`.

Source: http://www.lexique.org/databases/Lexique383/Lexique383.tsv

Source SHA-256: `637BA37A767A66679C48371D673ECE50CBF541B49A4E40E598963D4F3FBCE52B`

Generated derivative SHA-256: `CD8570B4D0EBB77D1FCBD9804EDCEC3C66190F00EF829BD96E49DD51E17013B0`

Generated lexical-info derivative SHA-256: `B092C329BC8DBF1965377D49A3F2BBED333F35D1EBD31A0C72D6397BA12DB2EC`

Project and documentation: https://www.lexique.org/
