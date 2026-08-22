(() => {
  const formIndex = new Map();
  let morphologyEngine = null;
  let attestedLemmas = null;
  let morphologyState = "fallback";
  let wordGroupIndex = null;
  let wordGroupState = "fallback";

  async function initializeResources() {
    if (typeof browser === "undefined") return;
    morphologyState = "loading";
    wordGroupState = "loading";
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
    const [morphologyResult, wordGroupResult] = await Promise.allSettled([morphologyPromise, wordGroupPromise]);
    if (morphologyResult.status === "fulfilled") {
      attestedLemmas = morphologyResult.value;
      morphologyEngine = wasm_bindgen;
      morphologyState = "ready";
    } else morphologyState = "fallback";
    if (wordGroupResult.status === "fulfilled") {
      wordGroupIndex = wordGroupResult.value;
      wordGroupState = "ready";
    } else wordGroupState = "fallback";
  }

  function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("fr").normalize("NFC");
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

  const verbs = {
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

  Object.entries(verbs).forEach(([lemma, tenses]) => {
    Object.entries(tenses).forEach(([tense, forms]) => {
      if (tense === "conditional") addForms(lemma, "present", forms, "conditional");
      else addForms(lemma, tense, forms);
    });
  });

  const regularErVerbs = [
    "aimer", "arriver", "continuer", "demander", "donner", "écouter", "essayer", "expliquer", "jouer",
    "parler", "passer", "penser",
    "regarder", "rester", "travailler", "trouver", "utiliser"
  ];
  regularErVerbs.forEach((lemma) => {
    const stem = lemma.slice(0, -2);
    addForms(lemma, "present", [
      `${stem}e`, `${stem}es`, `${stem}e`, `${stem}ons`, `${stem}ez`, `${stem}ent`
    ]);
    addForms(lemma, "imperfect", [
      `${stem}ais`, `${stem}ais`, `${stem}ait`, `${stem}ions`, `${stem}iez`, `${stem}aient`
    ]);
  });

  const spellingChangeErVerbs = {
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
  Object.entries(spellingChangeErVerbs).forEach(([lemma, tenses]) => {
    Object.entries(tenses).forEach(([tense, forms]) => addForms(lemma, tense, forms));
  });

  const regularIrVerbs = ["choisir", "finir", "réfléchir", "remplir", "réussir"];
  regularIrVerbs.forEach((lemma) => {
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

  function fallbackAnalysis(rawWord) {
    const word = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word || word.includes(" ")) return null;
    const known = formIndex.get(word);
    const analysis = known?.[0] || regularAnalysis(word);
    if (!analysis) return null;
    return {
      surface: word,
      partOfSpeech: "verb",
      ...analysis,
      alternatives: known?.slice(1) || []
    };
  }

  const commonLemmaPriority = [
    "être", "avoir", "aller", "faire", "pouvoir", "vouloir", "devoir", "savoir", "dire", "venir",
    "voir", "prendre", "mettre", "suivre"
  ];

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
    const word = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word || word.includes(" ")) return null;
    if (word === "maintenant" && !/\ben\s+maintenant\b/iu.test(String(sentence || ""))) return null;
    const matches = morphologyEngine.reverseFrench(word)
      .filter((match) => attestedLemmas?.has(match.infinitive));
    if (!Array.isArray(matches) || !matches.length) return null;
    matches.sort((left, right) => {
      const leftRank = commonLemmaPriority.indexOf(left.infinitive);
      const rightRank = commonLemmaPriority.indexOf(right.infinitive);
      return (leftRank < 0 ? 999 : leftRank) - (rightRank < 0 ? 999 : rightRank) ||
        left.infinitive.length - right.infinitive.length || left.infinitive.localeCompare(right.infinitive, "fr");
    });
    const analyses = matches.flatMap((match) => (match.slots || []).map((slot) => (
      analysisFromMatch(word, match, slot)
    )));
    if (!analyses.length) return null;
    return { ...analyses[0], alternatives: analyses.slice(1, 7) };
  }

  const strongNominalDeterminers = new Set([
    "un", "une", "des", "ce", "cet", "cette", "ces",
    "mon", "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses",
    "notre", "nos", "votre", "vos", "leur", "leurs",
    "chaque", "quelque", "quelques", "plusieurs", "aucun", "aucune"
  ]);

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

  function lexicalGroups(rawWord) {
    const word = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    for (const [group, words] of closedWordGroups) {
      if (words.has(word)) return [group];
    }
    return Array.from(wordGroupIndex?.[word] || "", (code) => groupByCode[code]).filter(Boolean);
  }

  function likelyNominalLemma(rawWord) {
    const word = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    const candidates = [];
    if (word.endsWith("ées")) candidates.push(word.slice(0, -2));
    else if (word.endsWith("ée")) candidates.push(word.slice(0, -1));
    return candidates.find((candidate) =>
      lexicalGroups(candidate).some((group) => group === "noun" || group === "adjective")
    ) || word;
  }

  function hasNominalDeterminer(rawWord, sentence) {
    const word = normalize(rawWord).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    const words = normalize(sentence).match(/[\p{L}]+/gu) || [];
    const articles = new Set(["le", "la", "les", "l", "du", "au", "aux"]);
    const subjectPronouns = new Set(["je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles"]);
    return words.some((candidate, index) => {
      if (candidate !== word) return false;
      const preceding = words[index - 1];
      if (strongNominalDeterminers.has(preceding)) return true;
      if (!articles.has(preceding)) return false;
      // In “il la fait”, la is an object pronoun; in “le fait”, it is a
      // determiner. The extra look-behind avoids turning the former into a noun.
      return !subjectPronouns.has(words[index - 2]);
    });
  }

  function analyzeWord(rawWord, sentence = "") {
    const analysis = analyzeWithMorphology(rawWord, sentence) || fallbackAnalysis(rawWord);
    const hasNominalLexiconReading = lexicalGroups(rawWord).some((group) => group === "noun" || group === "adjective");
    if (
      analysis &&
      hasNominalDeterminer(rawWord, sentence) &&
      (analysis.mood === "participle" || hasNominalLexiconReading)
    ) {
      const readings = [analysis, ...(analysis.alternatives || [])];
      const seenLemmas = new Set();
      return {
        surface: analysis.surface,
        lemma: likelyNominalLemma(rawWord),
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
      return {
        group: contextualGroup,
        alternatives: Array.from(new Set([...groups, "verb"])).filter((group) => group !== contextualGroup),
        confidence: "context"
      };
    }
    if (analysis?.partOfSpeech === "verb") {
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

  function describe(analysis) {
    if (!analysis) return "";
    if (analysis.partOfSpeech === "nominal") return "This word is acting as a noun or adjective here.";
    const subjects = {
      "1st singular": "je",
      "2nd singular": "tu",
      "3rd singular": "il, elle, or on",
      "1st plural": "nous",
      "2nd plural": "vous",
      "3rd plural": "ils or elles"
    };
    const subject = subjects[`${analysis.person} ${analysis.number}`] || "";
    const subjectText = subject ? `, normally used with “${subject}”` : "";
    if (analysis.mood === "participle") {
      return analysis.tense === "past"
        ? "This is a past participle, used in compound past tenses or like an adjective."
        : "This is a present participle, expressing an action in progress (similar to English “-ing”).";
    }
    if (analysis.mood === "infinitive") return "This is the infinitive: the dictionary form of the verb.";
    if (analysis.mood === "imperative") return `This is a command or instruction${subjectText}.`;
    if (analysis.mood === "subjunctive") {
      return `This is a subjunctive form${subjectText}, often used for wishes, doubt, emotion, or necessity.`;
    }
    if (analysis.mood === "conditional") {
      return `This is a conditional form${subjectText}: it describes what would or could happen.`;
    }
    const tenseExplanations = {
      present: "It describes what is happening now or what happens generally.",
      imperfect: "It describes an ongoing, repeated, or background action in the past.",
      future: "It describes something that will happen.",
      past: "It describes something that happened in the past."
    };
    const tenseNames = {
      present: "present tense",
      imperfect: "imperfect tense",
      future: "future tense",
      past: "past tense"
    };
    const tenseName = tenseNames[analysis.tense] || `${analysis.tense || "conjugated"} form`;
    return `This is the ${tenseName}${subjectText}. ${tenseExplanations[analysis.tense] || ""}`.trim();
  }

  const ready = initializeResources();
  globalThis.DualSubFrench = Object.freeze({
    analyzeWord,
    classifyWord,
    describe,
    ready,
    get engineState() { return morphologyState; },
    get wordGroupState() { return wordGroupState; }
  });
})();
