/**
 * Variation sonore par piste autour du DNA artiste.
 * Album (arc) + titres solo (rôle stable par titre) → moins de clones.
 */
import {
  FEATURE_TAGS,
  LEAD_INSTRUMENTS,
  emptyMusicArrange,
  isDefaultMusicArrange,
  musicArrangeFromStyleLock,
  normalizeMusicArrange,
} from "./musicArrange.js";
import { defaultBpmForGenre, styleLockGenreBlob } from "./musicLane.js";

export const SONIC_ROLE_IDS = [
  "single",
  "opener",
  "midtempo",
  "ballad",
  "banger",
  "deep_cut",
  "closer",
];

const FEATURE_IDS = new Set(FEATURE_TAGS.map((f) => f.id));
const LEAD_IDS = new Set(
  LEAD_INSTRUMENTS.map((x) => x.id).filter(Boolean),
);

/**
 * Profils : deltas autour du DNA, pas un nouveau genre.
 * `instrumentArc` = plan de couches pour CETTE piste (ACE / SongGen) —
 * pas une règle moteur globale.
 */
export const SONIC_ROLES = {
  single: {
    label: "Single",
    density: "mid",
    bpmDelta: 0,
    energy: "high",
    mood: "anthemic radio hook",
    features: [],
    leadBias: [],
    instrumentArc:
      "radio single arc: verse lean bed → pre adds pads → chorus full band + hook layers → thin bridge → densest final",
  },
  opener: {
    label: "Ouverture",
    density: "mid",
    bpmDelta: -4,
    energy: "mid",
    mood: "cinematic rising",
    features: ["spoken intro"],
    leadBias: ["piano", "synth lead", "strings"],
    instrumentArc:
      "opener arc: sparse piano/pad intro → verse + light drums → chorus adds strings/synth → rising bridge → big final",
  },
  midtempo: {
    label: "Midtempo",
    density: "mid",
    bpmDelta: -6,
    energy: "mid",
    mood: "groovy midtempo",
    features: ["sidechain pump"],
    leadBias: ["808 bass", "synth lead", "electric guitar"],
    instrumentArc:
      "midtempo groove: verse bass+drums → pre sidechain lift → chorus adds lead/synth layers → drop bridge → densest final",
  },
  ballad: {
    label: "Ballade",
    density: "mid",
    bpmDelta: -14,
    energy: "low",
    mood: "intimate emotional",
    features: ["string swell", "fingerpicked guitar"],
    leadBias: ["piano", "acoustic guitar", "strings"],
    instrumentArc:
      "ballad arc: verse fingerpicked/piano only → pre soft pads → chorus strings swell + soft drums → intimate bridge → warm final",
  },
  banger: {
    label: "Banger",
    density: "dense",
    bpmDelta: 8,
    energy: "high",
    mood: "peak high energy",
    features: ["breakdown drop"],
    leadBias: ["808 bass", "electric guitar", "synth lead", "brass section"],
    instrumentArc:
      "banger arc: verse tight drums+bass → pre risers → chorus max layers + brass/guitar → breakdown drop → biggest final",
  },
  deep_cut: {
    label: "Deep cut",
    density: "mid",
    bpmDelta: -2,
    energy: "mid",
    mood: "moody reflective",
    features: [],
    leadBias: [],
    instrumentArc:
      "deep-cut arc: moody verse sparse → chorus adds unexpected color layer → stripped bridge → restrained final (not radio max)",
  },
  closer: {
    label: "Final",
    density: "mid",
    bpmDelta: -10,
    energy: "low",
    mood: "resolving farewell",
    features: ["string swell"],
    leadBias: ["piano", "strings", "acoustic guitar"],
    instrumentArc:
      "closer arc: soft verse → chorus with strings → thinner farewell bridge → resolving final (fade-friendly layers)",
  },
};

/**
 * Compose l’arc instrumental de la piste (rôle + arrange utilisateur).
 * Court : doit survivre au plafond ACE ~360c.
 */
