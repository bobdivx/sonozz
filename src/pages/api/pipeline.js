import { json, error, readBody } from "../../server/http.js";
import { runFullPipeline } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runFullPipeline(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur pipeline", 500);
  }
}

export const prerender = false;
