import { json, error } from "../../server/http.js";
import { listLibraryTracks, listArtists } from "../../server/artists.js";

export const prerender = false;

/**
 * GET /api/library — catalogue jouable (titres + artistes).
 * Query: ?artist=slug pour filtrer.
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
    const artists = await listArtists(80);
    return json({ tracks, artists });
  } catch (e) {
    return error(e.message || "Erreur bibliothèque", 500);
  }
}
