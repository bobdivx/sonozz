import { json, error } from "../../server/http.js";
import { listLibraryTracks, listArtists } from "../../server/artists.js";

export const prerender = false;

/**
 * GET /api/library — catalogue jouable (titres + artistes).
 * Query: ?artist=slug pour filtrer.
 * Pas de data-URL (photos via /api/artists/:slug/photo).
 */
export async function GET({ url }) {
  try {
    const params = new URL(url).searchParams;
    const artistSlug = params.get("artist") || "";
    const [tracks, artists] = await Promise.all([
      listLibraryTracks(200, { artistSlug }),
      listArtists(80, { includeAll: true, fields: "lite" }),
    ]);
    return json(
      { tracks, artists },
      200,
      { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" },
    );
  } catch (e) {
    return error(e.message || "Erreur bibliothèque", 500);
  }
}
