import { httpPreviewUrl } from "./util.js";
import { hydrateStyleTrackFull, listArtistTopTrackCandidates } from "./tracks.js";

export function pickStyleLockPreviewUrl(lock) {
  if (!lock || typeof lock !== "object") return "";
  return (
    httpPreviewUrl(lock.seedTrack?.previewUrl) ||
    httpPreviewUrl(lock.previewUrl) ||
    (Array.isArray(lock.previewUrls) ? lock.previewUrls.map(httpPreviewUrl).find(Boolean) : "") ||
    ""
  );
}

/**
 * URL d’extrait à envoyer à ACE-Step (style transfer, pas une cover).
 * Rehydrate iTunes/Deezer si l’ancien profil a perdu previewUrl.
 */
export async function resolveStyleLockPreview(keys, lock) {
  const title =
    String(lock?.seedTrack?.title || lock?.topTracks?.[0] || "").trim() || null;
  const artistName =
    String(lock?.seedTrack?.artistName || lock?.matchedName || "").trim() || null;
  const existing = pickStyleLockPreviewUrl(lock);
  if (existing) {
    return { previewUrl: existing, title, artistName, via: "lock" };
  }

  const seed = lock?.seedTrack;
  if (seed?.source && seed?.sourceId) {
    try {
      const track = await hydrateStyleTrackFull(keys, {
        source: seed.source,
        id: seed.sourceId,
        name: seed.title,
        artistName: seed.artistName,
        previewUrl: seed.previewUrl,
        url: seed.url,
        image: seed.image,
        album: seed.album,
      });
      const url = httpPreviewUrl(track?.previewUrl);
      if (url) {
        return {
          previewUrl: url,
          title: track.name || title,
          artistName: track.artistName || artistName,
          via: "seed-hydrate",
        };
      }
    } catch {
      /* fallback top titres */
    }
  }

  const name = artistName || String(lock?.matchedName || "").trim();
  if (name.length >= 2) {
    try {
      const { candidates } = await listArtistTopTrackCandidates(keys, {
        name,
        source: lock?.source,
        id: lock?.sourceId,
      });
      const hit = (candidates || []).find((c) => httpPreviewUrl(c.previewUrl));
      if (hit) {
        return {
          previewUrl: httpPreviewUrl(hit.previewUrl),
          title: hit.name || title,
          artistName: hit.artistName || artistName,
          via: "top-tracks",
        };
      }
    } catch {
      /* pas d’extrait */
    }
  }

  return { previewUrl: "", title, artistName, via: "none" };
}
