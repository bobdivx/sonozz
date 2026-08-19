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

/** Gardes ACE / LeVo dérivées du DNA (voix growl → pas de vocoder), pas d’artistes en dur. */
export function artefactGuardsFromLock(lock) {
  if (!isLock(lock)) return [];
  return artefactGuardsFromBlob(styleLockGenreBlob(lock), lock);
}

function artefactGuardsFromBlob(blob = "", lock = null) {
  const g = norm(blob);
  const voice = norm(lock?.vocalStyle || "");
  const harsh = /growl|guttural|scream|harsh/.test(voice || g);
  if (!harsh) return [];
  if (blobLooksIndustrial(g) || blobLooksIndustrial(voice)) return [];
  return ["no vocoder", "no robotic vocals"];
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
        8,
      )
    : artefactGuardsFromBlob(raw).map((d) => d.replace(/^no /, "not "));
  const combined = [...head, raw, ...bans].filter(Boolean).join(". ");
  return (combined || raw).slice(0, 1000);
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
