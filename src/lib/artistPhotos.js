/**
 * Photos du profil « C’est moi » : data URL JPEG, HTTP durable, ou chemin /api.
 */

export function isUsableArtistPhoto(url) {
  if (!url || typeof url !== "string") return false;
  const p = url.trim();
  if (!p) return false;
  if (/^data:image\/svg\+xml/i.test(p)) return false;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(p)) return true;
  if (/^https?:\/\//i.test(p)) return true;
  if (p.startsWith("/api/")) return true;
  return false;
}

/**
 * Liste dédupliquée (max 6). `fallbackUrl` sert quand `photos` est vide
 * (ancien profil : une seule imageUrl).
 */
export function normalizeArtistPhotos(photos = [], fallbackUrl) {
  const list = Array.isArray(photos) ? photos : [];
  const out = [];
  const seen = new Set();
  for (const raw of [...list, fallbackUrl]) {
    const url = typeof raw === "string" ? raw.trim() : "";
    if (!url || seen.has(url) || !isUsableArtistPhoto(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Remplacement explicite des photos / du portrait sur un profil existant.
 * Sans `photos` ni `imageUrl` dans le patch, on laisse l’existant.
 */
export function applyArtistPhotoPatch(prev = {}, patch = {}) {
  const photosExplicit = Array.isArray(patch.photos);
  const imageExplicit = Object.prototype.hasOwnProperty.call(patch, "imageUrl") && patch.imageUrl !== undefined;

  if (!photosExplicit && !imageExplicit) {
    const photos = normalizeArtistPhotos(prev.photos, prev.imageUrl);
    return {
      photos: photos.length ? photos : undefined,
      imageUrl: prev.imageUrl || photos[0] || null,
    };
  }

  if (photosExplicit) {
    const photos = normalizeArtistPhotos(patch.photos);
    return {
      photos: photos.length ? photos : undefined,
      imageUrl: photos[0] || null,
    };
  }

  const imageUrl = typeof patch.imageUrl === "string" && patch.imageUrl.trim()
    ? patch.imageUrl.trim()
    : null;
  if (!imageUrl) {
    return { photos: undefined, imageUrl: null };
  }
  const rest = normalizeArtistPhotos(prev.photos).filter((p) => p !== imageUrl);
  const photos = normalizeArtistPhotos([imageUrl, ...rest]);
  return {
    photos: photos.length ? photos : undefined,
    imageUrl,
  };
}

export function artistPhotoSyncKey(artist) {
  if (!artist) return "";
  const urls = normalizeArtistPhotos(artist.photos, artist.imageUrl);
  return urls.map((u) => `${u.length}:${u.slice(0, 20)}:${u.slice(-24)}`).join("|");
}

export function artistPhotoPath(slug) {
  const s = String(slug || "").trim();
  return s ? `/api/artists/${encodeURIComponent(s)}/photo` : null;
}

/**
 * URL d’avatar pour les listes. Les data URL JPEG (> ~200 Ko) ne passaient pas dans /artistes.
 * `version` (updatedAt / hash) casse le cache navigateur après un restyle.
 */
export function listArtistImageUrl(slug, profile = {}, version) {
  const photos = normalizeArtistPhotos(profile.photos, profile.imageUrl);
  if (!photos.length) return null;
  const path = artistPhotoPath(slug);
  if (!path) return null;
  const raw = version || artistPhotoSyncKey(profile);
  if (!raw) return path;
  const token = String(raw).replace(/[^\w.-]+/g, "").slice(0, 40);
  return token ? `${path}?v=${encodeURIComponent(token)}` : path;
}
