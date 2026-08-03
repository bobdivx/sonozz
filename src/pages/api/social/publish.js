import { json, error, readBody } from "../../server/http.js";
import { publishShortEverywhere } from "../../server/socialPublish.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const { keys, videoBase64, social, artist, track, targets } = body;

    if (!videoBase64 || typeof videoBase64 !== "string") {
      return error("videoBase64 manquant (exporte d’abord le short)", 400);
    }

    const data = await publishShortEverywhere({
      keys: keys || {},
      videoBase64,
      social,
      artist,
      track,
      targets,
    });

    return json(data);
  } catch (e) {
    return error(e.message || "Publication réseaux impossible", 500);
  }
}
