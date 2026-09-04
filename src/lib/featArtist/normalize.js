import { resolveArtistGender, ARTIST_GENDER_LABELS } from "../artistGender.js";
import { slimStyleLock, slimVoiceSample } from "./slim.js";

/** Snapshot léger depuis une entrée catalogue `/api/artists` ou un profil projet. */
export function snapshotFeatArtist(entry) {
  if (!entry || typeof entry !== "object") return null;
  const profile = entry.profile && typeof entry.profile === "object" ? entry.profile : entry;
  const slug = String(entry.slug || profile.slug || "").trim();
  const name = String(entry.name || profile.name || "").trim();
  if (!name) return null;

  const gender =
    profile.gender ||
    profile.visualIdentity?.gender ||
    profile.visualIdentity?.genderLock ||
    null;

  const photos = Array.isArray(profile.photos) ? profile.photos : [];
  const imageUrl =
    [entry.imageUrl, profile.imageUrl, ...photos]
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .find(
        (u) =>
          /^https?:\/\//i.test(u) ||
          /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(u) ||
          u.startsWith("/api/"),
      ) || undefined;

  return {
    slug: slug || undefined,
    name,
    gender: gender || undefined,
    age: profile.age ?? undefined,
    genre: profile.genre || undefined,
    genres: Array.isArray(profile.genres) ? profile.genres.slice(0, 6) : undefined,
    mood: profile.mood || undefined,
    voice: profile.voice ? String(profile.voice).slice(0, 160) : undefined,
    language: profile.language || undefined,
    imageUrl,
    styleLock: slimStyleLock(profile.styleLock),
    voiceSample: slimVoiceSample(profile.voiceSample),
    visualIdentity: profile.visualIdentity?.genderLock
      ? { genderLock: profile.visualIdentity.genderLock }
      : undefined,
  };
}

export function normalizeFeatArtist(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  return snapshotFeatArtist(raw);
}

export function featuringCredit(feat) {
  const n = String(feat?.name || "").trim();
  return n || "";
}

export function displayArtistCredit(lead, feat) {
  const leadName = String(lead?.name || "").trim() || "Unknown";
  const featName = featuringCredit(feat);
  return featName ? `${leadName} feat. ${featName}` : leadName;
}