export function composeInstrumentArc(role, musicArrange = null) {
  const id = normalizeSonicRole(role) || "single";
  const profile = SONIC_ROLES[id] || SONIC_ROLES.single;
  let arc = String(profile.instrumentArc || "").trim();
  const arr = normalizeMusicArrange(musicArrange);
  const extras = [];
  if (arr.leadInstrument) extras.push(`lead=${arr.leadInstrument}`);
  if (arr.drums) extras.push(`drums=${arr.drums}`);
  if (arr.density && arr.density !== "mid") extras.push(`density=${arr.density}`);
  const feats = (arr.features || []).slice(0, 2);
  if (feats.length) extras.push(`feat=${feats.join("+")}`);
  if (extras.length) {
    arc = `${arc}; ${extras.join(", ")}`.slice(0, 220);
  }
  return arc;
}

function hashStr(s) {
  let h = 2166136261;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalizeSonicRole(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (SONIC_ROLES[id]) return id;
  const aliases = {
    lead: "single",
    radio: "single",
    hit: "single",
    opening: "opener",
    intro: "opener",
    slow: "ballad",
    peak: "banger",
    bop: "banger",
    deep: "deep_cut",
    album_cut: "deep_cut",
    outro: "closer",
    finale: "closer",
  };
  return aliases[id] || null;
}

/**
 * Arc album (index 1-based, lead inclus).
 * Lead ≈ single ; fin = closer ; milieu : rôles DISTINCTS (pas de doubles précoces).
 */
export function albumArcRole(trackIndex, trackTotal) {
  const i = Math.max(1, Number(trackIndex) || 1);
  const n = Math.max(i, Number(trackTotal) || i);
  if (i === 1) return "single";
  if (i === n && n > 1) return "closer";
  // Ordre pensé pour contrastes forts entre voisins (énergie / densité / lead).
  const mid = ["opener", "banger", "ballad", "midtempo", "deep_cut", "banger", "opener", "midtempo"];
  const midCount = Math.max(0, n - 2);
  const midIndex = i - 2;
  if (midCount <= 0) return "deep_cut";
  // Sur albums courts : échantillonner le cycle pour maximiser la diversité.
  if (midCount <= mid.length) {
    const step = Math.max(1, Math.floor(mid.length / midCount));
    return mid[(midIndex * step) % mid.length];
  }
  return mid[midIndex % mid.length];
}

/** Pool de leads pour diversifier un album (hors biais de rôle). */
const ALBUM_LEAD_POOL = [
  "piano",
  "electric guitar",
  "acoustic guitar",
  "synth lead",
  "808 bass",
  "strings",
  "brass section",
  "organ",
  "saxophone",
];

const ALBUM_DRUM_POOL = [
  "live kit",
  "trap 808s",
  "boom bap",
  "four-on-floor",
  "brush jazz",
  "latin percussion",
];

/**
 * Pools compatibles avec la LANE de l'artiste : sans ça, un artiste electro-rock viking
 * pouvait recevoir « saxophone » + « brush jazz » sur un titre d'album (dilution du DNA).
 */
const LANE_POOLS = [
  {
    re: /metal|\brock\b|punk|grunge|viking|nordic|hardcore|industrial|post-?rock|stoner/,
    leads: ["electric guitar", "synth lead", "strings", "organ", "piano"],
    drums: ["live kit"],
  },
  {
    re: /electro|edm|\bdance\b|house|techno|trance|synth|dubstep|drum ?(and|&|n) ?bass|hyperpop|electronic/,
    leads: ["synth lead", "808 bass", "piano", "strings"],
    drums: ["four-on-floor", "trap 808s", "live kit"],
  },
  {
    re: /hip[\s-]?hop|\brap\b|trap|drill|grime|boom ?bap/,
    leads: ["808 bass", "piano", "synth lead", "strings", "electric guitar"],
    drums: ["trap 808s", "boom bap"],
  },
  {
    re: /soul|gospel|r&?b|funk|motown|disco/,
    leads: ["organ", "piano", "brass section", "electric guitar", "saxophone", "strings"],
    drums: ["live kit", "boom bap"],
  },
  {
    re: /jazz|swing|bossa|lounge|blues/,
    leads: ["piano", "saxophone", "trumpet", "acoustic guitar", "organ", "brass section"],
    drums: ["brush jazz", "live kit"],
  },
  {
    re: /latin|reggaeton|salsa|cumbia|bachata|afro|dancehall|reggae/,
    leads: ["acoustic guitar", "brass section", "piano", "synth lead", "808 bass"],
    drums: ["latin percussion", "trap 808s", "live kit"],
  },
  {
    re: /folk|acoustic|singer|americana|country|indie|chanson|vari[eé]t[eé]/,
    leads: ["acoustic guitar", "piano", "strings", "electric guitar"],
    drums: ["live kit", "brush jazz"],
  },
];

const INSTRUMENT_TEXT_TO_LEAD = [
  [/guitar|guitare|riff|power chord/, "electric guitar"],
  [/acoustic|fingerpick|folk guitar/, "acoustic guitar"],
  [/synth|arp|lead synth|supersaw|pad/, "synth lead"],
  [/808|sub ?bass|bass ?line|\bbass\b/, "808 bass"],
  [/piano|keys|rhodes/, "piano"],
  [/string|violin|cello|orchestr/, "strings"],
  [/organ|hammond/, "organ"],
  [/brass|horn/, "brass section"],
  [/sax/, "saxophone"],
  [/trumpet/, "trumpet"],
];

const INSTRUMENT_TEXT_TO_DRUMS = [
  [/four.?on.?(the.?)?floor|house kick|techno kick/, "four-on-floor"],
  [/trap|808 drum|hi-?hat roll/, "trap 808s"],
  [/boom.?bap/, "boom bap"],
  [/brush/, "brush jazz"],
  [/conga|bongo|latin perc|timbale/, "latin percussion"],
  [/live (kit|drum)|acoustic drum|double.?kick|blast|tom|war drum|drum kit|pounding drum/, "live kit"],
];

function lockInstrumentText(lock) {
  if (!lock || typeof lock !== "object") return "";
  return [
    ...(Array.isArray(lock.instruments) ? lock.instruments : []),
    lock.rhythmFeel,
    lock.production,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Leads / batteries compatibles avec le DNA (lane genre ∪ instruments du lock). */
export function lanePoolsForLock(styleLock, { strict = false } = {}) {
  const blob = String(styleLockGenreBlob(styleLock, []) || "").toLowerCase();
  const inst = lockInstrumentText(styleLock);
  const fromLockLeads = INSTRUMENT_TEXT_TO_LEAD.filter(([re]) => re.test(inst)).map(([, id]) => id);
  const fromLockDrums = INSTRUMENT_TEXT_TO_DRUMS.filter(([re]) => re.test(inst)).map(([, id]) => id);
  const laneLeads = [];
  const laneDrums = [];
  for (const lane of LANE_POOLS) {
    if (lane.re.test(blob) || lane.re.test(inst)) {
      laneLeads.push(...lane.leads);
      laneDrums.push(...lane.drums);
    }
  }
  const uniq = (arr) => [...new Set(arr)].filter(Boolean);
  if (strict) {
    // Fidélité stricte : uniquement ce que le DNA contient (sinon la lane).
    return {
      leads: uniq(fromLockLeads.length ? fromLockLeads : laneLeads).filter((id) => LEAD_IDS.has(id)),
      drums: uniq(fromLockDrums.length ? fromLockDrums : laneDrums),
      matched: Boolean(laneLeads.length || fromLockLeads.length),
    };
  }
  return {
    leads: uniq([...fromLockLeads, ...laneLeads]).filter((id) => LEAD_IDS.has(id)),
    drums: uniq([...fromLockDrums, ...laneDrums]),
    matched: Boolean(laneLeads.length || fromLockLeads.length),
  };
}

/** Rôles « hors lane » : features à ne pas injecter si le DNA ne les contient pas. */
function featureFitsLane(feature, styleLock) {
  const blob = `${String(styleLockGenreBlob(styleLock, []) || "")} ${lockInstrumentText(styleLock)}`.toLowerCase();
  if (!blob.trim()) return true;
  if (feature === "gospel choir" || feature === "call and response") {
    return /gospel|soul|r&?b|choir|church|funk/.test(blob);
  }
  if (feature === "brass stabs") return /brass|horn|funk|soul|ska|latin|jazz|hip[\s-]?hop/.test(blob);
  if (feature === "fingerpicked guitar") return /folk|acoustic|singer|country|indie/.test(blob);
  if (feature === "organ pads") return /organ|gospel|soul|church|psych/.test(blob);
  return true;
}

/**
 * Rôle pour un titre hors album : stable par artiste+titre,
 * en évitant les rôles déjà vus si fournis.
 */
export function pickSonicRole({
  title,
  artistKey,
  trackIndex,
  trackTotal,
  explicitRole,
  usedRoles = [],
} = {}) {
  const forced = normalizeSonicRole(explicitRole);
  if (forced) return forced;

  if (trackTotal != null && trackIndex != null && Number(trackTotal) > 1) {
    return albumArcRole(trackIndex, trackTotal);
  }

  const roles = [...SONIC_ROLE_IDS];
  const used = new Set(
    (Array.isArray(usedRoles) ? usedRoles : [])
      .map(normalizeSonicRole)
      .filter(Boolean),
  );
  const start = hashStr(`${artistKey || ""}::${title || "track"}`) % roles.length;
  for (let k = 0; k < roles.length; k++) {
    const r = roles[(start + k) % roles.length];
    if (!used.has(r)) return r;
  }
  return roles[start];
}

function clampBpm(n) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return null;
  return Math.min(180, Math.max(70, x));
}

function pickLead(bias, current, salt, usedLeads = [], lanePool = null) {
  const used = new Set(
    (Array.isArray(usedLeads) ? usedLeads : [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const lane = Array.isArray(lanePool) && lanePool.length ? lanePool : null;
  const prefer = (bias || []).filter((id) => LEAD_IDS.has(id) && (!lane || lane.includes(id)));
  const pool = prefer.length
    ? prefer
    : lane || ALBUM_LEAD_POOL.filter((id) => LEAD_IDS.has(id));
  const fresh = pool.filter((id) => !used.has(id.toLowerCase()));
  const options = fresh.length ? fresh : pool;
  if (!options.length) return current || "";
  if (current && options.includes(current) && !used.has(current.toLowerCase())) {
    return current;
  }
  return options[hashStr(String(salt)) % options.length];
}

function pickDrums(current, salt, usedDrums = [], lanePool = null) {
  const used = new Set(
    (Array.isArray(usedDrums) ? usedDrums : []).map((x) => String(x || "").trim().toLowerCase()),
  );
  const base = Array.isArray(lanePool) && lanePool.length ? lanePool : ALBUM_DRUM_POOL;
  const fresh = base.filter((id) => !used.has(id.toLowerCase()));
  const options = fresh.length ? fresh : base;
  if (current && (!lanePool?.length || lanePool.includes(current)) && !used.has(String(current).toLowerCase())) {
    return current;
  }
  return options[hashStr(String(salt)) % options.length] || "";
}

function pickAlbumFeatures(profileFeatures, baseFeatures, salt, usedFeatures = []) {
  const used = new Set(
    (Array.isArray(usedFeatures) ? usedFeatures : []).map((x) => String(x || "").toLowerCase()),
  );
  const all = FEATURE_TAGS.map((f) => f.id).filter((id) => FEATURE_IDS.has(id));
  const prefer = [...(profileFeatures || []), ...(baseFeatures || [])].filter((f) =>
    FEATURE_IDS.has(f),
  );
  const out = [];
  for (const f of prefer) {
    if (!used.has(f.toLowerCase()) && !out.includes(f)) out.push(f);
    if (out.length >= 2) break;
  }
  if (out.length < 2) {
    const start = hashStr(String(salt)) % all.length;
    for (let k = 0; k < all.length && out.length < 2; k++) {
      const f = all[(start + k) % all.length];
      if (!used.has(f.toLowerCase()) && !out.includes(f)) out.push(f);
    }
  }
  return out.slice(0, 3);
}

/** Hint ACE court : ce titre d’album ne doit pas cloner les autres. */
export function albumTrackContrastBit({ trackIndex, trackTotal, sonicRole } = {}) {
  const i = Number(trackIndex);
  const n = Number(trackTotal);
  if (!Number.isFinite(i) || !Number.isFinite(n) || n < 2) return null;
  const role = normalizeSonicRole(sonicRole);
  return `album track ${i}/${n}${role ? ` (${role})` : ""}: unique arrangement vs other album tracks — different lead & section layers, not a clone`;
}

/**
 * Applique un rôle sonore sur un musicArrange + mood DNA.
 * @returns {{ sonicRole, musicArrange, mood, energy, styleHint, label, instrumentArc }}
 */
export function applySonicVariation({
  musicArrange,
  styleLock = null,
  role,
  title = "",
  artistKey = "",
  trackIndex = null,
  trackTotal = null,
  usedRoles = [],
  usedLeads = [],
  usedDrums = [],
  usedFeatures = [],
  /** Si l’utilisateur a figé l’arrangement : BPM + notes seulement. */
  lightOnly = null,
  /** Arc imposé (ex. LLM) — sinon dérivé du rôle + arrange. */
  instrumentArc = null,
  /** Fidélité stricte (clone) : BPM ±4, energy DNA, instruments du lock seulement. */
  strict = false,
} = {}) {
  const sonicRole = pickSonicRole({
    title,
    artistKey,
    trackIndex,
    trackTotal,
    explicitRole: role,
    usedRoles,
  });
  const profile = SONIC_ROLES[sonicRole] || SONIC_ROLES.single;
  const albumMode = Number(trackTotal) > 1;

  const forcedManual =
    lightOnly != null
      ? Boolean(lightOnly)
      : normalizeMusicArrange(musicArrange).source === "manual";

  // Hors arrangement manuel : repartir du DNA (évite d’accumuler pads / features d’une gen précédente).
  let base = forcedManual
    ? normalizeMusicArrange(musicArrange)
    : styleLock
      ? musicArrangeFromStyleLock(styleLock)
      : normalizeMusicArrange(musicArrange);

  const manual = forcedManual;

  const genreBlob = styleLockGenreBlob(styleLock, []);
  const lockBpm = Number(base.bpm ?? styleLock?.bpm);
  const fallback = defaultBpmForGenre(genreBlob);
  const rootBpm =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : fallback;
  // Micro-jitter BPM album pour éviter le même tempo sur tous les titres.
  const albumJitter = albumMode
    ? ((hashStr(`${artistKey}:${title}:${trackIndex}`) % 7) - 3)
    : 0;
  const rawDelta = (profile.bpmDelta || 0) + albumJitter;
  // Bande étroite autour du DNA : ±4 en strict, ±10 sinon (évite -14 BPM « ballade » hors lane).
  const band = strict ? 4 : 10;
  const delta = Math.max(-band, Math.min(band, strict ? Math.round(rawDelta * 0.35) : rawDelta));
  const bpm = clampBpm(rootBpm + delta);

  const roleNote = `sonic:${sonicRole} · ${profile.mood}`;
  const prevNotes = String(base.notes || "")
    .replace(/\s*\|?\s*sonic:\w+[^.|]*/gi, "")
    .trim();
  const notes = [prevNotes, roleNote].filter(Boolean).join(" | ").slice(0, 220);

  if (manual) {
    const arrangeOut = normalizeMusicArrange({
      ...base,
      bpm,
      notes,
      source: base.source || "manual",
    });
    const arc =
      String(instrumentArc || "").trim().slice(0, 220) ||
      composeInstrumentArc(sonicRole, arrangeOut);
    return {
      sonicRole,
      label: profile.label,
      mood: profile.mood,
      energy: profile.energy,
      styleHint: profile.mood,
      instrumentArc: arc,
      musicArrange: arrangeOut,
    };
  }

  const salt = `${artistKey}:${title}:${sonicRole}:${trackIndex || 0}`;
  let features = [
    ...new Set(
      [...(base.features || []), ...(profile.features || [])].filter((f) =>
        FEATURE_IDS.has(f),
      ),
    ),
  ]
    .filter(
      (f) =>
        f !== "organ pads" ||
        (profile.features || []).includes("organ pads") ||
        (base.choir && base.choir !== "none"),
    )
    .slice(0, 6);

  if (albumMode) {
    features = pickAlbumFeatures(profile.features, features, salt, usedFeatures);
  }
  if (styleLock) {
    features = features.filter(
      (f) => (base.features || []).includes(f) || featureFitsLane(f, styleLock),
    );
  }
  if (strict) {
    features = features.filter((f) => (base.features || []).includes(f) || f === "breakdown drop" || f === "string swell");
  }

  const pools = styleLock ? lanePoolsForLock(styleLock, { strict }) : null;
  const leadPool = pools?.matched ? pools.leads : null;
  const drumPool = pools?.matched ? pools.drums : null;

  const leadInstrument = pickLead(
    profile.leadBias,
    albumMode ? "" : base.leadInstrument,
    salt,
    usedLeads,
    leadPool,
  );

  const drums = albumMode
    ? pickDrums(base.drums, salt, usedDrums, drumPool)
    : base.drums || "";

  const arrangeOut = normalizeMusicArrange({
    ...base,
    leadInstrument: leadInstrument || base.leadInstrument,
    drums: drums || base.drums,
    density: strict ? base.density || profile.density || "mid" : profile.density || base.density || "mid",
    bpm,
    features,
    notes,
    source: base.source === "ref" ? "ref" : base.source,
  });
  const arc =
    String(instrumentArc || "").trim().slice(0, 220) ||
    composeInstrumentArc(sonicRole, arrangeOut);

  return {
    sonicRole,
    label: profile.label,
    mood: profile.mood,
    energy: strict && styleLock?.energy ? styleLock.energy : profile.energy,
    strict: Boolean(strict),
    styleHint: `${profile.mood}, ${profile.density} arrangement`,
    instrumentArc: arc,
    musicArrange: arrangeOut,
  };
}

/** Merge variation dans l’artiste pour api.track / ACE. */
export function artistWithSonicVariation(artist, variation, { musicArrange } = {}) {
  if (!variation) {
    return {
      ...artist,
      musicArrange: musicArrange ?? artist?.musicArrange,
    };
  }
  const lock = artist?.styleLock && typeof artist.styleLock === "object" ? artist.styleLock : null;
  const instruments = Array.isArray(lock?.instruments) ? [...lock.instruments] : [];
  const lead = variation.musicArrange?.leadInstrument;
  if (lead && !instruments.map((x) => String(x).toLowerCase()).includes(lead.toLowerCase())) {
    instruments.unshift(lead);
  }
  // Garde le mood DNA artiste ; le rôle agit via energy + musicArrange (pas un overwrite mood).
  // Strict (clone) : energy DNA conservée, lead ajouté seulement s'il vient du lock.
  if (variation.strict && lock) {
    return {
      ...artist,
      musicArrange: variation.musicArrange,
      sonicRole: variation.sonicRole,
      instrumentArc: variation.instrumentArc || null,
      styleLock: { ...lock },
    };
  }
  return {
    ...artist,
    musicArrange: variation.musicArrange,
    sonicRole: variation.sonicRole,
    instrumentArc: variation.instrumentArc || null,
    styleLock: lock
      ? {
          ...lock,
          energy: variation.energy || lock.energy,
          instruments: instruments.slice(0, 8),
        }
      : lock,
  };
}

export function emptySonicArrange() {
  return emptyMusicArrange();
}
