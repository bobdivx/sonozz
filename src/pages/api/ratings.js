import { json, error, readBody } from "../../server/http.js";
import {
  savePlayerRating,
  getPlayerRating,
  getTrackRatingStats,
  getPlayerRatings,
} from "../../server/playerRatings.js";

export const prerender = false;

/**
 * GET /api/ratings?trackId=xxx&playerId=xxx — récupérer la note d'un utilisateur et les stats
 * GET /api/ratings?trackIds=xxx,yyy&playerId=xxx — récupérer les notes d'un utilisateur pour plusieurs morceaux
 */
export async function GET({ url }) {
  try {
    const params = new URL(url).searchParams;
    const trackId = params.get("trackId") || "";
    const trackIdsParam = params.get("trackIds") || "";
    const playerId = params.get("playerId") || "";

    if (trackIdsParam) {
      // Récupérer plusieurs notes
      const trackIds = trackIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
      if (!playerId) return error("playerId requis", 400);
      const ratings = await getPlayerRatings({ playerId, trackIds });
      return json({ ratings });
    }

    if (!trackId) return error("trackId requis", 400);

    const [userRating, stats] = await Promise.all([
      playerId ? getPlayerRating({ playerId, trackId }) : null,
      getTrackRatingStats(trackId),
    ]);

    return json({
      userRating: userRating ? userRating.rating : null,
      stats: stats || { count: 0, average: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    });
  } catch (e) {
    return error(e.message || "Erreur récupération notes", 500);
  }
}

/**
 * POST /api/ratings — enregistrer ou mettre à jour une note
 * Body: { playerId: string, trackId: string, rating: number (1-5) }
 */
export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const { playerId, trackId, rating } = body;

    if (!playerId || !trackId || rating == null) {
      return error("playerId, trackId et rating requis", 400);
    }

    const result = await savePlayerRating({ playerId, trackId, rating: Number(rating) });
    const stats = await getTrackRatingStats(trackId);

    return json({
      ok: true,
      rating: result,
      stats,
    });
  } catch (e) {
    return error(e.message || "Erreur enregistrement note", 500);
  }
}
