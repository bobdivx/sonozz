import { json, error, readBody } from "../../server/http.js";
import { runTrends } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runTrends(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur tendances", 500);
  }
}

export const prerender = false;
