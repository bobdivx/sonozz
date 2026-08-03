import { json, error, readBody } from "../../server/http.js";
import { runSpotify } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runSpotify(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur Spotify", 500);
  }
}

export const prerender = false;
