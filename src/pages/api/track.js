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
          hasReadyModel: info.hasReadyModel,
          message: info.hasReadyModel
            ? `Joignable · ${info.defaultModel || "modèle prêt"}`
            : `Joignable @ ${info.base} — modèle encore en chargement`,
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
