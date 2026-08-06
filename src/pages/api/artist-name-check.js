import { json, error, readBody } from "../../server/http.js";
import { checkArtistNameAvailability } from "../../server/styleReference.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const query = String(body.query || body.name || body.q || "").trim();
    if (query.length < 2) {
      return error("Saisis au moins 2 caractères pour vérifier le nom.", 400);
    }
    const data = await checkArtistNameAvailability(body.keys || {}, query);
    return json(data);
  } catch (e) {
    return error(e.message || "Vérification du nom impossible", 500);
  }
}

export const prerender = false;
