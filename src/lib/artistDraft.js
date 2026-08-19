import { formatGenres } from "./studio.js";

function pickToStyleRef(pick) {
  if (!pick?.source || pick.id == null || pick.id === "") return null;
  return {
    source: pick.source,
    sourceId: String(pick.id),
    matchedName: pick.name,
    image: pick.image || null,
    genres: Array.isArray(pick.genres) ? pick.genres : undefined,
  };
}

function trackPickToSeed(pick) {
  if (!pick?.source || pick.id == null || pick.id === "") return null;
  return {
    source: pick.source,
    sourceId: String(pick.id),
    title: pick.name,
    artistName: pick.artistName || "",
    album: pick.album || "",
    image: pick.image || null,
    url: pick.url || null,
    previewUrl: pick.previewUrl || null,
  };
}

function normalizeAge(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 13 || n > 99) return undefined;
  return Math.round(n);
}

/** Champs DNA hérités d’un ancien titre — à jeter dès que le seed change. */
export const STYLE_LOCK_DNA_KEYS = [
  "query",
  "genreSummary",
  "musicPrompt",
  "vocalStyle",
  "vocalRegister",
  "timbre",
  "rhythmFeel",
  "tempoFeel",
  "bpm",
  "energy",
  "mood",
  "instruments",
  "production",
  "sonicKeywords",
  "writingStyle",
  "visualVibe",
  "doNot",
  "audioListened",
  "previewUrl",
  "albums",
  "related",
  "topTracks",
  "genres",
  "influences",
];

export function styleTrackKey(track) {
  if (!track?.source || track.sourceId == null) return "";
  return `${track.source}:${track.sourceId}`;
}

export function lockHasSonicDna(lock) {
  if (!lock || typeof lock !== "object") return false;
  return Boolean(
    lock.timbre ||
      lock.rhythmFeel ||
      lock.tempoFeel ||
      lock.bpm ||
      (Array.isArray(lock.instruments) && lock.instruments.length) ||
      lock.production,
  );
}

export function stripStyleLockDna(lock = {}) {
  const next = { ...lock };
  for (const key of STYLE_LOCK_DNA_KEYS) delete next[key];
  return next;
}

/** Applique un styleLock résolu (écoute preview) sans perdre les refs artistes. */
export function artistPatchFromStyleLock(lock, prevArtist = {}) {
  const prevRefs = prevArtist.styleLock?.refs;
  const mergedLock = {
    ...lock,
    refs: Array.isArray(prevRefs) && prevRefs.length ? prevRefs : lock.refs,
  };
  const refName = mergedLock.matchedName || mergedLock.seedTrack?.artistName || "";
  const styleNames = (Array.isArray(mergedLock.refs) ? mergedLock.refs : [])
    .map((r) => r?.matchedName)
    .filter(Boolean);
  const patch = { styleLock: mergedLock };
  if (refName || styleNames.length) {
    patch.styleArtist = styleNames.length ? styleNames.join(" × ") : refName;
    patch.styleArtists = styleNames.length ? styleNames : refName ? [refName] : [];
  }
  if (mergedLock.genreSummary) patch.genre = mergedLock.genreSummary;
  if (Array.isArray(mergedLock.genres) && mergedLock.genres.length) {
    patch.genres = mergedLock.genres;
  }
  return patch;
}

/**
 * Patch brouillon du profil artiste (mode + identité + refs).
 * Fusionne le styleLock existant pour ne pas perdre le DNA déjà généré.
 */
