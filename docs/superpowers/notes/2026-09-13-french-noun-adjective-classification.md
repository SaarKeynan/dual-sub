# French noun/adjective classification: attempts, results, and why they were reverted

Status: **paused and rolled back** on branch `local-dictionary` (September 2026).
This note is for whoever picks the work up again. It records what was tried,
what each attempt fixed and broke with the code cause, how it was measured, and
where to start next time. Everything named here is still reachable in git
history: `git show <sha>`.

## The problem

The bundled Wiktionary dictionary answers a hovered word from the sense whose
part of speech matches the word's classified group:

- `language/french.js` `classifyWord()` and `lookupReading()` give the group;
- `content.js` `dictionaryCandidatesFor()` builds the headword candidates;
- `dictionary.js` answers from the first candidate with a matching part, and
  returns `null` when the group is a real part of speech that no candidate has.

After a nominal determiner, `classifyWord()`'s nominal branch picks whichever of
noun or adjective Lexique lists first (`groups.find(noun|adjective)`). For most
noun/adjective homographs that is the adjective, so:

- nouns are labelled adjectives: `la nouvelle` (the news), `une donnée`, `la
  marine`;
- nominalised adjectives stay adjectives: `les jeunes`, `la petite`, `le rouge`.

At the baseline these mostly **miss**: the adjective candidate has no entry, so
an engine answers under the wrong label. The attempts below tried to fix the
label, and two candidate-list changes (db0567f, 4cedd9a) made the dictionary
answer the adjective sense for them. Once a label is wrong, those candidate
changes turn a miss into a confident wrong meaning ("la marine" → "maritime").

The baseline for every measurement is **349d8c1**, the end of the reviewed
dictionary feature. Rolled back at: 662f878 and 854956f (reverts), with
fc38864 restoring one separable piece.

## What was kept

These are independent of the noun/adjective heuristics and stay on the branch:

| SHA | What it does | Where |
|---|---|---|
| 8dddd12 | `plus`/`moins` after a determiner that modifies the next word (adjective, adverb or participle) is the adverb: `le plus grand`, `le moins cher`; `c'est un plus` stays a noun | `french.js` `modifiesFollowingWord`, called from `analyzeWord` |
| 7fbca9a | Infinitive line, saved lemma, evidence requests, Wiktionary link and sidebar label follow the verb classification, so `plus tard` no longer shows "Infinitive: plaire" and `tu` no longer shows `taire` | `content.js` `showSelectionCard`, hover prefetch, `describeStudyWords` |
| 5937e51, e76f3f0, d0b54b2 | A failed or blocked dictionary database open is retried | `dictionary.js` `openDatabase` |
| 81a3514 | `œ`/`æ` folded before every Lexique lookup: `le cœur`, `des œufs` | `french.js` `indexValue` |
| bef30e2 (intent) | A Lexique lemma that Lexique knows only as a verb is not a candidate for a non-verb reading (`morte` → `mourir`) | `content.js` `dictionaryCandidatesFor` |
| 7fe1c1d | Vocabulary grouping fills a lemma only for words read as verbs | `vocabulary/vocabulary.js` |
| e6d7292 | `au moins`, `du moins`, `le moins du monde`, `deux au plus` are adverbs | `french.js` `fixedAdverbialExpression` |
| 55ddbfa, 84cd0b8 | `entre`/`contre` are verbs only after `je/j'/tu/il/on` (clitics between), or an ungoverned `elle`; `nous contre eux` stays a preposition | `french.js` `prepositionVerbAfterSubject` |
| fc38864 (from f9cc7a4) | `lookupReading` adds a subject pronoun only for a verb reading, so `contre le mur` is no longer sent to the engine as "je contre" | `french.js` `lookupReading` |
| from 31f1420, revised | The context corpus: 431 phrases with their target readings, with failing rows marked `knownWrong` | `tests/fixtures/french-context-cases.json`, run by `tests/smoke.test.js` `testDictionaryWithRealData` |

## Attempt 1: the following-word rule (round 1)

### Commits

- **97c5c0a** fix: read a noun-or-adjective after a determiner by what follows it
- **db0567f** fix: try the morphology lemma for dictionary lookups (candidate list)
- **4cedd9a** fix: try the masculine form for feminine adjective lookups (candidate list)

