import { listenTrackForVeo } from "../musicListen.js";
import {
  client,
  downloadVeoVideo,
  friendlyVeoError,
  GenerateVideosOperation,
  isUsableAudioBrief,
  NEGATIVE,
  pollVeoOperationRest,
  prepareVeoInputs,
  VEO_MODELS,
} from "./client.js";

/**
 * Démarre Veo via le SDK officiel (@google/genai).
 * Modes : i2v (portrait animé) → refs → texte.
 * Avant génération : Gemini écoute l’extrait (réutilisé si déjà en cache social).
 */
export async function startVeoShort({
  apiKey,
  artist,
  track,
  cover,
  social,
  lyrics,
  safePrompt = false,
  audioExcerptBase64,
  audioExcerptMimeType,
  forceAudioListen = false,
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");

  let audioBrief = null;
  let audioListenWarning;
  let reusedAudioBrief = false;
  const cached = social?.audioBrief || social?.veo?.audioBrief || null;
  if (!forceAudioListen && isUsableAudioBrief(cached)) {
    audioBrief = cached;
    reusedAudioBrief = true;
    console.info(
      `[veo] audio brief réutilisé (éco) · energy=${audioBrief?.energy} · bpm≈${audioBrief?.bpmEstimate}`,
    );
  } else if (track?.audioUrl || audioExcerptBase64) {
    try {
      console.info("[veo] écoute du morceau (Gemini)…");
      audioBrief = await listenTrackForVeo(apiKey.trim(), {
        audioUrl: track?.audioUrl,
        audioExcerptBase64,
        mimeType: audioExcerptMimeType,
        track,
        lyrics,
        durationSec: 28,
      });
      console.info(
        `[veo] audio brief ok · energy=${audioBrief?.energy} · bpm≈${audioBrief?.bpmEstimate}`,
      );
    } catch (e) {
      audioListenWarning = e.message || "Écoute audio impossible";
      console.warn("[veo] écoute audio skip:", audioListenWarning);
    }
  }

  const inputs = await prepareVeoInputs({
    artist,
    track,
    cover,
    social,
    lyrics,
    safePrompt,
    audioBrief,
  });
  const ai = client(apiKey.trim());
  const errors = [];

  const attempts = [];
  for (const model of VEO_MODELS) {
    // 1) Image→vidéo : anime le portrait (vrai clip)
    attempts.push({
      model,
      mode: "i2v",
      params: {
        model,
        prompt: inputs.prompt,
        image: inputs.portrait,
        config: {
          aspectRatio: "9:16",
          durationSeconds: 8,
          personGeneration: "allow_adult",
          negativePrompt: NEGATIVE,
          numberOfVideos: 1,
        },
      },
    });

    // 2) Références (Veo 3.1) — skip en mode safe (moins de risque likeness)
    if (!safePrompt && !model.startsWith("veo-3.0")) {
      const refs = [{ image: inputs.portrait, referenceType: "ASSET" }];
      if (inputs.coverImg) {
        refs.push({ image: inputs.coverImg, referenceType: "ASSET" });
      }
      attempts.push({
        model,
        mode: "refs",
        params: {
          model,
          prompt: inputs.prompt,
          config: {
            aspectRatio: "9:16",
            durationSeconds: 8,
            personGeneration: "allow_adult",
            negativePrompt: NEGATIVE,
            numberOfVideos: 1,
            referenceImages: refs,
          },
        },
      });
    }

    // 3) Texte seul — skip en safe (sans image le filtre celebrity est pire)
    if (!safePrompt) {
      attempts.push({
        model,
        mode: "text",
        params: {
          model,
          prompt: inputs.prompt,
          config: {
            aspectRatio: "9:16",
            durationSeconds: 8,
            personGeneration: "allow_adult",
            negativePrompt: NEGATIVE,
            numberOfVideos: 1,
          },
        },
      });
    }
  }

  for (const attempt of attempts) {
    try {
      console.info(
        `[veo] start ${attempt.model} mode=${attempt.mode}${safePrompt ? " safe" : ""}…`,
      );
      const operation = await ai.models.generateVideos(attempt.params);
      if (!operation?.name) {
        throw new Error("Pas d’operation name renvoyée");
      }
      return {
        operationName: operation.name,
        model: attempt.model,
        mode: attempt.mode,
        prompt: inputs.prompt,
        safePrompt: Boolean(safePrompt),
        usedPortrait: attempt.mode !== "text",
        usedCover: attempt.mode === "refs" ? inputs.usedCover : false,
        audioBrief: audioBrief
          ? {
              energy: audioBrief.energy,
              bpmEstimate: audioBrief.bpmEstimate,
              mood: audioBrief.mood,
              genreFeel: audioBrief.genreFeel,
              vocalPresence: audioBrief.vocalPresence,
              visualBeats: audioBrief.visualBeats,
              veoDirection: audioBrief.veoDirection,
              cameraRhythm: audioBrief.cameraRhythm,
              instruments: audioBrief.instruments,
            }
          : null,
        warning: [
          reusedAudioBrief
            ? "Brief audio réutilisé (économie) → prompt Veo."
            : audioBrief
              ? "Morceau écouté (Gemini) → prompt Veo calé sur l’extrait."
              : "",
          audioListenWarning ? `Écoute audio: ${audioListenWarning}` : "",
          safePrompt ? "Prompt sécurisé (sans noms) — filtre celebrity contourné." : "",
          attempt.mode === "text" ? "Génération texte→vidéo (sans ancrage image)." : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      };
    } catch (e) {
      const friendly = friendlyVeoError(e);
      console.error(`[veo] ${attempt.model}/${attempt.mode}:`, friendly);
      errors.push(`${attempt.model}/${attempt.mode}: ${friendly}`);
      // Plafond mensuel / billing : inutile de tester les autres modèles
      if (/spending.?cap|spend.?cap|monthly.?spend|billing|payment|enable.?billing/i.test(
        String(e?.message || e || "") + friendly,
      )) {
        break;
      }
    }
  }

  throw new Error(
    [
      "Veo 3 n’a pas pu démarrer.",
      errors[0] || "erreur inconnue",
      /spend|cap|quota|429/i.test(errors[0] || "")
        ? "Alternative : bascule sur Seedance (Replicate) dans Clips, ou augmente le cap sur https://ai.studio/spend."
        : "Veo = paid preview : facturation + clé du projet payant sur https://aistudio.google.com",
    ].join(" — "),
  );
}

/**
 * Poll + télécharge si terminé.
 * Important : le SDK exige une vraie instance GenerateVideosOperation
 * (pas un plain `{ name }` — sinon `_fromAPIResponse is not a function`).
 */
export async function finishVeoShort({ apiKey, operationName } = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");
  if (!operationName?.trim()) throw new Error("operationName manquant");

  const ai = client(apiKey.trim());
  const seed = new GenerateVideosOperation();
  seed.name = operationName.trim();

  let operation;
  try {
    operation = await ai.operations.getVideosOperation({ operation: seed });
  } catch (e) {
    // Fallback REST si le SDK échoue encore
    try {
      operation = await pollVeoOperationRest(apiKey.trim(), operationName.trim());
    } catch (e2) {
      throw new Error(friendlyVeoError(e?.message || e2));
    }
  }

  if (!operation?.done) return { done: false };

  if (operation.error) {
    const msg =
      operation.error.message ||
      operation.error.status ||
      JSON.stringify(operation.error);
    throw new Error(friendlyVeoError(msg));
  }

  const reasons = operation.response?.raiMediaFilteredReasons;
  if (
    Array.isArray(reasons) &&
    reasons.length &&
    !operation.response?.generatedVideos?.length
  ) {
    const reason = reasons.join("; ");
    if (/celebrity|real people|likeness|people'?s names/i.test(reason)) {
      const err = new Error(
        `VEO_CELEBRITY_FILTER: ${reason}`,
      );
      err.code = "VEO_CELEBRITY_FILTER";
      throw err;
    }
    throw new Error(`Contenu filtré Veo: ${reason}`);
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Veo terminé sans vidéo");

  let videoBase64 = null;
  if (video.videoBytes) {
    videoBase64 = `data:video/mp4;base64,${video.videoBytes}`;
  } else if (video.uri) {
    videoBase64 = await downloadVeoVideo(apiKey.trim(), video.uri);
  }

  if (!videoBase64) throw new Error("Vidéo Veo vide");

  return {
    done: true,
    videoBase64,
    videoUrl: videoBase64,
    /** URI Google — requis pour étendre le clip (scene extension). */
    videoUri: video.uri || null,
    mimeType: video.mimeType || "video/mp4",
    aspectRatio: "9:16",
    durationSeconds: 8,
  };
}

/**
 * Démarre une extension de scène Veo (+~7 s) à partir d’une URI vidéo Veo.
 */
export async function extendVeoShort({
  apiKey,
  videoUri,
  videoBase64,
  prompt,
  model = "veo-3.1-generate-preview",
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");
  if (!videoUri && !videoBase64) {
    throw new Error("Vidéo source manquante pour l’extension Veo");
  }

  const ai = client(apiKey.trim());
  const extendPrompt =
    prompt?.trim() ||
    "Continue the same fictional music-video scene seamlessly, same original character, cinematic motion, no logos, no text, no celebrities.";

  const videoInput = videoUri
    ? { uri: videoUri }
    : {
        videoBytes: String(videoBase64).replace(/^data:video\/[^;]+;base64,/, ""),
        mimeType: "video/mp4",
      };

  try {
    console.info(`[veo] extend ${model}…`);
    const operation = await ai.models.generateVideos({
      model,
      prompt: extendPrompt,
      video: videoInput,
      config: {
        aspectRatio: "9:16",
        numberOfVideos: 1,
        negativePrompt: NEGATIVE,
      },
    });
    if (!operation?.name) throw new Error("Extension Veo : pas d’operation name");
    return {
      operationName: operation.name,
      model,
      mode: "extend",
      prompt: extendPrompt,
    };
  } catch (e) {
    throw new Error(friendlyVeoError(e));
  }
}

/**
 * Génère un short 9:16 via Veo (synchrone — scripts).
 */
export async function generateVeoShort(opts = {}) {
  const started = await startVeoShort(opts);
  const key = opts.apiKey.trim();

  for (let i = 0; i < 60; i++) {
    const finished = await finishVeoShort({
      apiKey: key,
      operationName: started.operationName,
    });
    if (finished.done) {
      return {
        provider:
          started.mode === "i2v" || started.mode === "refs"
            ? started.model
            : `${started.model}-${started.mode}`,
        videoBase64: finished.videoBase64,
        videoUrl: finished.videoBase64,
        mimeType: "video/mp4",
        aspectRatio: "9:16",
        durationSeconds: 8,
        prompt: started.prompt,
        usedPortrait: started.usedPortrait,
        usedCover: started.usedCover,
        warning: started.warning,
      };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }

  throw new Error("Timeout Veo (~10 min)");
}
