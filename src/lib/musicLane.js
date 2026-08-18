/** Détection de lane sonore (metal extrême vs pop radio) pour prompts / arrangement. */

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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
    lock?.seedTrack?.title,
    lock?.seedTrack?.artistName,
    ...extraList,
  ]
    .filter(Boolean)
    .join(" ");
}

export function isMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
  return (
    /death\s*metal|black\s*metal|thrash|grindcore|metalcore|deathcore|doom\s*metal|speed\s*metal|heavy\s*metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    /blast beat|guttural|death growl|down-?tun(?:ed|ing)|tremolo pick|palm[- ]mute/.test(g)
  );
}

export function isExtremeMetalLane(blob = "") {
  const g = norm(blob);
  if (!g.trim()) return false;
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
    /death\s*metal|black\s*metal|thrash|grindcore|metalcore|deathcore|doom\s*metal|\bmetal\b|screamo/.test(
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
  return ["heavy metal", "distorted guitars", "live drum kit", "aggressive vocals"];
}

export function defaultBpmForGenre(genreHint = "") {
  const g = norm(genreHint);
  if (/dancehall|reggae/.test(g)) return 98;
  if (/afro/.test(g)) return 108;
  if (/trap|drill/.test(g)) return 138;
  if (/death\s*metal|black\s*metal|grindcore|thrash|deathcore/.test(g)) return 170;
  if (/metal|hardcore/.test(g)) return 150;
  return 110;
}

export function metalVoiceHint(genderCode = "male") {
  if (genderCode === "female") {
    return "harsh screamed female vocals, death metal growls, not clean pop singing";
  }
  return "guttural death metal growled male vocals, harsh not clean singing";
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