### Files and functions

- `language/french.js`:
  - `tokensAfterDeterminer(word, sentence)`: the token after each occurrence of
    the word that follows a nominal determiner.
  - `followingNounReading(token)` returns `"noun"`, `"ambiguous"` or `""`.
  - `preposedAdjectives`: the BANGS class and about 40 others.
  - `nounOrAdjectiveInContext(rawWord, sentence)`.
  - `classifyWord`'s nominal branch calls the rule when Lexique lists both
    groups.
  - 4cedd9a adds `adjectiveLemma(word)` and `feminineAdjectiveEndings`.
- `content.js` `dictionaryCandidatesFor`:
  - db0567f appends the morphology's own lemma, which is `présumé` for
    `présumée`.
  - 4cedd9a appends, for adjective readings only, the masculine singular from
    `adjectiveLemma` (`nouvelle` → `nouveau`).

### The rule as implemented

When a word after a determiner is both noun and adjective in Lexique, the next
token decides:

- A following word that Lexique lists as a noun only makes the word an
  adjective (`une nouvelle voiture`).
- Anything that is not noun-like makes it a noun. That covers a verb, a function
  word, punctuation, and the end of the line (`la nouvelle est arrivée`, `une
  donnée`, `la marine`).
- A following word that is itself noun and adjective is decided by the word's
  membership in `preposedAdjectives`. It is checked by surface,
  `adjectiveLemma` and Lexique lemma. A member is an adjective (`ma chère
  amie`); anything else is a noun (`les armées ennemies`).
- A following word whose Lexique lemma was a different attested verb did not
  count as a noun. This was aimed at `est` → `être`.

### What it fixed

The author's 57-phrase sample:

- `la nouvelle est arrivée` → news
- `une donnée` → datum
- `la marine` → navy
- `un grand` → grown-up
- `le malade dort` → a sick person
- `les jeunes aiment la musique` → youth
- `le rouge te va bien` → rouge

At 349d8c1, 16 of the 34 expected-noun phrases in that sample were labelled
adjective; at 97c5c0a there were 0. The candidate commits also made `la présumée
victime` answer "presumed" and `une nouvelle voiture` answer "new".

### What it broke

These were found by an independent reviewer outside the author's sample:

| Phrase | Answer at 97c5c0a | Cause |
|---|---|---|
| `à la prochaine`, `le prochain arrive` | "fellow man" | End of line makes the word a noun; elliptical adjectives lost their adjective reading |
| `c'est le bon` | "voucher" | same |
| `c'est la bonne` | "maid" | same |
| `ma petite sœur`, `la grande sœur`, `un bon cœur` | "small one", "grown-up", "voucher" | `lexicalGroups` did not fold `œ`, so the noun after the word was unknown and counted as "not noun-like" |
| `une bonne excuse`, `une petite montre`, `une longue marche`, `la jeune mariée` | "maid", "small one", "length", "youth" | The "lemma is a different attested verb" exclusion rejected 1,117 Lexique forms, among them ordinary nouns whose Lexique lemma is a verb |
| `un drôle de truc` | "child, kid" | `de` is a function word, so the word became a noun |
| `la morte` | "the experience or process of dying" | Correct noun label, but the Lexique lemma `mourir` was sent as a candidate and its one noun sense answered |

Two label fixes lost usable meanings because the data's noun sense differs:

- `une Française` → "French (language)";
- `le sucré et le salé` → "soft drink".

### Measured

| Sample | Result |
|---|---|
| Author's 57 phrases | 0 regressions claimed |
| Independent review | New confident wrong meanings outside the sample (table above); no totals recorded |

## Attempt 2: negative-evidence refinements (round 2)

### Commits

Reverted:

- **f269ad8** fix: count nouns whose Lexique lemma is a verb as nouns
- **09690d3** fix: keep elliptical adjectives as adjectives with no noun after them
- **06ac0e7** docs: describe the noun, adjective and closed-class context rules

Kept from the same round: 81a3514, bef30e2, 7fe1c1d, e6d7292, 55ddbfa and
d0b54b2 (see the table above). 55ddbfa was later narrowed by 84cd0b8.

### Files and functions

All in `language/french.js`:

- f269ad8 replaces the attested-verb exclusion in `followingNounReading` with
  `auxiliaryLemmas = {être, avoir}`. Only forms of those two verbs count as the
  verb.
