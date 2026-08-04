import { json, error, readBody } from "../../../server/http.js";
import { startWan2gpShot, finishWan2gpShot } from "../../../server/wan2gp.js";
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
    } = body;

    if (!keys?.wan2gpBaseUrl?.trim() && String(keys?.videoProvider || "").trim() !== "wan2gp") {
      // URL peut encore être le défaut 127.0.0.1 — on laisse passer
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
      if (!apiKey) return error("Clé Gemini requise pour écouter le morceau (brief plans)", 400);
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
      const data = await finishWan2gpShot({ predictionId });
      return json(data);
    }

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
        console.warn("[wan2gp] listen skip:", e.message);
      }
    }

    const data = await startWan2gpShot({
      keys,
      artist,
      track,
      social,
      lyrics,
      audioBrief: brief,
      shotIndex: Number(shotIndex) || 0,
      shotBrief: shotBrief || null,
      projectId,
    });
    return json({ ...data, audioBrief: brief });
  } catch (e) {
    return error(e.message || "Wan2GP impossible", 500);
  }
}
