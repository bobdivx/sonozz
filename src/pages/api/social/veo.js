import { json, error, readBody } from "../../../server/http.js";
import {
  startVeoShort,
  finishVeoShort,
  extendVeoShort,
  buildExtendPrompts,
} from "../../../server/veo.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const {
      keys,
      action = "start",
      artist,
      track,
      cover,
      social,
      lyrics,
      operationName,
      videoUri,
      videoBase64,
      prompt,
      model,
      safePrompt,
      audioExcerptBase64,
      audioExcerptMimeType,
    } = body;
    const apiKey = keys?.geminiApiKey?.trim();
    if (!apiKey) return error("Clé Gemini manquante pour Veo 3", 400);

    if (action === "poll") {
      if (!operationName) return error("operationName manquant", 400);
      const data = await finishVeoShort({ apiKey, operationName });
      return json(data);
    }

    if (action === "extend") {
      const data = await extendVeoShort({
        apiKey,
        videoUri,
        videoBase64,
        prompt: prompt || buildExtendPrompts(social, track)[0],
        model,
      });
      return json(data);
    }

    if (action === "extendPrompts") {
      return json({ prompts: buildExtendPrompts(social, track) });
    }

    const data = await startVeoShort({
      apiKey,
      artist,
      track,
      cover,
      social,
      lyrics,
      safePrompt: Boolean(safePrompt),
      audioExcerptBase64,
      audioExcerptMimeType,
    });
    return json(data);
  } catch (e) {
    return error(e.message || "Génération Veo impossible", 500);
  }
}
