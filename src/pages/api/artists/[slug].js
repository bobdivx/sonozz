import { json, error, readBody } from "../../../server/http.js";
import {
  getArtistHub,
  createArtistRelease,
  computeArtistStats,
  adviseArtistCareer,
} from "../../../server/artists.js";

export const prerender = false;

export async function GET({ params }) {
  try {
    const slug = params.slug;
    const hub = await getArtistHub(slug);
    if (!hub) return error("Artiste introuvable", 404);
    return json({ artist: hub });
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}

export async function POST({ params, request }) {
  try {
    const slug = params.slug;
    const body = await readBody(request);
    const action = body.action || "new-track";

    if (action === "refresh-stats") {
      const onceToken = body.keys?.onceApiToken?.trim() || body.onceApiToken?.trim() || "";
      const stats = await computeArtistStats(slug, { onceToken });
      let career = null;
      let careerCached = false;
      // Après sync ONCE : recalcule le conseil (force) pour détecter ISRC / Unison
      if (body.advise !== false) {
        try {
          const advice = await adviseArtistCareer(slug, {
            keys: body.keys || {},
            force: true,
          });
          career = advice.career;
          careerCached = Boolean(advice.cached);
        } catch {
          /* conseil non bloquant */
        }
      }
      return json({
        stats,
        onceSynced: Boolean(onceToken),
        career,
        careerCached,
      });
    }

    if (action === "career-advice") {
      const result = await adviseArtistCareer(slug, {
        keys: body.keys || {},
        force: Boolean(body.force),
      });
      return json(result);
    }

    if (action === "new-track") {
      const created = await createArtistRelease(slug, {
        theme: body.theme || "",
        variantOf: body.variantOf || null,
      });
      return json(created);
    }

    return error("Action inconnue", 400);
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}
