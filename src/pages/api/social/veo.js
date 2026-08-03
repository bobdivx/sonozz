import { json, error, readBody } from "../../../server/http.js";
import { startVeoShort, finishVeoShort } from "../../../server/veo.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const { keys, action = "start", artist, track, cover, social, lyrics, operationName } =
      body;
    const apiKey = keys?.geminiApiKey?.trim();
    if (!apiKey) return error("Clé Gemini manquante pour Veo 3", 400);

    if (action === "poll") {
      if (!operationName) return error("operationName manquant", 400);
      const data = await finishVeoShort({ apiKey, operationName });
      return json(data);
    }

    // action === "start" (défaut) — retour rapide, le client poll ensuite
    const data = await startVeoShort({
      apiKey,
      artist,
      track,
      cover,
      social,
      lyrics,
      safePrompt: Boolean(body.safePrompt),
    });
    return json(data);
  } catch (e) {
    return error(e.message || "Génération Veo impossible", 500);
  }
}
