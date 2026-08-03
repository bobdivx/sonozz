import { json, error, readBody } from "../../server/http.js";
import { runCover } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runCover(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur jaquette", 500);
  }
}

export const prerender = false;
