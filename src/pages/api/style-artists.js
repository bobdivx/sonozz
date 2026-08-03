import { json, error, readBody } from "../../server/http.js";
import { searchStyleArtistCandidates } from "../../server/styleReference.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const query = String(body.query || body.q || body.styleArtist || "").trim();
    if (query.length < 2) {
      return error("Saisis au moins 2 caractères pour chercher un artiste.", 400);
    }
    const data = await searchStyleArtistCandidates(body.keys || {}, query);
    return json(data);
  } catch (e) {
    return error(e.message || "Recherche artiste impossible", 500);
  }
}

export const prerender = false;
