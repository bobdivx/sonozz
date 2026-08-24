import { json, error, readBody } from "../../server/http.js";
import { saveStudioRating, getStudioRatings } from "../../server/studioRatings.js";
import { getTrackRatingStats } from "../../server/playerRatings.js";

export const prerender = false;

export async function GET({ request }) {
  try {
    const url = new URL(request.url);
    const trackIds = url.searchParams.get("trackIds");
    
    if (!trackIds) {
      return error("trackIds requis", 400);
    }

    const ids = trackIds.split(",").map(id => id.trim()).filter(Boolean);
    if (!ids.length) {
      return error("trackIds vides", 400);
    }

    const studioRatings = await getStudioRatings(ids);
    
    // Récupérer aussi les stats du lecteur public pour chaque morceau
    const playerStats = {};
    for (const trackId of ids) {
      const stats = await getTrackRatingStats(trackId);
      if (stats && stats.count > 0) {
        playerStats[trackId] = stats;
      }
    }

    return json({ studioRatings, playerStats });
  } catch (e) {
    return error(e.message || "Erreur récupération notes", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const { trackId, rating } = body;

    if (!trackId) {
      return error("trackId requis", 400);
    }

    if (!rating || !['like', 'dislike', 'neutral'].includes(rating)) {
      return error("rating doit être 'like', 'dislike' ou 'neutral'", 400);
    }

    const result = await saveStudioRating({ trackId, rating });
    
    // Récupérer les stats du lecteur public aussi
    const playerStats = await getTrackRatingStats(trackId);

    return json({ rating: result, playerStats });
  } catch (e) {
    return error(e.message || "Erreur sauvegarde note", 500);
  }
}