- 09690d3 adds `ellipticalAdjectives`: bon, prochain, dernier, premier, seul,
  autre, même, meilleur.
- 09690d3 also treats `drôle` before `de`/`d'` as an adjective.
- 09690d3 extends `adjectiveLemma` with a plural fallback (`autres` → `autre`).

### The rule as implemented

The attempt 1 rule, with these exceptions:

- an elliptical adjective is always an adjective;
- `drôle de` is an adjective;
- a following noun spelled like a non-auxiliary verb form counts as a noun
  (`excuse`, `montre`);
- a following form of `être`/`avoir` counts as a verb (`est`, `a`, `été`,
  `avions`, `sommes`, `as`).

The default was still "noun unless a noun follows".

### What it fixed

Every named attempt-1 wrong answer was fixed. The independent sample also
gained correct answers:

- `les riches`, `mes proches`, `un blessé`;
- `un reçu` → receipt;
- `un bas prix` → low;
- `la nouvelle vidéo` → new;
- `il entre`;
- `le plus possible`.

### What it broke

These come from the independent 219-phrase review:

| Pattern | Examples | Cause |
|---|---|---|
| `entre`/`contre` after any pronoun | `nous contre eux` and `chez nous entre amis` → verb | 55ddbfa used the morphology's subject search (`inferVerbContext`), which accepts `nous`, `vous` and `elle` as subjects. Narrowed by 84cd0b8, which is kept. |
| Nouns spelled like auxiliary forms | `les grands avions` → "grown-up"; also `sommes`, `as`, `été`, `êtres` | `auxiliaryLemmas` refused them as nouns, so the adjective had nothing to modify |
| Unknown or closed next token | `un petit live/tuto/vlog` → "small one"; `le petit Nicolas`; `une belle et grande maison` → "beautiful woman"; `les petits 5 euros`; `un grand bravo` | The noun default fires when the next token is unknown to Lexique, a proper noun, a digit, `et`, or a closed word |

Four descriptive adjectives before a verb form that Lexique also lists as a noun
stayed wrong: `le jeune fait du sport`, `la petite va bien`, `le petit dit
bonjour`, `le grand passe`.

### Measured

| Sample | Fixed | OK | Still wrong | REGRESSION | NEW-WRONG |
|---|---|---|---|---|---|
| Author's 143 phrases (349d8c1 → 06ac0e7) | 56 | 82 | 5 | 0 | – |
| Independent 219 phrases | 33 | 135 | 12 | **39** | 0 |

## Attempt 3: positive-evidence noun switch with a tie-break (round 3)

### Commits

Reverted:

- **16763f3** fix: read a noun-or-adjective as a noun only on evidence in the phrase
- **f9cc7a4** fix: read en fait, tout à fait and à peine as adverbial phrases
- **31f1420** test: run a corpus of French context phrases against the shipped data
- **ef1b23c** docs: describe evidence-based noun readings and the context corpus

Kept from the same round:

