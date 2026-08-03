import { json, error, readBody } from "../../../server/http.js";
import {
  getArtistHub,
  createArtistRelease,
  computeArtistStats,
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
      const stats = await computeArtistStats(slug);
      return json({ stats });
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
