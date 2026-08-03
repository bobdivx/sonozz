/**
 * Seedance 2.0 (Replicate) — vidéo calée sur un extrait audio réel + portrait.
 * C’est le workflow « créateurs IA » : le modèle entend le morceau.
 */

import { createModelPrediction, waitPrediction } from "./replicate.js";
import { isS3Configured, uploadClipBuffer } from "./s3.js";
import { isUsableRasterImage } from "./imagePersist.js";

const SEEDANCE_MODEL = "bytedance/seedance-2.0";
const MAX_AUDIO_REF_SEC = 15;

function buildSeedancePrompt({ artist, track, social, lyrics, audioBrief, shotIndex = 0, shotBrief }) {
  const vi = artist?.visualIdentity || {};
  const mood = audioBrief?.mood || track?.mood || artist?.mood || "emotional";
  const energy = audioBrief?.energy || "mid";
  const genre = audioBrief?.genreFeel || track?.style || artist?.genre || "pop";
  const title = String(track?.title || lyrics?.title || "single").slice(0, 60);

  const focus = shotBrief
    ? [
        `SHORT CLIP ${Number(shotBrief.index || shotIndex) + 1} only (~${shotBrief.durationSec || 5}s) — one musical phrase, NOT a continuous long take.`,
        `Framing: ${shotBrief.shotType || "wide/mid cutaway"}.`,
        shotBrief.lyricPhrase
          ? `Illustrate this lyric moment as imagery only (no captions): "${String(shotBrief.lyricPhrase).slice(0, 120)}".`
          : "",
        shotBrief.sceneHint ? `Director beat: ${String(shotBrief.sceneHint).slice(0, 160)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : (() => {
        const beat =
          (Array.isArray(audioBrief?.visualBeats) && audioBrief.visualBeats[shotIndex]) ||
          (social?.scenes || [])[shotIndex] ||
          "wide cinematic establishing shot — lyric metaphor, no singing face";
        return `Scene beat: ${String(beat).slice(0, 160)}.`;
      })();

  return [
    `Photorealistic live-action music video B-roll, NATIVE vertical 9:16 TikTok, FULL BLEED, ZERO letterboxing, ZERO black bars.`,
    `Reference look of the person in [Image1] for wardrobe/face continuity when they appear — but this shot should mostly be cutaway / silhouette / metaphor.`,
    `Lock camera rhythm and motion energy to [Audio1] (${genre}, ${mood}, ${energy}).`,
    focus,
    `Song "${title}" — visualize mood and lyric metaphor only.`,
    `Look: ${vi.look || mood}; wardrobe ${vi.wardrobe || "contemporary stage outfit"}; ${vi.photographyStyle || "shallow depth of field, film grain"}.`,
    `CRITICAL RULES: NO lip-sync, NO singing mouth, NO karaoke face, NO phoneme mouth shapes. Prefer landscapes, silhouettes, hands, objects, profile, empty space.`,
    `No celebrities, logos, watermarks, UI, cartoon, slideshow, or on-screen text.`,
  ].join(" ");
}

async function uploadAudioForReplicate(token, { audioExcerptBase64, mimeType = "audio/wav", projectId }) {
  const raw = String(audioExcerptBase64 || "").replace(/^data:[^;]+;base64,/, "");
  if (!raw) throw new Error("Extrait audio manquant pour Seedance");
  const buffer = Buffer.from(raw, "base64");
  if (buffer.length < 1000) throw new Error("Extrait audio trop court");

  // 1) S3 public / signé si dispo
  if (isS3Configured()) {
    const uploaded = await uploadClipBuffer(buffer, {
      projectId: projectId || "seedance-audio",
      mimeType: mimeType || "audio/wav",
      key: `tmp/seedance-audio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
    });
    if (uploaded?.url) return uploaded.url;
  }

  // 2) Replicate Files API
  const form = new FormData();
  form.append(
    "content",
    new Blob([buffer], { type: mimeType || "audio/wav" }),
    "excerpt.wav",
  );
  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `Upload Replicate file HTTP ${res.status}`);
  }
  const url = data?.urls?.get || data?.url || data?.urls?.["get"];
  if (!url) throw new Error("Replicate Files : pas d’URL renvoyée");
  return String(url);
}

function extractVideoUrl(output) {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return extractVideoUrl(output[0]);
  if (typeof output === "object") {
    return output.url || output.video || output.href || null;
  }
  return null;
}

/**
 * Démarre un plan Seedance (async prediction).
 */
