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
    styleLock.seedTrack = seedTrack;
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

function trackKey(track) {
  if (!track?.source || track.sourceId == null) return "";
  return `${track.source}:${track.sourceId}`;
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
  if (trackKey(patch.styleLock?.seedTrack) !== trackKey(prev.styleLock?.seedTrack)) return false;
  return true;
}
