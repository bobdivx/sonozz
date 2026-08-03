import { json, error, readBody } from "../../../server/http.js";
import { startSeedanceShot, finishSeedanceShot } from "../../../server/seedance.js";
import { listenTrackForVeo } from "../../../server/musicListen.js";

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const {
      keys,
      action = "start",
      artist,
      track,
      social,
      lyrics,
      audioBrief,
      audioExcerptBase64,
      audioExcerptMimeType,
      shotIndex = 0,
      shotBrief = null,
      projectId,
      predictionId,
      duration,
      listenOnly,
    } = body;

    const token = keys?.replicateApiToken?.trim();
    if (!token) {
      return error("Token Replicate requis pour Seedance (sync audio natif)", 400);
    }

    if (action === "listen") {
      const cached = audioBrief || social?.audioBrief || social?.veo?.audioBrief;
      if (
        cached &&
        (cached.veoDirection ||
          cached.energy ||
          cached.mood ||
          (Array.isArray(cached.visualBeats) && cached.visualBeats.length))
      ) {
        return json({ audioBrief: cached, reused: true });
      }
      const apiKey = keys?.geminiApiKey?.trim();
      if (!apiKey) return error("Clé Gemini requise pour écouter le morceau", 400);
      const brief = await listenTrackForVeo(apiKey, {
        audioUrl: track?.audioUrl,
        audioExcerptBase64,
        mimeType: audioExcerptMimeType,
        track,
        lyrics,
        durationSec: 28,
      });
      return json({ audioBrief: brief });
    }

    if (action === "poll") {
      if (!predictionId) return error("predictionId manquant", 400);
      const data = await finishSeedanceShot({ token, predictionId });
      return json(data);
    }

    if (listenOnly) {
      return error("action invalide", 400);
    }

    // Pré-écoute optionnelle si brief absent (réutilise social.audioBrief)
    let brief = audioBrief || social?.audioBrief || social?.veo?.audioBrief || null;
    if (!brief && (audioExcerptBase64 || track?.audioUrl) && keys?.geminiApiKey?.trim()) {
      try {
        brief = await listenTrackForVeo(keys.geminiApiKey.trim(), {
          audioUrl: track?.audioUrl,
          audioExcerptBase64,
          mimeType: audioExcerptMimeType,
          track,
          lyrics,
          durationSec: 28,
        });
      } catch (e) {
        console.warn("[seedance] listen skip:", e.message);
      }
    }

    const data = await startSeedanceShot({
      token,
      artist,
      track,
      social,
      lyrics,
      audioBrief: brief,
      audioExcerptBase64,
      audioExcerptMimeType,
      shotIndex: Number(shotIndex) || 0,
      shotBrief: shotBrief || null,
      projectId,
      duration,
    });
    return json({ ...data, audioBrief: brief });
  } catch (e) {
    return error(e.message || "Seedance impossible", 500);
  }
}
