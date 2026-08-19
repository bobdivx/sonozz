/** Détection de lane sonore (metal extrême vs thrash vs pop radio) pour prompts / arrangement. */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Artistes dont le catalogue iTunes/Deezer dit souvent « Rock »
 * alors que la lane réelle est metal.
 */
const METAL_ARTIST_RE =
  /\b(metallica|slayer|megadeth|anthrax|pantera|sepultura|testament|exodus|overkill|kreator|sodom|destruction|iron maiden|judas priest|black sabbath|motorhead|motley crue|megadeth|cannibal corpse|morbid angel|obituary|deicide|behemoth|mayhem|emperor|opeth|gojira|mastodon|lamb of god|machine head|in flames|arch enemy|at the gates|carcass|napalm death|meshuggah|slipknot|korn|rammstein|system of a down|sabaton|amon amarth|children of bodom)\b/;

const THRASH_RE =
  /\b(thrash|speed metal|crossover thrash|metallica|slayer|megadeth|anthrax|testament|exodus|overkill|kreator|sodom)\b/;

const DEATH_METAL_ARTIST_RE =
  /\b(cannibal corpse|morbid angel|obituary|deicide|suffocation|dying fetus|cryptopsy|six feet under|malevolent creation|incantation|bolt thrower)\b/;

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

export function isKnownMetalArtist(blob = "") {
  return METAL_ARTIST_RE.test(norm(blob));
}

export function isThrashLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  return THRASH_RE.test(g);
}

export function isMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  if (isKnownMetalArtist(g) || isThrashLane(g)) return true;
  return (
    /death\s*metal|black\s*metal|grindcore|metalcore|deathcore|doom\s*metal|speed\s*metal|heavy\s*metal|power\s*metal|groove\s*metal|nu[- ]?metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    /blast beat|guttural|death growl|down-?tun(?:ed|ing)|tremolo pick|palm[- ]mute/.test(g)
  );
}

