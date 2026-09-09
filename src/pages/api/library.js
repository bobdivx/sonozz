import { json, error } from "../../server/http.js";
import { listLibraryTracks, listArtists } from "../../server/artists.js";
import { listArtistImageUrl } from "../../lib/artistPhotos.js";

export const prerender = false;

function slimArtistForPlay(artist) {
  const profile = artist?.profile || {};
  return {
    id: artist.id,
    slug: artist.slug,
    name: artist.name,
    stats: artist.stats || {},
    createdAt: artist.createdAt,
    updatedAt: artist.updatedAt,
    profile: {
      name: profile.name || artist.name,
      aka: profile.aka || null,
      genre: profile.genre || null,
      imageUrl: listArtistImageUrl(artist.slug, profile, artist.updatedAt),
    },
  };
}

/**
 * GET /api/library — catalogue jouable (titres + artistes).
 * Query: ?artist=slug pour filtrer.
 * Pas de data-URL (photos via /api/artists/:slug/photo).
 */
export async function GET({ url }) {
  try {
    const params = new URL(url).searchParams;
    const artistSlug = params.get("artist") || "";
    let tracks = await listLibraryTracks(200);
    if (artistSlug) {
      tracks = tracks.filter(
        (t) => t.slug === artistSlug || t.slug === decodeURIComponent(artistSlug),
      );
    }
    const artists = (await listArtists(80, { includeAll: true })).map(slimArtistForPlay);
    return json(
      { tracks, artists },
      200,
      { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    );
  } catch (e) {
    return error(e.message || "Erreur bibliothèque", 500);
  }
}
