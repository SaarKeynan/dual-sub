# Lexique 3.83 grammatical-category derivative

`french-word-groups.json` and `french-lexical-info.json` are modified, reduced
resources generated from Lexique 3.83's `Lexique383.tsv` with
`scripts/build-word-groups.js`.

The derivative retains only normalized written word forms and their grammatical
categories, ordered by the source database's film and book frequency fields.
Category codes are compacted as follows: noun `n`, verb or
auxiliary `v`, adjective `j`, adverb `r`, pronoun `p`, determiner `d`,
preposition `s`, conjunction `c`, and interjection/onomatopoeia `i`.

Lexique subcategorizes closed classes in its `cgram` column (`ART:def`,
`PRO:per`, `ADJ:dem`), and it has no `DET` category at all. The build reads the
subcategory first and then its prefix, so demonstrative, possessive, indefinite,
and interrogative `ADJ` rows become determiners while `ADJ:num` stays
adjectival, matching the traditional French *adjectif numéral*.

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

Generated derivative SHA-256: `80B413C17EDF87E2535D21E3F17EDB112AA13BECCFAA4F46E69263CCD55E3429`

Generated lexical-info derivative SHA-256: `E90E77123882CBBDF1D654FF432A06A436FBF0DB072059FA28161B03CA0B2F11`

Project and documentation: https://www.lexique.org/
