import { json, error, readBody } from "../../server/http.js";
import { runSocial } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runSocial(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur social", 500);
  }
}

export const prerender = false;
