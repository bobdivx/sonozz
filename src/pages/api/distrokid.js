import { json, error, readBody } from "../../server/http.js";
import { runDistroKid } from "../../server/pipeline.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runDistroKid(body);
    return json(data);
  } catch (e) {
    console.error("[distrokid]", e?.message || e);
    if (e?.stack) console.error(e.stack);
    return error(e.message || "Erreur ONCE", 500);
  }
}

export const prerender = false;
