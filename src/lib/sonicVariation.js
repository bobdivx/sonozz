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

/** Profils : deltas autour du DNA, pas un nouveau genre. */
export const SONIC_ROLES = {
  single: {
    label: "Single",
    density: "dense",
    bpmDelta: 0,
    energy: "high",
    mood: "anthemic radio hook",
    features: [],
    leadBias: [],
  },
  opener: {
    label: "Ouverture",
    density: "mid",
    bpmDelta: -4,
    energy: "mid",
    mood: "cinematic rising",
    features: ["spoken intro"],
    leadBias: ["piano", "synth lead", "strings"],
  },
  midtempo: {
    label: "Midtempo",
    density: "mid",
    bpmDelta: -6,
    energy: "mid",
    mood: "groovy midtempo",
    features: ["sidechain pump"],
    leadBias: ["808 bass", "synth lead", "electric guitar"],
  },
  ballad: {
    label: "Ballade",
    density: "mid",
    bpmDelta: -14,
    energy: "low",
    mood: "intimate emotional",
    features: ["string swell", "fingerpicked guitar"],
    leadBias: ["piano", "acoustic guitar", "strings"],
  },
  banger: {
    label: "Banger",
    density: "dense",
    bpmDelta: 8,
    energy: "high",
    mood: "peak high energy",
    features: ["breakdown drop", "live audience energy"],
    leadBias: ["808 bass", "electric guitar", "synth lead", "brass section"],
  },
  deep_cut: {
    label: "Deep cut",
    density: "mid",
    bpmDelta: -2,
    energy: "mid",
    mood: "moody reflective",
    features: ["organ pads"],
    leadBias: ["organ", "electric guitar", "piano"],
  },
  closer: {
    label: "Final",
    density: "mid",
    bpmDelta: -10,
    energy: "low",
    mood: "resolving farewell",
    features: ["string swell"],
    leadBias: ["piano", "strings", "acoustic guitar"],
  },
};

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
 * Lead ≈ single ; fin = closer ; milieu alterne.
 */
export function albumArcRole(trackIndex, trackTotal) {
  const i = Math.max(1, Number(trackIndex) || 1);
  const n = Math.max(i, Number(trackTotal) || i);
  if (i === 1) return "single";
  if (i === n) return "closer";
  const cycle = ["opener", "midtempo", "ballad", "banger", "deep_cut", "midtempo", "banger"];
  return cycle[(i - 2) % cycle.length];
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

function pickLead(bias, current, salt) {
  const options = (bias || []).filter((id) => LEAD_IDS.has(id));
  if (!options.length) return current || "";
  if (current && options.includes(current)) return current;
  return options[hashStr(String(salt)) % options.length];
}

/**
 * Applique un rôle sonore sur un musicArrange + mood DNA.
 * @returns {{ sonicRole, musicArrange, mood, energy, styleHint, label }}
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
  /** Si l’utilisateur a figé l’arrangement : BPM + notes seulement. */
  lightOnly = null,
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

  let base = normalizeMusicArrange(musicArrange);
  if (isDefaultMusicArrange(base) && styleLock) {
    base = musicArrangeFromStyleLock(styleLock);
  }

  const manual =
    lightOnly != null
      ? Boolean(lightOnly)
      : base.source === "manual" || (!isDefaultMusicArrange(musicArrange) && musicArrange?.source === "manual");

  const genreBlob = styleLockGenreBlob(styleLock, []);
  const lockBpm = Number(base.bpm ?? styleLock?.bpm);
  const fallback = defaultBpmForGenre(genreBlob);
  const rootBpm =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : fallback;
  const bpm = clampBpm(rootBpm + (profile.bpmDelta || 0));

  const roleNote = `sonic:${sonicRole} · ${profile.mood}`;
  const prevNotes = String(base.notes || "")
    .replace(/\s*\|?\s*sonic:\w+[^.|]*/gi, "")
    .trim();
  const notes = [prevNotes, roleNote].filter(Boolean).join(" | ").slice(0, 220);

  if (manual) {
    return {
      sonicRole,
      label: profile.label,
      mood: profile.mood,
      energy: profile.energy,
      styleHint: profile.mood,
      musicArrange: normalizeMusicArrange({
        ...base,
        bpm,
        notes,
        source: base.source || "manual",
      }),
    };
  }

  const features = [
    ...new Set(
      [...(base.features || []), ...(profile.features || [])].filter((f) =>
        FEATURE_IDS.has(f),
      ),
    ),
  ].slice(0, 6);

  const leadInstrument = pickLead(
    profile.leadBias,
    base.leadInstrument,
    `${artistKey}:${title}:${sonicRole}`,
  );

  return {
    sonicRole,
    label: profile.label,
    mood: profile.mood,
    energy: profile.energy,
    styleHint: `${profile.mood}, ${profile.density} arrangement`,
    musicArrange: normalizeMusicArrange({
      ...base,
      leadInstrument: leadInstrument || base.leadInstrument,
      density: profile.density || base.density || "mid",
      bpm,
      features,
      notes,
      source: base.source === "ref" ? "ref" : base.source,
    }),
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
  return {
    ...artist,
    mood: variation.mood || artist?.mood,
    musicArrange: variation.musicArrange,
    sonicRole: variation.sonicRole,
    styleLock: lock
      ? {
          ...lock,
          mood: variation.mood || lock.mood,
          energy: variation.energy || lock.energy,
          instruments: instruments.slice(0, 8),
        }
      : lock,
  };
}

export function emptySonicArrange() {
  return emptyMusicArrange();
}
