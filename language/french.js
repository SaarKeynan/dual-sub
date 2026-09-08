(() => {
  const formIndex = new Map();
  let morphologyEngine = null;
  let attestedLemmas = null;
  let morphologyState = "fallback";
  let wordGroupIndex = null;
  let wordGroupState = "fallback";
  let lexicalInfoIndex = null;
  let lexicalInfoState = "fallback";

  async function initializeResources() {
    if (typeof browser === "undefined") return;
    morphologyState = "loading";
    wordGroupState = "loading";
    lexicalInfoState = "loading";
    const morphologyPromise = (async () => {
      if (typeof wasm_bindgen !== "function") throw new Error("Morphology engine unavailable");
      const [, lemmaResponse] = await Promise.all([
          wasm_bindgen({ module_or_path: browser.runtime.getURL("vendor/ablaut/ablaut_bg.wasm") }),
          fetch(browser.runtime.getURL("vendor/lefff/french-verb-lemmas.json"))
        ]);
      if (!lemmaResponse.ok) throw new Error(`Lemma resource returned ${lemmaResponse.status}`);
      return new Set(await lemmaResponse.json());
    })();
    const wordGroupPromise = fetch(browser.runtime.getURL("vendor/lexique/french-word-groups.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Word-group resource returned ${response.status}`);
        return response.json();
      });
    const lexicalInfoPromise = fetch(browser.runtime.getURL("vendor/lexique/french-lexical-info.json"))
      .then((response) => {
        if (!response.ok) throw new Error(`Lexical-info resource returned ${response.status}`);
        return response.json();
      });
    const [morphologyResult, wordGroupResult, lexicalInfoResult] = await Promise.allSettled([morphologyPromise, wordGroupPromise, lexicalInfoPromise]);
    if (morphologyResult.status === "fulfilled") {
      attestedLemmas = morphologyResult.value;
      morphologyEngine = wasm_bindgen;
      morphologyState = "ready";
    } else morphologyState = "fallback";
    if (wordGroupResult.status === "fulfilled") {
      wordGroupIndex = wordGroupResult.value;
      wordGroupState = "ready";
    } else wordGroupState = "fallback";
    if (lexicalInfoResult.status === "fulfilled") {
      lexicalInfoIndex = lexicalInfoResult.value;
      lexicalInfoState = "ready";
    } else lexicalInfoState = "fallback";
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("fr").normalize("NFC");
  }

  function lexiqueToIpa(value) {
    const mapping = {
      "@": "ɑ̃", "§": "ɔ̃", "5": "ɛ̃", "1": "œ̃", "2": "ø", "9": "œ",
      "E": "ɛ", "O": "ɔ", "S": "ʃ", "Z": "ʒ", "R": "ʁ", "N": "ɲ", "G": "ŋ",
      // Schwa and the labial-palatal glide are among the most frequent codes in
      // Lexique; leaving them unmapped printed /ʒ°/ and /n8i/ on the card.
      "°": "ə", "8": "ɥ"
    };
    return Array.from(String(value || ""), (character) => mapping[character] || character).join("");
  }

  function lexicalInfo(rawWord) {
    // Overlay tokens keep YouTube's typographic apostrophe, but Lexique keys
    // use the straight one, so aujourd’hui missed the index entirely.
    const word = normalize(rawWord).replace(/’/gu, "'").replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    const value = lexicalInfoIndex?.[word];
    if (!Array.isArray(value)) return null;
    return {
      surface: word,
      lemma: value[0] || word,
      pronunciation: lexiqueToIpa(value[1]),
      gender: value[2] === "m" ? "masculine" : value[2] === "f" ? "feminine" : "",
      number: value[3] === "s" ? "singular" : value[3] === "p" ? "plural" : "",
      syllables: Number(value[4]) || 0,
      frequency: Number(value[5]) || 0
    };
  }

  function indexForm(form, analysis) {
    const key = normalize(form);
    const entries = formIndex.get(key) || [];
    if (!entries.some((entry) => (
      entry.lemma === analysis.lemma && entry.mood === analysis.mood && entry.tense === analysis.tense &&
      entry.person === analysis.person && entry.number === analysis.number
    ))) entries.push(analysis);
    formIndex.set(key, entries);
  }

  function addForms(lemma, tense, forms, mood = "indicative") {
    const people = [
      ["1st", "singular"], ["2nd", "singular"], ["3rd", "singular"],
      ["1st", "plural"], ["2nd", "plural"], ["3rd", "plural"]
    ];
    forms.forEach((form, index) => {
      if (!form) return;
      indexForm(form, {
        lemma, partOfSpeech: "verb", mood, tense,
        person: people[index]?.[0] || "",
        number: people[index]?.[1] || "",
        confidence: "high"
      });
    });
  }

  function addParticiple(lemma, form, tense) {
    indexForm(form, {
      lemma, partOfSpeech: "verb", mood: "participle", tense,
      person: "", number: "", confidence: "high"
    });
  }

  function addInfinitive(lemma) {
    indexForm(lemma, {
      lemma, partOfSpeech: "verb", mood: "infinitive", tense: "",
      person: "", number: "", confidence: "high"
    });
  }

  // Small synchronous fallback tables keep common lookups useful while the
  // full WASM morphology engine and lemma list are still loading.
  const fallbackIrregularParadigms = {
    "être": {
      present: ["suis", "es", "est", "sommes", "êtes", "sont"],
      imperfect: ["étais", "étais", "était", "étions", "étiez", "étaient"],
      future: ["serai", "seras", "sera", "serons", "serez", "seront"],
      conditional: ["serais", "serais", "serait", "serions", "seriez", "seraient"]
    },
    "avoir": {
      present: ["ai", "as", "a", "avons", "avez", "ont"],
      imperfect: ["avais", "avais", "avait", "avions", "aviez", "avaient"],
      future: ["aurai", "auras", "aura", "aurons", "aurez", "auront"],
      conditional: ["aurais", "aurais", "aurait", "aurions", "auriez", "auraient"]
    },
    "aller": {
      present: ["vais", "vas", "va", "allons", "allez", "vont"],
      imperfect: ["allais", "allais", "allait", "allions", "alliez", "allaient"],
      future: ["irai", "iras", "ira", "irons", "irez", "iront"],
      conditional: ["irais", "irais", "irait", "irions", "iriez", "iraient"]
    },
    "faire": {
      present: ["fais", "fais", "fait", "faisons", "faites", "font"],
      imperfect: ["faisais", "faisais", "faisait", "faisions", "faisiez", "faisaient"],
      future: ["ferai", "feras", "fera", "ferons", "ferez", "feront"],
      conditional: ["ferais", "ferais", "ferait", "ferions", "feriez", "feraient"]
    },
    "pouvoir": {
      present: ["peux", "peux", "peut", "pouvons", "pouvez", "peuvent"],
      imperfect: ["pouvais", "pouvais", "pouvait", "pouvions", "pouviez", "pouvaient"],
      future: ["pourrai", "pourras", "pourra", "pourrons", "pourrez", "pourront"],
      conditional: ["pourrais", "pourrais", "pourrait", "pourrions", "pourriez", "pourraient"]
    },
    "vouloir": {
      present: ["veux", "veux", "veut", "voulons", "voulez", "veulent"],
      imperfect: ["voulais", "voulais", "voulait", "voulions", "vouliez", "voulaient"],
      future: ["voudrai", "voudras", "voudra", "voudrons", "voudrez", "voudront"],
      conditional: ["voudrais", "voudrais", "voudrait", "voudrions", "voudriez", "voudraient"]
    },
    "devoir": {
      present: ["dois", "dois", "doit", "devons", "devez", "doivent"],
      imperfect: ["devais", "devais", "devait", "devions", "deviez", "devaient"],
      future: ["devrai", "devras", "devra", "devrons", "devrez", "devront"],
      conditional: ["devrais", "devrais", "devrait", "devrions", "devriez", "devraient"]
    },
    "savoir": {
      present: ["sais", "sais", "sait", "savons", "savez", "savent"],
      imperfect: ["savais", "savais", "savait", "savions", "saviez", "savaient"],
      future: ["saurai", "sauras", "saura", "saurons", "saurez", "sauront"],
      conditional: ["saurais", "saurais", "saurait", "saurions", "sauriez", "sauraient"]
    },
    "venir": {
      present: ["viens", "viens", "vient", "venons", "venez", "viennent"],
      imperfect: ["venais", "venais", "venait", "venions", "veniez", "venaient"],
      future: ["viendrai", "viendras", "viendra", "viendrons", "viendrez", "viendront"],
      conditional: ["viendrais", "viendrais", "viendrait", "viendrions", "viendriez", "viendraient"]
    },
    "prendre": {
      present: ["prends", "prends", "prend", "prenons", "prenez", "prennent"],
      imperfect: ["prenais", "prenais", "prenait", "prenions", "preniez", "prenaient"],
      future: ["prendrai", "prendras", "prendra", "prendrons", "prendrez", "prendront"],
      conditional: ["prendrais", "prendrais", "prendrait", "prendrions", "prendriez", "prendraient"]
    },
    "dire": {
      present: ["dis", "dis", "dit", "disons", "dites", "disent"],
      imperfect: ["disais", "disais", "disait", "disions", "disiez", "disaient"],
      future: ["dirai", "diras", "dira", "dirons", "direz", "diront"],
      conditional: ["dirais", "dirais", "dirait", "dirions", "diriez", "diraient"]
    },
    "voir": {
      present: ["vois", "vois", "voit", "voyons", "voyez", "voient"],
      imperfect: ["voyais", "voyais", "voyait", "voyions", "voyiez", "voyaient"],
      future: ["verrai", "verras", "verra", "verrons", "verrez", "verront"],
      conditional: ["verrais", "verrais", "verrait", "verrions", "verriez", "verraient"]
    },
    "mettre": {
      present: ["mets", "mets", "met", "mettons", "mettez", "mettent"],
      imperfect: ["mettais", "mettais", "mettait", "mettions", "mettiez", "mettaient"],
      future: ["mettrai", "mettras", "mettra", "mettrons", "mettrez", "mettront"],
      conditional: ["mettrais", "mettrais", "mettrait", "mettrions", "mettriez", "mettraient"]
    }
  };

  Object.entries(fallbackIrregularParadigms).forEach(([lemma, tenses]) => {
    addInfinitive(lemma);
    Object.entries(tenses).forEach(([tense, forms]) => {
      if (tense === "conditional") addForms(lemma, "present", forms, "conditional");
      else addForms(lemma, tense, forms);
    });
  });

  const fallbackRegularErLemmas = [
    "aimer", "arriver", "continuer", "demander", "donner", "écouter", "essayer", "expliquer", "jouer",
    "habiller", "parler", "passer", "penser",
    "regarder", "rester", "travailler", "trouver", "utiliser"
  ];
  fallbackRegularErLemmas.forEach((lemma) => {
    addInfinitive(lemma);
    const stem = lemma.slice(0, -2);
    addForms(lemma, "present", [
      `${stem}e`, `${stem}es`, `${stem}e`, `${stem}ons`, `${stem}ez`, `${stem}ent`
    ]);
    addForms(lemma, "imperfect", [
      `${stem}ais`, `${stem}ais`, `${stem}ait`, `${stem}ions`, `${stem}iez`, `${stem}aient`
    ]);
  });

  const fallbackSpellingChangeParadigms = {
    appeler: {
      present: ["appelle", "appelles", "appelle", "appelons", "appelez", "appellent"],
      imperfect: ["appelais", "appelais", "appelait", "appelions", "appeliez", "appelaient"]
    },
    acheter: {
      present: ["achète", "achètes", "achète", "achetons", "achetez", "achètent"],
      imperfect: ["achetais", "achetais", "achetait", "achetions", "achetiez", "achetaient"]
    },
    commencer: {
      present: ["commence", "commences", "commence", "commençons", "commencez", "commencent"],
      imperfect: ["commençais", "commençais", "commençait", "commencions", "commenciez", "commençaient"]
    },
    manger: {
      present: ["mange", "manges", "mange", "mangeons", "mangez", "mangent"],
      imperfect: ["mangeais", "mangeais", "mangeait", "mangions", "mangiez", "mangeaient"]
    }
  };
  Object.entries(fallbackSpellingChangeParadigms).forEach(([lemma, tenses]) => {
    addInfinitive(lemma);
    Object.entries(tenses).forEach(([tense, forms]) => addForms(lemma, tense, forms));
  });

  const fallbackRegularIrLemmas = ["choisir", "finir", "réfléchir", "remplir", "réussir"];
  fallbackRegularIrLemmas.forEach((lemma) => {
    addInfinitive(lemma);
    const stem = lemma.slice(0, -2);
    addForms(lemma, "present", [
      `${stem}is`, `${stem}is`, `${stem}it`, `${stem}issons`, `${stem}issez`, `${stem}issent`
    ]);
    addForms(lemma, "imperfect", [
      `${stem}issais`, `${stem}issais`, `${stem}issait`, `${stem}issions`, `${stem}issiez`, `${stem}issaient`
    ]);
  });

  [
    ["être", "été", "past"], ["être", "étant", "present"],
    ["avoir", "eu", "past"], ["avoir", "ayant", "present"],
    ["aller", "allé", "past"], ["faire", "fait", "past"],
    ["pouvoir", "pu", "past"], ["vouloir", "voulu", "past"],
    ["devoir", "dû", "past"], ["savoir", "su", "past"],
    ["venir", "venu", "past"], ["prendre", "pris", "past"],
    ["dire", "dit", "past"], ["voir", "vu", "past"], ["mettre", "mis", "past"]
  ].forEach(([lemma, form, tense]) => addParticiple(lemma, form, tense));

  function regularAnalysis(word) {
    let match = word.match(/^(.+(?:er|ir|re))(ai|as|a|ons|ez|ont)$/u);
    if (match) return { lemma: match[1], mood: "indicative", tense: "future", confidence: "medium" };
    match = word.match(/^(.+(?:er|ir|re))(ais|ait|ions|iez|aient)$/u);
    if (match) return { lemma: match[1], mood: "conditional", tense: "present", confidence: "medium" };
    match = word.match(/^(.+?)(é|ée|és|ées)$/u);
    if (match && match[1].length >= 2) return { lemma: `${match[1]}er`, mood: "participle", tense: "past", confidence: "medium" };
    return null;
  }

  const subjectGrammar = new Map([
    ["je", ["1st", "singular"]], ["j", ["1st", "singular"]],
    ["tu", ["2nd", "singular"]],
    ["il", ["3rd", "singular"]], ["elle", ["3rd", "singular"]],
    // ce is only a subject before être, which arrives elided as c’. Listing the
    // bare form here made “ce livre” look like a clause with a subject and
    // suppressed the nominal reading that “le livre” receives.
    ["on", ["3rd", "singular"]], ["c", ["3rd", "singular"]],
    ["nous", ["1st", "plural"]], ["vous", ["2nd", "plural"]],
    ["ils", ["3rd", "plural"]], ["elles", ["3rd", "plural"]]
  ]);
  const elisionParticles = Object.freeze({
    j: { expanded: "je", role: "subject pronoun", group: "pronoun", meaning: "I" },
    m: { expanded: "me", role: "object or reflexive pronoun", group: "pronoun", meaning: "me / myself" },
    t: { expanded: "te", role: "object or reflexive pronoun", group: "pronoun", meaning: "you / yourself" },
    s: { expanded: "se", role: "reflexive pronoun", group: "pronoun", meaning: "oneself / himself / herself" },
    l: { expanded: "le / la", role: "article or object pronoun", group: "pronoun", meaning: "the / him / her / it" },
    n: { expanded: "ne", role: "negation marker", group: "adverb", meaning: "marks a negative verb" },
    c: { expanded: "ce", role: "demonstrative pronoun", group: "pronoun", meaning: "this / it" },
    d: { expanded: "de", role: "preposition", group: "preposition", meaning: "of / from" },
    qu: { expanded: "que", role: "conjunction or pronoun", group: "conjunction", meaning: "that / which" }
  });

  function analyzeElisionParticle(rawParticle, compound = "") {
    const canonical = normalize(rawParticle).replace(/’/gu, "'").replace(/\s+/gu, "");
    const match = canonical.match(/^(j|m|t|s|l|n|c|d|qu)'$/u);
    if (!match) return null;
    const key = match[1];
    // s’il and s’ils are si + il, not the reflexive pronoun se. The caller
    // passes the whole elided form so the two readings stay distinguishable.
    if (key === "s" && ["il", "ils"].includes(splitElidedClitic(compound).base)) {
      return {
        key,
        surface: "s’",
        expanded: "si",
        role: "conjunction",
        group: "conjunction",
        meaning: "if"
      };
    }
    return {
      key,
      surface: `${key}’`,
      ...elisionParticles[key]
    };
  }

  function splitElidedClitic(rawWord) {
    const surface = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    const canonical = surface.replace(/’/gu, "'");
    const match = canonical.match(/^(j|m|t|s|l|n|c|d|qu)'([\p{L}-]+)$/u);
    return {
      surface,
      canonical,
      base: match?.[2] || canonical,
      prefix: match?.[1] || "",
      attached: Boolean(match)
    };
  }

  function findSubjectBefore(tokens, index) {
    for (let cursor = index - 1; cursor >= Math.max(0, index - 5); cursor -= 1) {
      const token = tokens[cursor];
      const grammar = subjectGrammar.get(token);
      if (grammar) {
        // In “je vous aime” and “on nous appelle”, nous/vous is an object
        // clitic because another explicit subject immediately precedes it.
        const precedingGrammar = subjectGrammar.get(tokens[cursor - 1]);
        if (["nous", "vous"].includes(token) && precedingGrammar) continue;
        return { token, person: grammar[0], number: grammar[1], index: cursor };
      }
      if (!["me", "m", "te", "t", "se", "s", "le", "la", "les", "l", "lui", "leur", "y", "en", "ne", "n"].includes(token)) break;
    }
    return null;
  }

  function cliticMatchesSubject(form, subject) {
    if (!subject) return false;
    if (form === "m" || form === "me") return subject.person === "1st" && subject.number === "singular";
    if (form === "t" || form === "te") return subject.person === "2nd" && subject.number === "singular";
    if (form === "s" || form === "se") return subject.person === "3rd";
    if (form === "nous") return subject.person === "1st" && subject.number === "plural";
    if (form === "vous") return subject.person === "2nd" && subject.number === "plural";
    return false;
  }

  function inferVerbContext(parts, sentence) {
    const tokens = (normalize(sentence).replace(/’/gu, "'").match(/[\p{L}]+(?:'[\p{L}]+)*/gu) || []);
    let index = tokens.findIndex((token) => token === parts.canonical);
    if (index < 0 && !parts.attached) {
      index = tokens.findIndex((token) => splitElidedClitic(token).base === parts.base);
    }

    let subject = null;
    if (parts.prefix === "j") subject = { token: "je", person: "1st", number: "singular", index };
    else if (parts.prefix === "c") subject = { token: "ce", person: "3rd", number: "singular", index };
    else if (index >= 0) subject = findSubjectBefore(tokens, index);

    let cliticForm = parts.prefix;
    let cliticAttached = parts.attached;
    if (!cliticForm && index > 0) {
      const candidate = tokens[index - 1];
      if (["me", "te", "se"].includes(candidate)) cliticForm = candidate;
      else if (["nous", "vous"].includes(candidate) && findSubjectBefore(tokens, index - 1)) cliticForm = candidate;
    }
    const reflexive = cliticForm === "s" || cliticForm === "se" || cliticMatchesSubject(cliticForm, subject);
    let clitic = null;
    if (cliticForm) {
      const particle = elisionParticles[cliticForm];
      const contextualRole = !reflexive && ["m", "t", "l"].includes(cliticForm)
        ? "object pronoun"
        : (particle?.role || "object pronoun");
      clitic = {
        surface: cliticAttached ? `${cliticForm}’` : cliticForm,
        expanded: particle?.expanded || cliticForm,
        role: reflexive ? "reflexive pronoun" : contextualRole,
        reflexive,
        attached: cliticAttached
      };
    }
    return {
      person: subject?.person || "",
      number: subject?.number || "",
      clitic,
      reflexive
    };
  }

  function contextRank(analysis, context) {
    const personRank = !context.person || !analysis.person ? 1
      : analysis.person === context.person && analysis.number === context.number ? 0 : 2;
    // Prefer the ordinary finite reading when the engine also emits an
    // imperative slot for the same surface (notably as -> avoir).
    return personRank * 10 + (analysis.mood === "imperative" ? 3 : 0);
  }

  function addVerbContext(analysis, parts, context) {
    if (!analysis) return null;
    const result = { ...analysis, surface: parts.surface, verbSurface: parts.base };
    if (!result.person && context.person) {
      result.person = context.person;
      result.number = context.number;
    }
    if (context.clitic) result.clitic = { ...context.clitic };
    if (context.reflexive) {
      result.pronominal = true;
      result.pronominalLemma = /^[aeiouyàâäéèêëîïôöùûühœ]/iu.test(result.lemma)
        ? `s’${result.lemma}`
        : `se ${result.lemma}`;
    }
    return result;
  }

  // regularAnalysis derives an infinitive from spelling alone, so every noun
  // ending in -é looks like a past participle: idée became a form of "ider".
  // The guess is only safe while no attested lemma list has loaded; once Lefff
  // is available it is the authority on whether the verb exists.
  function attestedRegularAnalysis(word) {
    const analysis = regularAnalysis(word);
    if (!analysis) return null;
    return !attestedLemmas || attestedLemmas.has(analysis.lemma) ? analysis : null;
  }

  function fallbackAnalysis(rawWord, sentence = "") {
    const parts = splitElidedClitic(rawWord);
    const word = parts.base;
    if (!word || word.includes(" ")) return null;
    const context = inferVerbContext(parts, sentence);
    const known = [...(formIndex.get(word) || [])].sort((left, right) => contextRank(left, context) - contextRank(right, context));
    const analysis = known[0] || attestedRegularAnalysis(word);
    if (!analysis) return null;
    const result = addVerbContext({
      partOfSpeech: "verb",
      ...analysis,
      alternatives: []
    }, parts, context);
    result.alternatives = known.slice(1).map((item) => addVerbContext(item, parts, context));
    return result;
  }

  const commonLemmaRank = new Map([
    "être", "avoir", "aller", "faire", "pouvoir", "vouloir", "devoir", "savoir", "dire", "venir",
    "voir", "prendre", "mettre", "suivre"
  ].map((lemma, rank) => [lemma, rank]));

  function parseSlot(slot) {
    const value = String(slot || "").trim();
    const lower = value.toLocaleLowerCase("fr");
    const personMatch = lower.match(/([123])(sg|pl)$/u);
    let mood = "indicative";
    if (lower.startsWith("subjunctive")) mood = "subjunctive";
    else if (lower.startsWith("conditional")) mood = "conditional";
    else if (lower.startsWith("imperative")) mood = "imperative";
    else if (lower.includes("participle")) mood = "participle";
    else if (lower === "infinitive") mood = "infinitive";
    const tense = lower
      .replace(/\s+[123](?:sg|pl)$/u, "")
      .replace(/^(?:subjunctive|conditional|imperative)\s*/u, "") || mood;
    return {
      mood,
      tense,
      person: personMatch ? ({ 1: "1st", 2: "2nd", 3: "3rd" })[personMatch[1]] : "",
      number: personMatch ? (personMatch[2] === "sg" ? "singular" : "plural") : ""
    };
  }

  function analysisFromMatch(surface, match, slot, confidence = "verified") {
    return {
      surface,
      lemma: match.infinitive,
      partOfSpeech: "verb",
      ...parseSlot(slot),
      confidence,
      source: "ablaut"
    };
  }

  function analyzeWithMorphology(rawWord, sentence = "") {
    if (!morphologyEngine) return null;
    const parts = splitElidedClitic(rawWord);
    const word = parts.base;
    if (!word || word.includes(" ")) return null;
    if (word === "maintenant" && !/\ben\s+maintenant\b/iu.test(String(sentence || ""))) return null;
    const matches = morphologyEngine.reverseFrench(word)
      .filter((match) => attestedLemmas?.has(match.infinitive));
    if (!Array.isArray(matches) || !matches.length) return null;
    matches.sort((left, right) => {
      const leftRank = commonLemmaRank.get(left.infinitive) ?? 999;
      const rightRank = commonLemmaRank.get(right.infinitive) ?? 999;
      return leftRank - rightRank ||
        left.infinitive.length - right.infinitive.length || left.infinitive.localeCompare(right.infinitive, "fr");
    });
    const analyses = matches.flatMap((match) => (match.slots || []).map((slot) => (
      analysisFromMatch(word, match, slot)
    )));
    if (!analyses.length) return null;
    const context = inferVerbContext(parts, sentence);
    analyses.sort((left, right) => contextRank(left, context) - contextRank(right, context));
    const result = addVerbContext(analyses[0], parts, context);
    result.alternatives = analyses.slice(1, 7).map((item) => addVerbContext(item, parts, context));
    return result;
  }

  const strongNominalDeterminers = new Set([
    "un", "une", "des", "ce", "cet", "cette", "ces",
    "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
    "notre", "nos", "votre", "vos", "leur", "leurs",
    "chaque", "quelque", "quelques", "plusieurs", "aucun", "aucune"
  ]);
  const articleDeterminers = new Set(["le", "la", "les", "l", "du", "au", "aux"]);
  const subjectPronouns = new Set(["je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles"]);

  const closedWordGroups = new Map([
    ["pronoun", new Set(["je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "me", "m", "te", "t", "se", "s", "moi", "toi", "lui", "eux", "y", "en", "qui", "que", "quoi", "dont", "où", "lequel", "laquelle", "lesquels", "lesquelles", "ceci", "cela", "ça"])],
    ["determiner", new Set(["un", "une", "des", "le", "la", "les", "l", "du", "au", "aux", "ce", "cet", "cette", "ces", "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs", "chaque", "quelque", "plusieurs", "aucun", "aucune"] )],
    ["preposition", new Set(["à", "après", "avant", "avec", "chez", "contre", "dans", "de", "depuis", "derrière", "devant", "durant", "en", "entre", "hors", "jusque", "malgré", "par", "parmi", "pendant", "pour", "sans", "selon", "sous", "sur", "vers"] )],
    ["conjunction", new Set(["car", "comme", "donc", "et", "lorsque", "mais", "ni", "or", "ou", "parce", "puisque", "quand", "que", "quoique", "si"] )],
    ["interjection", new Set(["ah", "aïe", "bah", "ben", "bof", "bravo", "chut", "eh", "euh", "hé", "hélas", "oh", "ouf", "zut"] )]
  ]);

  const groupByCode = Object.freeze({
    n: "noun", v: "verb", j: "adjective", r: "adverb", p: "pronoun",
    d: "determiner", s: "preposition", c: "conjunction", i: "interjection"
  });

  function closedWordGroup(rawWord) {
    const word = splitElidedClitic(rawWord).base;
    for (const [group, words] of closedWordGroups) {
      if (words.has(word)) return group;
    }
    return "";
  }

  function lexicalGroups(rawWord) {
    const word = splitElidedClitic(rawWord).base;
    const indexed = Array.from(wordGroupIndex?.[word] || "", (code) => groupByCode[code]).filter(Boolean);
    const closed = closedWordGroup(rawWord);
    if (!closed) return indexed;
    // "or" and "car" are conjunctions but also ordinary nouns. Keep the closed
    // reading first and expose the lexicon readings as alternatives instead of
    // discarding them.
    return [closed, ...indexed.filter((group) => group !== closed)];
  }

  function likelyNominalLemma(rawWord) {
    const word = splitElidedClitic(rawWord).base;
    const candidates = [];
    if (word.endsWith("ées")) candidates.push(word.slice(0, -2));
    else if (word.endsWith("ée")) candidates.push(word.slice(0, -1));
    return candidates.find((candidate) =>
      lexicalGroups(candidate).some((group) => group === "noun" || group === "adjective")
    ) || word;
  }

  function hasNominalDeterminer(rawWord, sentence) {
    const parts = splitElidedClitic(rawWord);
    const word = parts.base;
    // An isolated l'as defaults to avoir; an explicit subject also establishes
    // that l' is an object clitic (including tu ne l'as pas).
    const sentenceParts = splitElidedClitic(sentence);
    if (sentenceParts.prefix === "l" && sentenceParts.base === word) return false;
    if (inferVerbContext(parts, sentence).person) return false;
    const words = normalize(sentence).match(/[\p{L}]+/gu) || [];
    return words.some((candidate, index) => {
      if (candidate !== word) return false;
      const preceding = words[index - 1];
      if (strongNominalDeterminers.has(preceding)) return true;
      if (!articleDeterminers.has(preceding)) return false;
      // In “il la fait”, la is an object pronoun; in “le fait”, it is a
      // determiner. The extra look-behind avoids turning the former into a noun.
      return !subjectPronouns.has(words[index - 2]);
    });
  }

  function analyzeWord(rawWord, sentence = "") {
    const analysis = analyzeWithMorphology(rawWord, sentence) || fallbackAnalysis(rawWord, sentence);
    const parts = splitElidedClitic(rawWord);
    const nominalLemma = likelyNominalLemma(rawWord);
    // A feminine participle spelling such as psychée is not in the lexicon
    // itself, but reducing -ée to -é finds the attested noun.
    const hasNominalLexiconReading =
      lexicalGroups(rawWord).some((group) => group === "noun" || group === "adjective") ||
      nominalLemma !== parts.base;
    if (
      hasNominalDeterminer(rawWord, sentence) &&
      (analysis ? analysis.mood === "participle" || hasNominalLexiconReading : hasNominalLexiconReading)
    ) {
      const readings = analysis ? [analysis, ...(analysis.alternatives || [])] : [];
      const seenLemmas = new Set();
      return {
        surface: analysis?.surface || parts.surface,
        lemma: nominalLemma,
        partOfSpeech: "nominal",
        confidence: "context",
        alternatives: [],
        verbReadings: readings.filter((reading) => {
          if (!reading?.lemma || seenLemmas.has(reading.lemma)) return false;
          seenLemmas.add(reading.lemma);
          return true;
        }).slice(0, 3)
      };
    }
    return analysis;
  }

  function classifyWord(rawWord, sentence = "", suppliedAnalysis = null) {
    const analysis = suppliedAnalysis || analyzeWord(rawWord, sentence);
    const groups = lexicalGroups(rawWord);
    if (analysis?.partOfSpeech === "nominal") {
      const contextualGroup = groups.find((group) => group === "noun" || group === "adjective") || "noun";
      // Only offer a verb alternative when a verb reading was actually found.
      const candidates = analysis.verbReadings?.length ? [...groups, "verb"] : groups;
      return {
        group: contextualGroup,
        alternatives: Array.from(new Set(candidates)).filter((group) => group !== contextualGroup),
        confidence: "context"
      };
    }
    if (analysis?.partOfSpeech === "verb") {
      // tu, lui and plus are attested participles of taire, luire and plaire,
      // but in running text the closed-class reading is overwhelmingly likelier.
      const closed = closedWordGroup(rawWord);
      if (closed) {
        return {
          group: closed,
          alternatives: Array.from(new Set([...groups.filter((group) => group !== closed), "verb"])),
          confidence: "closed-class"
        };
      }
      return {
        group: "verb",
        alternatives: groups.filter((group) => group !== "verb"),
        confidence: analysis.confidence || "verified"
      };
    }
    return {
      group: groups[0] || "unknown",
      alternatives: groups.slice(1),
      confidence: groups.length ? "lexicon" : "unknown"
    };
  }

  function lookupReading(rawWord, sentence = "", suppliedAnalysis = null) {
    const analysis = suppliedAnalysis || analyzeWord(rawWord, sentence);
    const group = classifyWord(rawWord, sentence, analysis).group;
    const parts = splitElidedClitic(rawWord);
    const ambiguous = lexicalGroups(parts.base).some((value) => value === "noun" || value === "adjective") || parts.prefix === "l";
    let text = rawWord;
    if (analysis?.partOfSpeech === "verb" && ambiguous && ["indicative", "conditional", "subjunctive"].includes(analysis.mood)) {
      const pronouns = { "1st:singular": "je", "2nd:singular": "tu", "3rd:singular": "il", "1st:plural": "nous", "2nd:plural": "vous", "3rd:plural": "ils" };
      const subject = pronouns[`${analysis.person}:${analysis.number}`];
      if (subject) {
        const surface = parts.canonical;
        text = subject === "je" && /^[aeiouyàâäéèêëîïôöùûühœ]/iu.test(surface) ? `j'${surface}` : `${subject} ${surface}`;
        if (analysis.mood === "subjunctive") text = /^[aeiouy]/iu.test(text) ? `qu'${text}` : `que ${text}`;
      }
    } else if (group === "noun" && !parts.attached) {
      const compound = (normalize(sentence).match(/[\p{L}]+(?:['’][\p{L}]+)*/gu) || [])
        .find((word) => splitElidedClitic(word).prefix === "l" && splitElidedClitic(word).base === parts.base);
      if (compound) text = compound;
    }
    return { text, group, key: ambiguous ? `${group}:${analysis?.lemma || ""}:${text}` : "" };
  }

  const ready = initializeResources();
  globalThis.DualSubFrench = Object.freeze({
    analyzeWord,
    analyzeElisionParticle,
    classifyWord,
    lexicalInfo,
    lookupReading,
    ready,
    get engineState() { return morphologyState; },
    get wordGroupState() { return wordGroupState; },
    get lexicalInfoState() { return lexicalInfoState; }
  });
})();