export function buildArtistDraftPatch(fields = {}, prevArtist = {}) {
  const mode = fields.mode === "self" ? "self" : "fiction";
  const name = String(fields.name || "").trim().slice(0, 80);
  const age = normalizeAge(fields.age);
  const city = String(fields.city || "").trim().slice(0, 80);
  const bioHint = String(fields.bioHint || "").trim().slice(0, 2000);
  const language = String(fields.language || "").trim();
  const gender = String(fields.gender || "").trim();
  const resolvedGenres = Array.isArray(fields.resolvedGenres)
    ? fields.resolvedGenres.map((g) => String(g || "").trim()).filter(Boolean)
    : [];

  const selfRefs = (Array.isArray(fields.styleArtistPicks) ? fields.styleArtistPicks : [])
    .map(pickToStyleRef)
    .filter(Boolean);
  const fictionRef = pickToStyleRef(fields.styleArtistPick);
  const refs = mode === "self" ? selfRefs : fictionRef ? [fictionRef] : [];
  const seedTrack = trackPickToSeed(fields.styleTrackPick);

  const prevLock =
    prevArtist.styleLock && typeof prevArtist.styleLock === "object" ? prevArtist.styleLock : {};
  const styleLock = { ...prevLock };

  if (refs.length) {
    styleLock.source = refs.length > 1 ? "multi" : refs[0].source;
    styleLock.sourceId = refs.length === 1 ? refs[0].sourceId : undefined;
    styleLock.matchedName = refs[0].matchedName;
    styleLock.image = refs[0].image || styleLock.image || null;
    styleLock.refs = refs;
  } else if (mode === "self") {
    styleLock.refs = [];
  }

  if (seedTrack) {
    const prevKey = styleTrackKey(prevLock.seedTrack);
    const nextKey = styleTrackKey(seedTrack);
    styleLock.seedTrack = seedTrack;
    if (nextKey && prevKey !== nextKey) {
      for (const key of STYLE_LOCK_DNA_KEYS) delete styleLock[key];
      if (seedTrack.artistName) styleLock.matchedName = seedTrack.artistName;
      if (seedTrack.image) styleLock.image = seedTrack.image;
    }
  } else if (fields.styleTrackPick === null) {
    delete styleLock.seedTrack;
  }

  const styleNames = refs.map((r) => r.matchedName).filter(Boolean);
  const styleArtist =
    mode === "self"
      ? styleNames.join(" × ")
      : String(fields.styleArtistPick?.name || fields.styleArtist || "").trim();

  const patch = {
    mode,
  };

  if (name) patch.name = name;
  if (age != null) patch.age = age;
  if (gender) patch.gender = gender;
  if (language) patch.language = language;
  if (mode === "self") {
    patch.city = city;
  } else if (city) {
    patch.city = city;
  }
  patch.bioHint = bioHint;
  if (resolvedGenres.length) {
    patch.genres = resolvedGenres;
    patch.genre = formatGenres(resolvedGenres);
  }
  if (styleArtist) {
    patch.styleArtist = styleArtist;
    patch.styleArtists = styleNames.length ? styleNames : [styleArtist];
  }
  const lockTouched =
    refs.length > 0 ||
    mode === "self" ||
    Boolean(seedTrack) ||
    fields.styleTrackPick === null ||
    Object.keys(styleLock).length > 0;
  if (lockTouched) {
    patch.styleLock = styleLock;
  }

  return patch;
}

function refKey(refs = []) {
  return (Array.isArray(refs) ? refs : [])
    .map((r) => `${r?.source || ""}:${r?.sourceId || ""}`)
    .join("|");
}

/** True si le patch ne change rien d’utile (évite un save au simple re-mount). */
export function isUnchangedArtistDraft(patch = {}, prevArtist = {}) {
  const prev = prevArtist || {};
  if ((patch.mode || "fiction") !== (prev.mode || "fiction")) return false;
  if (patch.name && patch.name !== (prev.name || "")) return false;
  if (patch.age != null && patch.age !== prev.age) return false;
  if (patch.gender && patch.gender !== (prev.gender || "")) return false;
  if (patch.city !== undefined && (patch.city || "") !== (prev.city || "")) return false;
  if (patch.language && patch.language !== (prev.language || "")) return false;
  if ((patch.bioHint || "") !== (prev.bioHint || "")) return false;
  if (patch.styleArtist && patch.styleArtist !== (prev.styleArtist || "")) return false;
  if (Array.isArray(patch.genres)) {
    const nextGenres = patch.genres;
    const prevGenres = Array.isArray(prev.genres) ? prev.genres : [];
    if (nextGenres.join("\0") !== prevGenres.join("\0")) return false;
  }
  if (patch.styleLock?.refs && refKey(patch.styleLock.refs) !== refKey(prev.styleLock?.refs)) return false;
  if (styleTrackKey(patch.styleLock?.seedTrack) !== styleTrackKey(prev.styleLock?.seedTrack)) return false;
  if (lockHasSonicDna(prev.styleLock) && !lockHasSonicDna(patch.styleLock) && patch.styleLock) {
    return false;
  }
  return true;
}