export function isExtremeMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  if (DEATH_METAL_ARTIST_RE.test(g)) return true;
  if (isThrashLane(g) && !/death\s*metal|black\s*metal|grind|cannibal|guttural/.test(g)) {
    return false;
  }
  return (
    /death\s*metal|black\s*metal|grindcore|deathcore|brutal death|goregrind|slam metal/.test(g) ||
    (/metal/.test(g) && /brutal|growl|guttural|blast|scream|cannibal/.test(g))
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
    isKnownMetalArtist(g) ||
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

export function metalFlavorTags(blob = "") {
  if (!isMetalLane(blob)) return [];
  if (isExtremeMetalLane(blob)) {
    return [
      "brutal death metal",
      "blast beats",
      "down-tuned distorted guitars",
      "guttural growls",
      "tremolo picking",
      "double kick drums",
      "crushing dense mix",
    ];
  }
  if (isThrashLane(blob) || /metallica/.test(norm(blob))) {
    return [
      "American thrash metal",
      "heavy metal",
      "James Hetfield strict downpicking",
      "tight palm-muted E-string chugs",
      "scooped Mesa Boogie high-gain rhythm guitars",
      "Hetfield-style barked rhythmic vocals, not death-metal snarling, not pop crooning",
      "Kirk Hammett wah-soaked lead guitar",
      "live drum kit, cracking snare, no programmed beats",
      "no synth pads, no piano pop, no Billboard polish",
    ];
  }
  return ["heavy metal", "distorted guitars", "live drum kit", "aggressive vocals"];
}

export function defaultBpmForGenre(genreHint = "") {
  const g = norm(genreHint);
  if (/dancehall|reggae/.test(g)) return 98;
  if (/afro/.test(g)) return 108;
  if (/trap|drill/.test(g)) return 138;
  if (/death\s*metal|black\s*metal|grindcore|deathcore/.test(g)) return 170;
  if (/thrash|metallica|slayer|megadeth/.test(g)) return 140;
  if (/metal|hardcore/.test(g)) return 150;
  return 110;
}

export function metalVoiceHint(genderCode = "male", blob = "") {
  const extreme = isExtremeMetalLane(blob);
  const thrash = isThrashLane(blob) || /metallica/.test(norm(blob));
  if (genderCode === "female") {
    if (extreme) return "harsh screamed female vocals, death metal growls, not clean pop singing";
    if (thrash) {
      return "aggressive female thrash vocals, rhythmic barked delivery, not pop belting";
    }
    return "aggressive female metal vocals, not clean pop singing";
  }
  if (extreme) return "guttural death metal growled male vocals, harsh not clean singing";
  if (thrash) {
    return "aggressive male thrash vocals, Hetfield-style rhythmic barking and percussive shouting, raspy baritone, not death-metal snarling, not pop crooning";
  }
  return "aggressive male metal vocals, shouted and raspy, not pop crooning";
}

function lockReferenceArtist(lock) {
  return norm(lock.seedTrack?.artistName || lock.matchedName || "");
}

function applyBrutalDeathLane(lock) {
  return {
    ...lock,
    genres: coalesceGenres(["Brutal Death Metal", "Death Metal", ...(lock.genres || [])]),
    genreSummary:
      "American brutal death metal: down-tuned crushing guitars, blast beats, tremolo riffs, guttural growled vocals, dense live kit",
    energy: "high",
    vocalStyle: "guttural death metal growled male vocals, harsh not clean singing",
    doNot: uniqStrings(
      [
        ...(Array.isArray(lock.doNot) ? lock.doNot : []),
        "synth pads",
        "EDM",
        "Billboard pop polish",
        "clean singing",
        "acoustic ballad",
        "Hetfield barked vocals",
        "wah guitar hero leads",
        "scooped thrash Mesa tone",
        "pop crooning",
      ],
      12,
    ),
  };
}

function applyMetallicaLane(lock) {
  const seedTitle = norm(lock.seedTrack?.title || "");
  const balladSeed = /nothing else matters|unforgiven|mama said/.test(seedTitle);
  return {
    ...lock,
    genres: coalesceGenres(["Thrash Metal", "Heavy Metal", ...(lock.genres || [])]),
    genreSummary:
      "American thrash and heavy metal: strict downpicked palm-muted riffs, scooped high-gain Mesa/Boogie guitars, barked rhythmic vocals, wah leads, live kit",
    energy: balladSeed ? lock.energy || "mid" : "high",
    vocalStyle: balladSeed
      ? "emotive raspy baritone that still barks rhythm parts, not pop crooning"
      : "Hetfield-style barked rhythmic vocals, percussive shouting, raspy baritone",
    doNot: uniqStrings(
      [
        ...(Array.isArray(lock.doNot) ? lock.doNot : []),
        "synth pads",
        "EDM",
        "Billboard pop polish",
        "death growl",
        "piano pop ballad",
        "clean pop singing",
      ],
      10,
    ),
  };
}

/**
 * Corrige un lock déjà généré.
 * Le titre / artiste de référence (seed) prime sur un ancien DNA encore collé
 * (ex. Metallica resté dans query après un switch vers Cannibal Corpse).
 */
export function withKnownArtistLane(lock) {
  if (!lock || typeof lock !== "object") return lock;
  const ref = lockReferenceArtist(lock);
  const blob = styleLockGenreBlob(lock, [lock.matchedName, lock.query]);
  const g = norm(blob);

  if (DEATH_METAL_ARTIST_RE.test(ref) || (DEATH_METAL_ARTIST_RE.test(g) && !/metallica/.test(ref))) {
    return applyBrutalDeathLane(lock);
  }
  if (/metallica/.test(ref) || (/metallica/.test(g) && !DEATH_METAL_ARTIST_RE.test(ref))) {
    return applyMetallicaLane(lock);
  }
  return lock;
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
