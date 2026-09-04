import { ensureSchema, getDb } from "../db.js";
import { resolveArtistGender, withResolvedArtistGender } from "../../lib/artistGender.js";
import { applyArtistPhotoPatch } from "../../lib/artistPhotos.js";

export function slugify(input = "") {
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `artiste-${Date.now().toString(36)}`;
}

let artistSchemaReady = false;

export async function ensureArtistSchema() {
  await ensureSchema();
  if (artistSchemaReady) return;
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      stats_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_artists_slug ON artists(slug)
  `);

  // Colonne optionnelle sur projects (ignore si déjà présente)
  try {
    await db.execute(`ALTER TABLE projects ADD COLUMN artist_slug TEXT`);
  } catch {
    /* already exists */
  }

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_artist_slug ON projects(artist_slug)`);
  } catch {
    /* ok */
  }

  artistSchemaReady = true;
}

export function stripHeavyProfile(artist = {}) {
  const clone = { ...artist };
  // garder portrait si raster raisonnable ; sinon URL seulement
  if (typeof clone.imageUrl === "string" && clone.imageUrl.startsWith("data:image/svg")) {
    clone.imageUrl = null;
  }
  if (typeof clone.imageUrl === "string" && clone.imageUrl.length > 2_500_000) {
    clone.imageUrl = null;
    clone.localAsset = true;
  }
  if (clone.voiceSample?.dataUrl) {
    const { dataUrl, ...rest } = clone.voiceSample;
    clone.voiceSample = rest;
  }
  return clone;
}

/** Évite qu’un sync partiel écrase gender / voice / genderLock avec `undefined`. */
export function omitUndefined(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export function hasVoiceSample(sample) {
  return Boolean(sample && (sample.s3Key || sample.url || sample.dataUrl));
}

/** Score pour choisir le profil studio le plus complet (style, voix, genre…). */
export function profileRichness(artist = {}) {
  let score = 0;
  if (resolveArtistGender(artist)) score += 6;
  if (artist.styleLock && typeof artist.styleLock === "object") score += 12;
  if (hasVoiceSample(artist.voiceSample)) score += 10;
  if (artist.genre || (Array.isArray(artist.genres) && artist.genres.length)) score += 4;
  if (artist.voice) score += 2;
  if (artist.mood) score += 1;
  if (artist.language) score += 1;
  if (artist.styleArtist || (Array.isArray(artist.styleArtists) && artist.styleArtists.length)) {
    score += 3;
  }
  if (artist.visualIdentity?.genderLock || artist.visualIdentity?.portraitPrompt) score += 3;
  if (artist.portraitPrompt) score += 2;
  if (artist.imageUrl) score += 1;
  if (artist.influences?.length) score += 1;
  if (artist.age) score += 1;
  return score;
}

export function mergeArtistProfile(prev = {}, incoming = {}) {
  const profile = omitUndefined(incoming);
  const photos = applyArtistPhotoPatch(prev, incoming);
  const merged = {
    ...prev,
    ...profile,
    imageUrl: photos.imageUrl,
    photos: photos.photos,
    slug: profile.slug || prev.slug,
    name: profile.name || prev.name,
  };
  // Ne jamais perdre l’identité vocale / style d’un sync partiel
  if (!merged.gender && prev.gender) merged.gender = prev.gender;
  if (!merged.voice && prev.voice) merged.voice = prev.voice;
  if (!merged.mood && prev.mood) merged.mood = prev.mood;
  if (!merged.language && prev.language) merged.language = prev.language;
  if (!merged.genre && prev.genre) merged.genre = prev.genre;
  if (
    !(Array.isArray(merged.genres) && merged.genres.length) &&
    Array.isArray(prev.genres) &&
    prev.genres.length
  ) {
    merged.genres = prev.genres;
  }
  if (!merged.styleLock && prev.styleLock) merged.styleLock = prev.styleLock;
  if (!merged.styleArtist && prev.styleArtist) merged.styleArtist = prev.styleArtist;
  if (
    !(Array.isArray(merged.styleArtists) && merged.styleArtists.length) &&
    Array.isArray(prev.styleArtists) &&
    prev.styleArtists.length
  ) {
    merged.styleArtists = prev.styleArtists;
  }
  if (!hasVoiceSample(merged.voiceSample) && hasVoiceSample(prev.voiceSample)) {
    merged.voiceSample = prev.voiceSample;
  }
  if (!merged.portraitPrompt && prev.portraitPrompt) {
    merged.portraitPrompt = prev.portraitPrompt;
  }
  merged.visualIdentity = {
    ...(prev.visualIdentity || {}),
    ...(profile.visualIdentity || {}),
  };
  if (!merged.visualIdentity.genderLock && prev.visualIdentity?.genderLock) {
    merged.visualIdentity.genderLock = prev.visualIdentity.genderLock;
  }
  if (!merged.visualIdentity.portraitPrompt && prev.visualIdentity?.portraitPrompt) {
    merged.visualIdentity.portraitPrompt = prev.visualIdentity.portraitPrompt;
  }
  if (!Object.keys(merged.visualIdentity).length) delete merged.visualIdentity;
  return withResolvedArtistGender(merged);
}

export function lightAssetUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("data:") && url.length <= 500_000) return url;
  return null;
}

export function safeS3Segment(value = "") {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
}
