# Lexique 3.83 grammatical-category derivative

`french-word-groups.txt` and `french-lexical-info.txt` are modified, reduced
resources generated from Lexique 3.83's `Lexique383.tsv` with
`scripts/build-word-groups.js`.

Both are sorted `key<TAB>value` lines rather than JSON. Parsed into objects they
cost four to five times their file size in heap, in every YouTube tab, because
the cost is the 175,000 JavaScript strings and object slots rather than the
data. The runtime holds each file as one string with a `Uint32Array` of line
offsets and binary-searches it, which costs about the file size. The sort is
code-unit order, matching the `<` comparison the search uses; the build fails if
the output is not sorted that way.

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

Generated derivative SHA-256: `E6BBE2BEE951B382A894C129CE2DC51EF0F72DE0AA5FAB0880851EAA85C92069`

Generated lexical-info derivative SHA-256: `8FC89962C8DEB3A9429F928EE36594B71CCD03755949993B02B58300881F4819`

Project and documentation: https://www.lexique.org/
