import { json, error, readBody } from "../../server/http.js";
import { generateVeoShort } from "../../server/veo.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const { keys, artist, track, cover, social, lyrics } = body;
    const apiKey = keys?.geminiApiKey?.trim();
    if (!apiKey) return error("Clé Gemini manquante pour Veo 3", 400);

    const data = await generateVeoShort({
      apiKey,
      artist,
      track,
      cover,
      social,
      lyrics,
    });

    return json(data);
  } catch (e) {
    return error(e.message || "Génération Veo impossible", 500);
  }
}
