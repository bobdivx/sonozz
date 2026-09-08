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

function pickLead(bias, current, salt, usedLeads = []) {
  const used = new Set(
    (Array.isArray(usedLeads) ? usedLeads : [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const prefer = (bias || []).filter((id) => LEAD_IDS.has(id));
  const pool = prefer.length ? prefer : ALBUM_LEAD_POOL.filter((id) => LEAD_IDS.has(id));
  const fresh = pool.filter((id) => !used.has(id.toLowerCase()));
  const options = fresh.length ? fresh : pool;
  if (!options.length) return current || "";
  if (current && options.includes(current) && !used.has(current.toLowerCase())) {
    return current;
  }
  return options[hashStr(String(salt)) % options.length];
}

function pickDrums(current, salt, usedDrums = []) {
  const used = new Set(
    (Array.isArray(usedDrums) ? usedDrums : []).map((x) => String(x || "").trim().toLowerCase()),
  );
  const fresh = ALBUM_DRUM_POOL.filter((id) => !used.has(id.toLowerCase()));
  const options = fresh.length ? fresh : ALBUM_DRUM_POOL;
  if (current && !used.has(String(current).toLowerCase())) return current;
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
  const bpm = clampBpm(rootBpm + (profile.bpmDelta || 0) + albumJitter);

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

  const leadInstrument = pickLead(
    profile.leadBias,
    albumMode ? "" : base.leadInstrument,
    salt,
    usedLeads,
  );

  const drums = albumMode
    ? pickDrums(base.drums, salt, usedDrums)
    : base.drums || "";

  const arrangeOut = normalizeMusicArrange({
    ...base,
    leadInstrument: leadInstrument || base.leadInstrument,
    drums: drums || base.drums,
    density: profile.density || base.density || "mid",
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
    energy: profile.energy,
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
