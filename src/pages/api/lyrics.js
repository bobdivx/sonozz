import { json, error, readBody } from "../../server/http.js";
import { runLyrics } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runLyrics(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur paroles", 500);
  }
}

export const prerender = false;
