/** Lane sonore depuis le DNA du lock (genres, voix, keywords) — pas de bible d’artistes. */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqStrings(list, max = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const s = String(raw || "").trim();
    if (!s) continue;
    const key = norm(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function isLock(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Blob de genres + DNA style (lock, artiste, extras).
 * Sert à décider Metal vs Rock iTunes générique.
 */
export function styleLockGenreBlob(lock, extras = []) {
  const extraList = Array.isArray(extras) ? extras : [extras];
  return [
    ...(Array.isArray(lock?.genres) ? lock.genres : []),
    lock?.genreSummary,
    lock?.musicPrompt,
    ...(Array.isArray(lock?.sonicKeywords) ? lock.sonicKeywords : []),
    lock?.vocalStyle,
    lock?.production,
    lock?.rhythmFeel,
    lock?.matchedName,
    lock?.query,
    lock?.seedTrack?.title,
    lock?.seedTrack?.artistName,
    ...extraList,
  ]
    .filter(Boolean)
    .join(" ");
}

/** iTunes « Rock » vs sous-genre metal : on lit les mots du DNA, pas une liste de groupes. */
export function isThrashLane(blob = "") {
  const g = stripNegatedMetal(norm(blob));
  if (!g.trim()) return false;
  return /\b(thrash|speed metal|crossover thrash)\b/.test(g);
}

export function isMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  if (isThrashLane(g)) return true;
  return (
    /death\s*metal|black\s*metal|grindcore|metalcore|deathcore|doom\s*metal|speed\s*metal|heavy\s*metal|power\s*metal|groove\s*metal|nu[- ]?metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    /blast beat|guttural|death growl|down-?tun(?:ed|ing)|tremolo pick|palm[- ]mute/.test(g)
  );
}

/** Retire « not death metal » / « avoid death growl » pour ne pas inverser la lane. */
function stripNegatedMetal(g) {
  return String(g || "")
    .replace(/\bnot\s+death[- ]?metal\b/g, " ")
    .replace(/\bavoid\s+death(?:[- ]metal)?(?:\s+growl)?\b/g, " ")
    .replace(/\bnever\s+death[- ]?metal\b/g, " ");
}

export function isExtremeMetalLane(blob = "") {
  const g = stripNegatedMetal(norm(blob));
  if (!g.trim()) return false;
  if (isThrashLane(g) && !/death\s*metal|black\s*metal|grind|guttural|brutal death|deathcore/.test(g)) {
    return false;
  }
  return (
    /death\s*metal|black\s*metal|grindcore|deathcore|brutal death|goregrind|slam metal/.test(g) ||
    (/metal/.test(g) && /brutal|guttural|blast beat/.test(g))
  );
}

/** iTunes range le death metal en « Rock » — on droppe l’ombrelle si un sous-genre existe. */
export function coalesceGenres(list = []) {
  const uniq = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : [list]) {
    const g = String(raw || "").trim();
    if (!g) continue;
    const key = norm(g);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(g);
  }
  const blob = uniq.join(" ");
  let out = uniq;
  if (isMetalLane(blob)) {
    const filtered = uniq.filter((g) => {
      const n = norm(g);
      if (/^(rock|pop)$/.test(n)) return false;
      if (/rock\s*\/\s*indie|indie rock|pop contemporaine|pop urbaine/.test(n)) return false;
      return true;
    });
    if (filtered.length) out = filtered;
  }
  return sortGenresSpecificFirst(out).slice(0, 6);
}

export function sortGenresSpecificFirst(list = []) {
  const score = (g) => {
    const n = norm(g);
    if (/death\s*metal|black\s*metal|grindcore|deathcore/.test(n)) return 0;
    if (/metal|hardcore|screamo|thrash/.test(n)) return 1;
    if (/punk|hard rock/.test(n)) return 2;
    if (/^rock$|indie rock|rock \//.test(n)) return 8;
    if (/^pop$|pop contemporaine/.test(n)) return 9;
    return 5;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

/**
 * Genre SongGeneration Studio (clés GENRE_TO_AUTO_PROMPT).
 * Tester la chaîne entière : « Rock, Death Metal » doit matcher Metal, pas Rock.
 */
export function mapGenreForStudio(genre = "") {
  const g = norm(genre).trim();
  if (!g) return "Pop";

  if (/afro-?trap|afrobeat|afrobeats|amapiano|dancehall|reggae|ska|\bdub\b/.test(g)) {
    return "Reggae";
  }
  if (/gospel|inspirational|choir|spiritual|worship/.test(g)) return "R&B";
  if (/r&?b|soul|neo-?soul|motown|funk/.test(g)) return "R&B";
  if (
    isThrashLane(g) ||
    /death\s*metal|black\s*metal|thrash|grindcore|metalcore|deathcore|doom\s*metal|heavy\s*metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    (/hardcore/.test(g) && !/techno|house|gabber/.test(g))
  ) {
    return "Metal";
  }
  if (/rock|punk|garage|grunge|britpop|indie rock/.test(g)) return "Rock";
  if (/jazz|bossa|swing|blues/.test(g)) return "Jazz";
  if (/folk|acoustic|chanson|singer-?songwriter|americana|country|bluegrass/.test(g))
    return "Folk";
  if (
    /electro|edm|\bdance\b|house|techno|hyperpop|synth|electronic|trance|dubstep|drum.?and.?bass|ambient|indie electronic/.test(
      g,
    )
  ) {
    return "Electronic";
  }
  if (/latin|reggaeton|salsa|bachata|cumbia/.test(g)) return "Pop";
  if (/hip[\s-]?hop|rap|trap|drill|boom\s*bap|grime/.test(g)) return "Pop";
  if (/chinese|c-pop|mandopop/.test(g)) return "Chinese Style";
  if (/ballad|slow jam|love song/.test(g)) return "R&B";
  if (/pop|variete|variety|k-?pop|j-?pop|dream pop|indie pop/.test(g)) return "Pop";
  return "Pop";
}

function flavorFromLock(lock) {
  return uniqStrings(
    [
      lock?.genreSummary,
      ...(Array.isArray(lock?.sonicKeywords) ? lock.sonicKeywords : []),
      lock?.vocalStyle,
      lock?.production,
      lock?.rhythmFeel,
      ...(Array.isArray(lock?.instruments) ? lock.instruments.slice(0, 4) : []),
    ],
    8,
  );
}

function flavorFromKeywords(blob = "") {
  if (!isMetalLane(blob)) return [];
  const g = norm(blob);
  const tags = [];
  if (/death\s*metal|brutal/.test(g)) tags.push("death metal", "distorted guitars", "live drum kit");
  if (/black\s*metal/.test(g)) tags.push("black metal", "tremolo picking");
  if (/guttural|growl/.test(g)) tags.push("guttural growls");
  if (/blast/.test(g)) tags.push("blast beats");
  if (/thrash|speed metal/.test(g)) tags.push("thrash metal", "palm-muted guitars", "live drum kit");
  if (!tags.length) tags.push("heavy metal", "distorted guitars", "live drum kit");
  for (const ban of artefactGuardsFromBlob(blob)) tags.push(ban);
  return uniqStrings(tags, 8);
}

/**
 * Tags de couleur : DNA du lock en priorité, sinon mots déjà présents dans le blob.
 * @param {string|object} blobOrLock
 */
export function metalFlavorTags(blobOrLock = "") {
  if (isLock(blobOrLock)) {
    const fromLock = flavorFromLock(blobOrLock);
    if (fromLock.length) return uniqStrings([...fromLock, ...artefactGuardsFromLock(blobOrLock)], 10);
    return flavorFromKeywords(styleLockGenreBlob(blobOrLock));
  }
  return flavorFromKeywords(blobOrLock);
}

export function defaultBpmForGenre(genreHint = "") {
  const g = norm(genreHint);
  if (/dancehall|reggae/.test(g)) return 98;
  if (/afro/.test(g)) return 108;
  if (/trap|drill/.test(g)) return 138;
  if (/death\s*metal|black\s*metal|grindcore|deathcore/.test(g)) return 170;
  if (/thrash|speed metal/.test(g)) return 140;
  if (/metal|hardcore/.test(g)) return 150;
  return 110;
}

/**
 * Voix : vocalStyle du lock, sinon fallback générique selon la lane détectée dans le blob.
 */
export function metalVoiceHint(genderCode = "male", blob = "", lock = null) {
  const fromLock = String(lock?.vocalStyle || "").trim();
  if (fromLock) return fromLock;
  const extreme = isExtremeMetalLane(blob);
  const thrash = isThrashLane(blob);
  if (genderCode === "female") {
    if (extreme) return "harsh screamed female vocals, not clean pop singing";
    if (thrash) return "aggressive female thrash vocals, rhythmic barked delivery, not pop belting";
    return "aggressive female metal vocals, not clean pop singing";
  }
  if (extreme) return "guttural death metal growled male vocals, not clean singing";
  if (thrash) {
    return "aggressive male thrash vocals, rhythmic barking, raspy baritone, not pop crooning";
  }
  return "aggressive male metal vocals, shouted and raspy, not pop crooning";
}

function blobLooksIndustrial(blob = "") {
  return /industrial|\bebm\b|vocoder/.test(norm(blob));
}

/** Gardes ACE / LeVo dérivées du DNA (growl harsh seulement) — pas de liste « no vocoder » globale. */
export function artefactGuardsFromLock(lock) {
  if (!isLock(lock)) return [];
  return artefactGuardsFromBlob(styleLockGenreBlob(lock), lock);
}

/**
 * Plancher de qualité prod ACE — court, positif.
 * Priorité headroom / voix propres (évite le mix « trop chaud » / saturé).
 */
export function aceStepProductionQualityFloor({ duo = false } = {}) {
  return [
    "balanced studio mix with headroom, clean clear lead vocal, controlled low-end",
    duo
      ? "arrangement supports the active tagged singer"
      : "full band under the lead without crowding the vocal",
  ].join(". ");
}

function artefactGuardsFromBlob(blob = "", lock = null) {
  const g = norm(blob);
  const voice = norm(lock?.vocalStyle || "");
  const harsh = /growl|guttural|scream|harsh/.test(voice || g);
  if (!harsh) return [];
  if (blobLooksIndustrial(g) || blobLooksIndustrial(voice)) return [];
  // Uniquement si growl metal : éviter le glitch vocal industriel non voulu
  return ["clean recorded vocals"];
}

/**
 * Style ACE-Step : DNA du lock en tête (tronqué), sans bible de genre.
 */
export function composeAceStepStyle(style = "", lock = null) {
  const raw = String(style || "pop, emotional, radio-ready").trim();
  const head = isLock(lock)
    ? uniqStrings(
        [lock.genreSummary, lock.vocalStyle, ...(Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords : [])],
        6,
      )
    : [];
  const bans = isLock(lock)
    ? uniqStrings(
        [
          ...(Array.isArray(lock.doNot) ? lock.doNot.map((d) => `not ${d}`) : []),
          ...artefactGuardsFromLock(lock).map((d) => d.replace(/^no /, "not ")),
        ],
        6,
      )
    : [];
  const combined = [...head, raw, ...bans].filter(Boolean).join(". ");
  return (combined || raw).slice(0, 1000);
}

/**
 * Arrangement « hit commercial » pour ACE-Step (solo ou duo).
 * Priorité : multi-instruments + arcs dynamiques (pas de boucle linéaire drums-only).
 * Le genre choisit les instruments ; le polish reste le même pour tous.
 */
export function aceStepCommercialArrangementBits(lock = null, { duo = false } = {}) {
  const genre = norm(
    [lock?.genreSummary, ...(Array.isArray(lock?.genres) ? lock.genres : [])].filter(Boolean).join(" "),
  );
  const fromLock = Array.isArray(lock?.instruments)
    ? lock.instruments.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6)
    : [];

  let band = fromLock;
  if (band.length < 3) {
    if (/trap|hip[\s-]?hop|drill|\brap\b|boom\s*bap|grime/.test(genre)) {
      band = ["808 bass", "trap drums", "hi-hats", "synth pads", "piano chords", "melodic hook"];
    } else if (/r&?b|soul|gospel|neo[\s-]?soul|sister act|church/.test(genre)) {
      band = ["drum kit", "bass", "Hammond organ", "piano", "handclaps", "gospel choir pads"];
    } else if (/electro|edm|\bdance\b|house|techno|hyperpop|synth/.test(genre)) {
      band = ["kick", "bass", "synth pads", "arpeggios", "risers", "lead synth"];
    } else if (/metal|hardcore|punk/.test(genre)) {
      band = metalBandInstruments().slice(0, 5);
    } else if (/rock|grunge|indie rock/.test(genre)) {
      band = ["drum kit", "bass guitar", "rhythm guitars", "lead guitar", "cymbals"];
    } else if (/afro|dancehall|reggae|amapiano/.test(genre)) {
      band = ["drums", "bass", "guitar skank", "keys", "percussion", "pads"];
    } else if (/pop|radio|ballad/.test(genre)) {
      band = ["drums", "bass", "keys", "guitars", "pads", "catchy melodic hook"];
    } else {
      band = ["drums", "bass", "keys or guitars", "pads", "percussion", "catchy melodic hook"];
    }
  }

  const prod = String(lock?.production || "").trim();
  const rhythm = String(lock?.rhythmFeel || "").trim();

  return [
    "streaming-ready commercial hit — Billboard / playlist quality (same bar for every genre)",
    `layered multi-instrument bed: ${band.join(", ")}`,
    "never drums-only, never sparse bed, never thin loop under vocals",
    "dynamic arrangement arc: sparse intro → verse groove → pre-chorus lift → big chorus → contrasting bridge → biggest final chorus → outro",
    "change layers between sections (fills, drops, add guitars/keys/pads) — NOT one flat linear loop",
    rhythm ? `groove: ${rhythm}` : null,
    prod
      ? `production: ${prod}`
      : "wide stereo, controlled low-end, clean vocal midrange, polished mastering with headroom",
    duo
      ? "duet vocals sit cleanly inside a full commercial band mix"
      : "lead vocal sits cleanly on top of a full commercial band mix",
  ].filter(Boolean);
}

/**
 * Presets de forme paroles (tags MiniMax/ACE anglais).
 * Variés par lane — pas toujours le même arc radio.
 */
export const LYRICS_FORM_PRESETS = {
  radio_pop: {
    id: "radio_pop",
    label: "Radio / pop",
    tagsArc:
      "[Intro], [Verse], [Pre-Chorus], [Chorus], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Pre-Chorus", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Hit radio: Pre-Chorus monte la tension; Chorus porte le hook mémorable; Bridge contraste (nouveau angle, pas un 3e verse); dernier Chorus plus large (ad-libs OK).",
  },
  rap_trap: {
    id: "rap_trap",
    label: "Rap / trap",
    tagsArc: "[Intro], [Verse], [Hook], [Verse], [Hook], [Bridge], [Hook], [Outro]",
    requiredTags: ["Intro", "Verse", "Hook", "Outro"],
    hookTag: "Hook",
    requireDistinctVerses: true,
    craftNotes:
      "Rap/trap: Verses denses (punchlines, flux); Hook COURT et collant (2–4 lignes); Bridge optionnel mais utile pour casser le rythme; pas de Pre-Chorus long.",
  },
  edm: {
    id: "edm",
    label: "EDM / dance",
    tagsArc: "[Intro], [Build], [Drop], [Break], [Build], [Drop], [Outro]",
    requiredTags: ["Intro", "Build", "Drop", "Outro"],
    hookTag: "Drop",
    requireDistinctVerses: false,
    craftNotes:
      "EDM: peu de paroles hors Drop/Hook; Build = tension (phrases courtes / counts); Drop = hook chanté ou cris mélodiques; Break = respiration; éviter un récit linéaire couplet/refrain.",
  },
  ballad: {
    id: "ballad",
    label: "Ballade",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Bridge], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Ballade: pas de Pre-Chorus forcé; Verses narratifs et intimes; Chorus émotionnel avec hook simple; Bridge = pivot émotionnel; densités plus aérées (lignes plus longues OK).",
  },
  metal: {
    id: "metal",
    label: "Metal",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Breakdown], [Chorus], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Breakdown", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Metal: Chorus accrocheur; Breakdown = contraste rythmique / slogans courts (pas un 3e verse); Verses distincts (images, tension); Outro peut reprendre un motif du Chorus.",
  },
  indie_alt: {
    id: "indie_alt",
    label: "Indie / alt",
    tagsArc: "[Intro], [Verse], [Chorus], [Verse], [Chorus], [Bridge], [Outro]",
    requiredTags: ["Intro", "Verse", "Chorus", "Bridge", "Outro"],
    hookTag: "Chorus",
    requireDistinctVerses: true,
    craftNotes:
      "Indie/alt: Chorus moins « radio » (plus d’atmosphère); Bridge contrasté; forme un peu plus libre mais garder Intro/Verses distincts/Chorus/Bridge/Outro; éviter le Pre-Chorus mécanique.",
  },
};

/** Alias historique = arc radio pop (compat duo / ACE). */
export const ACE_COMMERCIAL_LYRICS_STRUCTURE = LYRICS_FORM_PRESETS.radio_pop.tagsArc;

export function getLyricsFormPreset(idOrPreset) {
  if (idOrPreset && typeof idOrPreset === "object" && idOrPreset.tagsArc) return idOrPreset;
  const id = String(idOrPreset || "").trim();
  return LYRICS_FORM_PRESETS[id] || LYRICS_FORM_PRESETS.radio_pop;
}

/**
 * Choisit une forme paroles selon le DNA genre (lock + artiste).
 * Priorité: rap → edm → ballad → metal → indie → radio_pop.
 */
export function detectLyricsForm(lock = null, artist = null) {
  const blob = norm(
    styleLockGenreBlob(lock, [
      artist?.genre,
      ...(Array.isArray(artist?.genres) ? artist.genres : []),
      artist?.mood,
      lock?.writingStyle,
    ]),
  );

  if (/\b(hip[\s-]?hop|trap|drill|\brap\b|boom\s*bap|grime|afro[\s-]?trap)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.rap_trap;
  }
  if (/\b(edm|house|techno|hyperpop|trance|dubstep|drum\s*and\s*bass|dnb)\b/.test(blob) || /\bdance\b/.test(blob)) {
    // dancehall / afro-dance restent hors EDM pur si déjà captés ailleurs
    if (!/\bdancehall\b/.test(blob)) return LYRICS_FORM_PRESETS.edm;
  }
  if (/\b(ballad|acoustic|soft\s*rock|lullaby|piano\s*ballad|power\s*ballad)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.ballad;
  }
  if (isMetalLane(blob)) {
    return LYRICS_FORM_PRESETS.metal;
  }
  if (/\b(indie|alternative|alt[\s-]?rock|shoegaze|post[\s-]?punk|dream\s*pop)\b/.test(blob)) {
    return LYRICS_FORM_PRESETS.indie_alt;
  }
  return LYRICS_FORM_PRESETS.radio_pop;
}

/** Brief songwriter commun + notes du preset (injecté dans runLyrics). */
export function buildLyricsCraftBrief(form) {
  const preset = getLyricsFormPreset(form);
  const hook = preset.hookTag || "Chorus";
  return `
CRAFT SONGWRITER (titre réel de prod, pas une litanie linéaire) :
- Forme imposée « ${preset.id} » (${preset.label}) — suis EXACTEMENT cet arc de tags: ${preset.tagsArc}
- Hook: 1 ligne ultra-mémorable, répétée / paraphrasée dans chaque [${hook}]
- Rôles: Intro = ambiance (peu ou pas de récit); sections narratives = storytelling; [${hook}] = émotion + hook; section contraste (Bridge / Breakdown / Break) = NOUVEL angle, pas un verse copié; Outro = résolution
- Densités indicatives: Verse/Build 4–8 lignes; ${hook} 2–4; Bridge/Breakdown/Break 2–4; Intro/Outro 0–3
- Les sections narratives répétées (2+ [Verse] ou 2+ [Build]) DOIVENT différer (pas de copier-coller)
- Interdit: même rythme de phrase partout, structure hors preset, tags FR (utilise les tags EN du preset)
- Notes lane: ${preset.craftNotes}
`.trim();
}

/**
 * Ne réécrit pas le DNA : coalesce les genres catalogue (Rock + Death Metal → Death Metal).
 */
export function withKnownArtistLane(lock) {
  if (!lock || typeof lock !== "object") return lock;
  const genres = coalesceGenres(lock.genres);
  return { ...lock, genres };
}

export function metalBandInstruments() {
  return [
    "distorted electric guitar",
    "down-tuned rhythm guitar",
    "bass guitar",
    "double kick drums",
    "palm-muted riffs",
  ];
}