- 84cd0b8 (entre/contre narrowed);
- from f9cc7a4, only the `lookupReading` subject change (fc38864);
- 31f1420's corpus, restored after the revert as a record of target behaviour.
  It has corrected rows, reviewer rows, and failing rows marked `knownWrong`;
  see [The context corpus](#the-context-corpus-kept).

### Files and functions

At ef1b23c, all in `language/french.js`:

- `nounOrAdjectiveInContext(rawWord, sentence, groups)` at lines 859–874.
- `determinerPhrase(word, sentence)` returns lowercased and as-written tokens,
  so capitals can be checked.
- `nounUseFollows({tokens, written, index})` at line 810, with these sets:
  - `thirdPersonAuxiliaries`
  - `nounPhraseClosers` (qui, que, qu', dont)
  - `clauseStarters` at line 798: clitics and subject pronouns, **including
    `n`/`ne`**
  - `clausePunctuation`
  - `finiteMoods`
- `adverbialPhrases` and `inAdverbialPhrase` at line 739, checked first in
  `classifyWord` at line 911.
- The auxiliary exclusion was removed from `followingNounReading`.
- The corpus was `tests/fixtures/french-context-cases.json`, with 352 rows run
  by `testDictionaryWithRealData`. Every row had to pass, so the expectations
  were fitted to the rules. The version at 31f1420 is `git show
  31f1420:tests/fixtures/french-context-cases.json`; the kept, revised version
  is described below.

### The rule as implemented

The default was inverted: the lexicon order stands unless the phrase shows a
noun use. The decision order was:

1. An elliptical adjective is an adjective.
2. With no determiner occurrence, use the lexicon order.
3. `drôle de` is an adjective.
4. If `nounUseFollows` holds, the word is a noun. It holds when the next token
   is:
   - the end of the clause or punctuation;
   - a listed third-person auxiliary (`aura` only with more of the clause after
     it);
   - a word Lexique lists only as a verb that the morphology reads as finite;
   - `qui`, `que` or `dont`;
   - a preposition, `d'`, `au`, `aux` or `du`;
   - a clitic or subject pronoun;
   - `et`/`ou` before a determiner or pronoun.

   Capitalised tokens, digits, words unknown to Lexique and other closed words
   are not evidence.
5. If the next word is noun-only in Lexique, the word is an adjective (line
   870).
6. If the next word is noun and adjective:
   - a pre-posed adjective is an adjective;
   - otherwise the next word's own lexicon order decides: adjective-first makes
     this word the noun, noun-first makes it the adjective (line 873).
7. Otherwise, use the lexicon order.

`inAdverbialPhrase` classified the last word of `en fait`, `tout à fait` and `à
peine` as an adverb wherever the phrase occurred in the sentence.

### What it fixed

The independent review found fixes in many positions:

- Nominalised adjectives:
  - `les jeunes ne votent pas`
  - `le petit ne sait pas`
  - `la pauvre elle est fatiguée`
  - `un malade imaginaire`
  - `le vieux de la vieille`
  - `c'est qui le nouveau ?`
  - `le rouge à lèvres`
  - `un inconnu m'a parlé`
  - `le froid arrive`
  - `au total`
  - `les Bleus ont gagné`
- Adverbial phrases: `en fait`, `tout à fait`, `à peine`.
- Verb readings: `elle entre`, `quand elle entre`.
- Adjective readings: `le haut niveau`, `un fin connaisseur`.
- Every attempt-2 regression listed above.

### What it broke, with code causes

The independent 448-row review found 36 regressions and 10 new wrong answers.
This rollback's probe at ef1b23c reproduced them.

| Cause (code at ef1b23c) | Share | Examples → answer at ef1b23c |
|---|---|---|
| **Lines 870 and 873.** "Following noun ⇒ adjective" never checks that the word is adjective-first. The tie-break on the next word's lexicon order then pushes noun-first words to adjective. Together they break noun + post-posed adjective order. | 20 of 36 regressions | `les étudiants français` → "studying"<br>`les abonnés fidèles` → "plagued"<br>`un salarié cadre` → "salaried"<br>`un rosé bien frais` → "pinkish"<br>`les invités surprise` → "invited"<br>`un gagnant surprise` → "winning"<br>`le public bien présent` → adjective "public"<br>`un français moyen` → adjective<br>also `un raccourci clavier`, `un employé modèle`, `les chercheurs français`, `un artiste français`, `un contenu bien fait`, `un produit phare`, `les participants inscrits` (adjective, null) |
| **`inAdverbialPhrase` (line 739).** It matches `en fait` after the clitic `en`, and matches per sentence rather than per token. | 8 regressions | `il en fait trop`, `qu'est-ce qu'il en fait`, `elle en fait partie`, `on en fait un`, `il s'en fait pour rien`, `ça en fait deux`, `l'usage qu'il en fait`, `il en fait des tonnes`: adverb, null, instead of the verb "to do/make"<br>`à peine arrivé, ça vaut la peine` makes `la peine` an adverb |
| **`n`/`ne` in `clauseStarters` (line 798).** | – | `c'est un grand n'importe quoi` → "grown-up"<br>`un gros n'importe quoi` → "an overweight person" |
| **Clause-end and `au`/`du` evidence surfaces rare noun glosses.** The noun label may be defensible, but the data's noun sense is not the idiom. | – | `pas du tout`, `du tout`, `rien du tout`, `le tout premier` → "whole, entirety"<br>`au final` → "finale"<br>`au frais` → "cost, charge"<br>`au juste` → "a righteous person"<br>`les forts` → "a fort"<br>`les vrais savent`, `un vrai de vrai` → "truth" |
| **Candidate lists with a wrong label** (db0567f, 4cedd9a). Where the rules still said adjective, the masculine candidate answered. | – | `j'ai appris la nouvelle hier`, `c'est une bonne nouvelle pour vous`, `bonne nouvelle !`, `j'ai une bonne nouvelle`, `une grande nouvelle` → "new, novel" |
| **All-caps captions.** Every next token looks capitalised to the as-written check. | – | `LA NOUVELLE EST ARRIVÉE` → "new, novel" |
| **Caption line splits.** A noun phrase broken across two caption lines looks like a clause end at the line break. | – | `les étudiants` / `français` on separate cues |

The judgement on the implementer's own additions:

- **Clitic or subject pronoun after the word as noun evidence:** mostly good,
  except `n'`.
- **Next-word lexicon-order tie-break:** net harmful.
- **`lookupReading` adding a subject only for verb readings:** correct. It is
  kept as fc38864.

The corpus had its own problems:

- A spot check of 15 rows found 5 wrong or debatable:
  - `les jeunes 18-25 ans` expects adjective, which is wrong;
  - `le vieux sont partis` is ungrammatical;
  - `le plus` as a noun is debatable;
  - `la bonne est partie` accepts "good";
  - `les grands parents` accepts "big".
- The forbidden patterns were too narrow.
- Rows without a meaning pattern checked only the group.

The rows were written by the author of the rules, so a corpus pass measured fit,
not generalisation. The five flagged rows are corrected in the kept corpus.

### Measured

| Sample | Fixed | OK | Still wrong | REGRESSION | NEW-WRONG |
|---|---|---|---|---|---|
| Author's corpus, 352 rows (349d8c1 → f9cc7a4) | 119 | 229 | 4 | 0 | 0 |
| Independent 448 rows outside the corpus | 87 | 290 | 20 | **36** | **10** |

Corpus failures by revision: 119 at 349d8c1, 61 at 06ac0e7, 0 at f9cc7a4. The
review's five categories sum to 443 of its 448 rows.

## Limitations present at every commit, 349d8c1 included

None of the attempts addressed these; they are still wrong now:

- **Adjectives after a noun read as verbs:** `un endroit calme` → "to calm",
  `un verre vide`, `le ticket gagnant`, `un couple marié` → "to marry", `la main
  gauche`, `une taille moyenne`.
- **`nul` reads as a pronoun:** `un match nul` and `c'est nul` → "no one,
  nobody".
- **Other wrong labels:**
  - `de nouvelles mesures`, `une grande première`
  - `un homme politique` reads as a verb
  - `un espace public` and `un pays étranger` read as nouns
  - `les jeunes aujourd'hui`
  - `la plupart des gens` reads as an adverb
  - `l'entrée` looked up alone reads as the verb
  - `le moins de temps`, `le plus de monde`
- **Data gaps:**
  - no dictionary entry for `meilleur` (adjective), `vieil`, `nouvel`, `moindre`
    or `bel`;
  - `au moins` answers "minus; negative", the only adverb sense for `moins`.
- **Descriptive adjective before a verb form Lexique also lists as a noun:** `le
  jeune fait du sport`, `la petite va bien`.

## State after the rollback (probe, 349d8c1 → fc38864)

82 phrases were probed with the real morphology, the real `language/french.js`,
the `dictionaryCandidatesFor` from each revision's `content.js`, and the real
`dictionary.js` over the shipped data:

- **Better, 16 rows:**
  - 12 are the kept fixes: superlative and fixed-expression `plus`/`moins`, no
    infinitive for `plus` or `tu`, the `œ` nouns, and `entre` as a verb after a
    subject.
  - 4 are prepositions: `nous contre eux`, `chez nous entre amis`, `c'est nous
    contre le reste du monde` and `contre le mur`. They no longer show a verb
    infinitive, and `contre` is no longer sent to the engine as "je contre".
- **Same, 66 rows.**
- **Worse, 0 rows.**

Every attempt-3 regression listed above is back to its 349d8c1 answer. The
round-1 fixes are gone again: `la nouvelle`, `une donnée` and `la marine` are
adjective with no dictionary answer. `une nouvelle voiture` and `la présumée
victime` miss again, and an engine answers them.

## If resuming

### Starting points the reviewers suggested

1. **Drop the next-word lexicon-order tie-break.** Before "a following noun
   means an adjective", require the word itself to be one that normally
   precedes its noun. Measure noun + post-posed adjective sequences first:
   `les étudiants français`, `un produit phare`.
2. **Narrow the adverbial phrases.** Treat `en fait` as adverbial only when the
   `en` is not a clitic, that is, not after a subject or `s'`/`qu'il`. Match
   the hovered token's own position, not any occurrence in the sentence.
3. **Drop `n`/`ne` from the clause starters.**
4. **Separate the label from the sense.** Don't let clause-end or `au`/`du`
   evidence select a rare noun sense. A noun label for `tout` in `du tout` or
   `final` in `au final` answers "whole" or "finale"; either treat those
   expressions as fixed phrases, or miss rather than answer.
5. **Handle caption line splits and all-caps captions.** Classify against the
   joined sentence rather than the single cue, or treat a cue boundary as no
   evidence. Treat an all-caps cue as carrying no capitalisation information.
6. **Don't restore the candidate-list changes before the labels are
   trustworthy.** Both db0567f (morphology lemma) and 4cedd9a (masculine form)
   turn a wrong adjective label from a miss into a confident wrong answer.

### Evaluation method that worked

The only measurement that predicted real behaviour was this:

1. An **independent reviewer** builds a **fresh sample the author never saw**,
   several hundred phrases, deliberately covering:
   - noun + adjective order;
   - idioms;
   - clitic `en`;
   - anglicisms, proper nouns, digits;
   - coordination;
   - caption-like fragments.
2. Run it through the real pipeline at a **baseline commit** and at the
   candidate.
3. Classify each row: fixed / ok / still wrong / REGRESSION (was OK, now not) /
   NEW-WRONG (was null, now a wrong non-null).

Author samples and an author-written corpus reported zero regressions in every
round and were wrong every time.

How to set up the probe:

- Check the baseline out with `git worktree add --detach <path-outside-repo>
  349d8c1`.
- Require `fake-indexeddb` from the main checkout's `node_modules` by absolute
  path; no junction is needed.
- Load:
  - `vendor/ablaut/ablaut.js` into a `vm` context;
  - `language/french.js` and `dictionary.js`;
  - `splitFrenchElision` and `dictionaryCandidatesFor`, sliced out of
    `content.js`.
- Resolve each token exactly as `tests/smoke.test.js` `testDictionaryWithRealData`
  does.

Expected values in any sample need a **native-speaker check**. A third of the
corpus rows spot-checked were wrong or debatable.

### The context corpus (kept)

`tests/fixtures/french-context-cases.json` holds 431 phrases, one JSON object
per line. `testDictionaryWithRealData` in `tests/smoke.test.js` resolves each
row through the real morphology, the real `dictionaryCandidatesFor` and the
shipped dictionary. That takes well under a second.

#### Fields

| Field | Required | Meaning |
|---|---|---|
| `phrase` | yes | The caption text |
| `word` | yes | The token as written, including elisions such as `l'étudiant` |
| `group` | yes | The **target** group; `"a\|b"` when either reading is right |
| `meaning` | no | A regex the answer must match |
| `forbidden` | no | A regex the answer must never match |
| `knownWrong` | no | `true` when the row fails at the current code |
| `disputed` | no | `true` when the expectation is debatable; not checked |
| `note` | no | Why a row is disputed, or context for the expectation |
| `source` | yes | Who wrote the phrase (see below) |
| `from` | no | The reverted commit whose test assertion the row came from |

The `source` values are:

- `author`: the rule author's own sample and blind-spot rows;
- `review-round1`: the first reviewer's probe table;
- `review-round2`: the 219-phrase review of attempt 2;
- `review-round3`: the phrases the 448-row review of attempt 3 named, plus the
  limitations present at every commit.

#### What changed from 31f1420

- **Rows are target behaviour, not current behaviour.** No expectation was
  changed to match the rolled-back code. Every row that fails now is marked
  `knownWrong` instead.
- **The five rows the decisive review flagged were corrected:**
  - `les jeunes 18-25 ans` → noun;
  - `le vieux sont partis` → `les vieux sont partis`;
  - `le plus` → disputed;
  - `la bonne est partie` → noun "maid", never "good";
  - `les grands parents` → forbids "big".
- **76 `review-round3` rows were added**, from the review phrases named in this
  note. The round-2 review phrases were already present.
- **Classification assertions from the reverted commits became rows.** 78 rows
  carry `from`: 97c5c0a, f269ad8, 09690d3, 16763f3, f9cc7a4, db0567f and
  4cedd9a. Where a phrase was already present, `from` was added to that row.
  - Assertions that only tested removed helpers (`adjectiveLemma`, the candidate
    stubs) were dropped.

#### The ratchet

The runner prints one line:

```
French context corpus: 305 passing, 125 knownWrong, 1 disputed; by source author 121/176, review-round1 26/26, review-round2 118/152, review-round3 40/76
```

It fails in two cases:

- a row without `knownWrong` fails;
- a `knownWrong` row now passes. The message says to remove the flag, so an
  improvement is recorded and can't later regress silently.

A `knownWrong` row that gets worse still fails, so it stays in the file as
`knownWrong` with its target intact. The runner does not notice that it got
worse, though; for that, compare against a baseline as described below.

#### Using it to measure an attempt

1. Measure the pass rate per source at a baseline commit and at the candidate.
   Use the same harness as above; drop `knownWrong` from the check, or read the
   runner's line.
2. Judge generalisation on the `review-*` rows, not `author`.
3. Diff row by row against the baseline for REGRESSION and NEW-WRONG. The
   runner alone cannot see a `knownWrong` row changing from one wrong answer to
   another.
4. Add fresh reviewer rows before tuning, not after.

Pass rates, excluding the disputed row:

| Commit | author | review-round1 | review-round2 | review-round3 | total |
|---|---|---|---|---|---|
| 349d8c1 (baseline) | 96/176 | 23/26 | 109/152 | 38/76 | 266/430 |
| ef1b23c (attempt 3) | 170/176 | 26/26 | 151/152 | **15/76** | 362/430 |
| fc38864 (after rollback) | 121/176 | 26/26 | 118/152 | 40/76 | 305/430 |

Attempt 3 scored 97% on the rows its author had seen, and 20% on the round-3
reviewer's phrases, below the baseline's 50%. That gap is the overfitting this
note describes. No row passes at 349d8c1 and fails at fc38864.

### Infrastructure to build on (kept)

- `sentenceTokens()` in `french.js`: lowercased tokens, with punctuation as its
  own token.
- Two patterns for a context rule that looks at neighbouring tokens:
  - `prepositionVerbAfterSubject()` walks back over object clitics to a subject;
  - `modifiesFollowingWord()` and `fixedAdverbialExpression()` examine the
    token after a determiner.
- `lexicalGroups` is exported from `DualSubFrench`, and `indexValue` folds `œ`
  and `æ`.
- `dictionaryCandidatesFor` already drops verb-only Lexique lemmas.
- `testDictionaryWithRealData` cases take an optional `forbidden` pattern and
  an `undefined` expectation, for "must not answer this" rows.
- The context corpus and its `knownWrong` ratchet (above).
- `tests/ui.test.js` `useRealFrench(w)` loads the real morphology and Lexique
  into a jsdom window.

### Test material (unverified expectations)

The phrases this note names are rows in the context corpus:

- the attempt-3 regressions and fixes, and the limitations present at every
  commit, with `source` `review-round3`;
- the earlier regressions, with `source` `review-round1` and `review-round2`;
- the original issues and the reverted commits' assertions, with `from`.

**The expectations are the reviewers' and implementer's judgements, not a native
speaker's.** Check them before trusting a pass or a failure. The ones most worth
a second opinion are:

- the idioms: `au final`, `au juste`, `du tout`, `les forts`, `les vrais
  savent`, which accept several groups and forbid the wrong sense;
- `un français moyen`;
- `un autre`, `les meilleurs` and `c'est le bon`, where "adjective" stands for
  an elliptical reading.

The card-level checks for the kept fixes are not corpus rows, because the corpus
checks only the group and the meaning:

- `plus tard` has no "Infinitive: plaire";
- `tu es là` has no `taire`;
- `il mange` keeps `manger`;
- `il entre` shows `entrer`.

They live in `tests/ui.test.js` (`verbEvidence`).
