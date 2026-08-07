import { json, error, readBody } from "../../server/http.js";
import { runTrack, startTrack, pollTrack } from "../../server/pipeline.js";
import {
  resolveSongGenBaseUrl,
  testSongGeneration,
} from "../../server/songGeneration.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const action = String(body?.action || "start").trim();

    if (action === "probe-songgen") {
      const base = resolveSongGenBaseUrl(body?.keys || {});
      try {
        const info = await testSongGeneration(body?.keys || {});
        return json({
          ok: true,
          base: info.base,
          defaultModel: info.defaultModel || null,
          pickedModel: info.pickedModel || null,
          pickReason: info.pickReason || null,
          vramRequired: info.vramRequired || null,
          readyModels: info.readyModels || [],
          hasLarge: Boolean(info.hasLarge),
          recommendDownload: info.recommendDownload || null,
          qualityPreset: info.qualityPreset || "auto",
          hasReadyModel: info.hasReadyModel,
          message: (() => {
            const model = info.pickedModel || info.defaultModel || "modèle";
            const vram = info.vramRequired ? ` · ≥${info.vramRequired} Go` : "";
            if (info.recommendDownload === "songgeneration_large" && !info.hasLarge) {
              return `Joignable · auto ${model}${vram} — télécharge Large dans SongGen pour exploiter la 3090`;
            }
            return `Joignable · auto ${model}${vram}`;
          })(),
        });
      } catch (e) {
        return json({
          ok: false,
          base,
          message: e.message || "SongGeneration injoignable",
        });
      }
    }

    if (action === "poll") {
      if (!body?.generationId) return error("generationId manquant", 400);
      const data = await pollTrack(body);
      return json(data);
    }

    if (action === "sync") {
      const data = await runTrack(body);
      return json(data);
    }

    const data = await startTrack(body);
    return json(data);
  } catch (e) {
    return error(e.message || "Erreur morceau", 500);
  }
}

export const prerender = false;