export async function startSeedanceShot({
  token,
  artist,
  track,
  social,
  lyrics,
  audioBrief,
  audioExcerptBase64,
  audioExcerptMimeType = "audio/wav",
  shotIndex = 0,
  shotBrief = null,
  projectId,
  duration = MAX_AUDIO_REF_SEC,
} = {}) {
  if (!token?.trim()) throw new Error("Token Replicate requis pour Seedance");
  const portrait = artist?.imageUrl;
  if (!isUsableRasterImage(portrait)) {
    throw new Error("Portrait artiste requis pour Seedance (photo).");
  }
  if (!audioExcerptBase64 && !track?.audioUrl) {
    throw new Error("Extrait audio du morceau requis pour Seedance");
  }

  const audioUrl = audioExcerptBase64
    ? await uploadAudioForReplicate(token.trim(), {
        audioExcerptBase64,
        mimeType: audioExcerptMimeType,
        projectId,
      })
    : track.audioUrl;

  const prompt = buildSeedancePrompt({
    artist,
    track,
    social,
    lyrics,
    audioBrief,
    shotIndex,
    shotBrief,
  });

  const shotDuration = Math.min(15, Math.max(4, Number(duration) || 5));

  const inputVariants = [
    {
      prompt,
      reference_images: [portrait],
      reference_audios: [audioUrl],
      aspect_ratio: "9:16",
      duration: shotDuration,
      generate_audio: false,
      resolution: "720p",
    },
    // Alias possibles selon la version du schéma Replicate
    {
      prompt,
      image: portrait,
      reference_audios: [audioUrl],
      aspect_ratio: "9:16",
      duration: shotDuration,
      generate_audio: false,
    },
  ];

  console.info(`[seedance] start shot ${shotIndex} (~${shotDuration}s)…`);
  let lastErr;
  for (const input of inputVariants) {
    try {
      const { res, data } = await createModelPrediction(token.trim(), SEEDANCE_MODEL, input);
      if (!res.ok && !data?.id) {
        lastErr = new Error(data?.detail || data?.error || `Seedance HTTP ${res.status}`);
        continue;
      }
      return {
        predictionId: data.id,
        status: data.status,
        prompt,
        shotIndex,
        shotBrief: shotBrief || null,
        model: SEEDANCE_MODEL,
        audioUrl,
        duration: shotDuration,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Seedance impossible");
}

export async function finishSeedanceShot({ token, predictionId } = {}) {
  if (!token?.trim()) throw new Error("Token Replicate requis");
  if (!predictionId) throw new Error("predictionId manquant");

  const { res, data } = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: { Authorization: `Bearer ${token.trim()}` },
  }).then(async (r) => ({ res: r, data: await r.json().catch(() => ({})) }));

  if (!res.ok) {
    throw new Error(data?.detail || data?.error || `Seedance poll HTTP ${res.status}`);
  }

  if (data.status === "succeeded") {
    const videoUrl = extractVideoUrl(data.output);
    if (!videoUrl) throw new Error("Seedance OK sans URL vidéo");

    // Persiste sur S3 si possible (URL Replicate éphémère + CORS cassé pour canvas)
    if (isS3Configured()) {
      try {
        const dl = await fetch(videoUrl, {
          headers: { Accept: "video/*,application/octet-stream,*/*" },
        });
        if (dl.ok) {
          const buffer = Buffer.from(await dl.arrayBuffer());
          const head = buffer.subarray(0, 40).toString("utf8").toLowerCase();
          if (head.includes("requested file not found") || head.includes('"detail"')) {
            throw new Error("Lien Seedance déjà expiré à la récupération");
          }
          if (buffer.length > 1000) {
            const uploaded = await uploadClipBuffer(buffer, {
              projectId: "seedance-shots",
              mimeType: "video/mp4",
              key: `tmp/seedance-video/${predictionId}.mp4`,
            });
            if (uploaded?.url) {
              return { done: true, videoUrl: uploaded.url, status: data.status, s3Key: uploaded.key };
            }
          }
        }
      } catch (e) {
        console.warn("[seedance] persist S3 skip:", e.message);
      }
    }

    return { done: true, videoUrl, status: data.status };
  }
  if (data.status === "failed" || data.status === "canceled") {
    throw new Error(data.error || "Seedance a échoué");
  }
  return { done: false, status: data.status };
}

/** Bloquant — utile pour tests / petits jobs. */
export async function runSeedanceShot(opts) {
  const started = await startSeedanceShot(opts);
  const videoUrl = await waitPrediction(opts.token.trim(), { id: started.predictionId, status: "starting" }, {
    maxPolls: 150,
  });
  return { ...started, videoUrl };
}
