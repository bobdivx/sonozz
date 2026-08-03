import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import sharp from "sharp";
import { resolveReferenceImage } from "./gemini.js";
import { isUsableRasterImage } from "./imagePersist.js";

const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-001",
];

/**
 * Prompt cinéma 9:16 — sans noms réels (filtre Veo « celebrity / likeness »).
 * La ressemblance passe par l’image de référence, pas par le texte.
 */
export function buildVeoShortPrompt({ artist, track, cover, social, lyrics }, { safe = false } = {}) {
  const vi = artist?.visualIdentity || {};
  const palette = (artist?.palette || []).slice(0, 4).join(", ");
  // Scènes : retirer éventuels noms propres trop longs / citations
  const scenes = (social?.scenes || [])
    .slice(0, 3)
    .map((s) =>
      String(s)
        .replace(/\b(feat\.?|ft\.?|with)\s+[A-Z][\w'-]+/gi, "")
        .replace(/["«»]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" → ");

  const mood = artist?.mood || "emotional";
  const genre = artist?.genre || "pop";
  const look = vi.look || mood || "cinematic";
  const wardrobe = vi.wardrobe || "contemporary stage outfit";
  const photo = vi.photographyStyle || "film grain, shallow depth of field";

  // Mode safe : prompt minimal (après filtre celebrity)
  if (safe) {
    return [
      "Vertical 9:16 original fictional music video, photorealistic live-action.",
      "The lead is an original fictional musician character matching the attached reference image (same face and style).",
      `Mood: ${mood}. Genre vibe: ${genre}. Look: ${look}. Wardrobe: ${wardrobe}.`,
      "Cinematic camera: slow push-in, natural motion, music-video lighting.",
      "No real celebrities, no famous people, no logos, no watermarks, no on-screen text.",
    ].join(" ");
  }

  return [
    "Vertical 9:16 original fictional music-video short, photorealistic live-action.",
    "Lead performer: original fictional musician character who matches the attached reference portrait (face, hair, skin tone, age, vibe).",
    `Visual direction: ${look}; wardrobe ${wardrobe}; photography ${photo}.`,
    `Album/mood aesthetic: ${genre}, ${mood}, palette ${palette || "warm brass and deep ink"}.`,
    cover?.style || cover?.prompt
      ? `Cover art mood (colors/composition only): ${String(cover.style || cover.prompt)
          .replace(/\bby\s+["']?[\w .'-]{2,40}["']?/gi, "")
          .replace(/["«»]/g, "")
          .slice(0, 120)}.`
      : "",
    `Narrative beats: ${scenes || "intimate close-up → walking through a night city → emotional look to camera"}.`,
    "Camera language: slow push-in, shallow depth of field, film grain, music-video lighting.",
    "Important: fictional original character only — not a celebrity, not a real public figure, not a named famous person.",
    "No logos, no watermarks, no UI, no on-screen text, keep the same fictional character throughout.",
  ]
    .filter(Boolean)
    .join(" ");
}

const NEGATIVE =
  "celebrity, famous person, real public figure, known actor, named star, cartoon, anime, illustration, slideshow, UI, watermark, logo, text overlay, distorted hands, low quality, SONOZZ branding";

function client(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/**
 * Compacte l’image pour Veo (JPEG ≤1280).
 * @param {{ optional?: boolean }} [opts] — si optional, 404 → null au lieu de throw
 */
async function toVeoImage(url, { optional = false } = {}) {
  if (!isUsableRasterImage(url)) return null;
  try {
    const ref = await resolveReferenceImage(url);
    if (!ref?.data) return null;

    const raw = Buffer.from(ref.data, "base64");
    const jpeg = await sharp(raw)
      .rotate()
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    return {
      imageBytes: jpeg.toString("base64"),
      mimeType: "image/jpeg",
    };
  } catch (e) {
    if (optional) {
      console.warn("[veo] image optionnelle ignorée:", e.message);
      return null;
    }
    throw e;
  }
}

function friendlyVeoError(err) {
  const msg = String(err?.message || err || "");
  if (/expiré|temporaire|Régénère l’étape/i.test(msg)) {
    return msg.slice(0, 400);
  }
  if (/billing|payment|paid|enable.?billing|consumer.?paid/i.test(msg)) {
    return `Veo nécessite la facturation Gemini (paid preview). Active la facturation sur AI Studio / Google Cloud. Détail: ${msg.slice(0, 240)}`;
  }
  if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg)) {
    return `Quota Veo dépassé. Attends un peu ou vérifie ton plan. Détail: ${msg.slice(0, 240)}`;
  }
  if (/403|PERMISSION|not.+enabled|ACCESS/i.test(msg)) {
    return `Accès Veo refusé — clé ou projet sans droit vidéo. Détail: ${msg.slice(0, 240)}`;
  }
  if (/modèle Veo introuvable|NOT_FOUND/i.test(msg) && !/image|portrait|jaquette|HTTP 404/i.test(msg)) {
    return `Modèle Veo introuvable pour cette clé/région. Détail: ${msg.slice(0, 240)}`;
  }
  return msg.slice(0, 500);
}

async function prepareVeoInputs({ artist, track, cover, social, lyrics, safePrompt = false }) {
  const portraitUrl = artist?.imageUrl;
  const coverUrl = cover?.imageUrl;

  if (!isUsableRasterImage(portraitUrl) && !isUsableRasterImage(coverUrl)) {
    throw new Error(
      "Portrait artiste photo requis pour Veo (pas de SVG). Régénère l’étape Artiste.",
    );
  }

  const prompt = buildVeoShortPrompt(
    { artist, track, cover, social, lyrics },
    { safe: safePrompt },
  );

  // Portrait obligatoire ; si URL morte, tenter la jaquette comme ancre visuelle
  let portrait = null;
  let portraitError = null;
  if (isUsableRasterImage(portraitUrl)) {
    try {
      portrait = await toVeoImage(portraitUrl);
    } catch (e) {
      portraitError = e;
      console.warn("[veo] portrait KO:", e.message);
    }
  }

  // En mode safe : pas de jaquette en ref (évite prompts cover avec noms)
  const coverImg =
    !safePrompt && isUsableRasterImage(coverUrl)
      ? await toVeoImage(coverUrl, { optional: true })
      : null;

  if (!portrait && coverImg) {
    portrait = coverImg;
    console.info("[veo] fallback : jaquette utilisée comme frame de départ");
  }

  if (!portrait) {
    throw new Error(
      portraitError?.message ||
        "Impossible de charger le portrait pour Veo. Régénère l’étape Artiste (photo durable), puis relance.",
    );
  }

  return {
    prompt,
    portrait,
    coverImg: coverImg && coverImg !== portrait ? coverImg : null,
    usedPortrait: Boolean(portraitUrl && !portraitError),
    usedCover: Boolean(coverImg),
    safePrompt: Boolean(safePrompt),
  };
}

/**
 * Démarre Veo via le SDK officiel (@google/genai).
 * Modes : i2v (portrait animé) → refs → texte.
 * @param {{ safePrompt?: boolean }} opts — prompt sans noms (retry après filtre celebrity)
 */
export async function startVeoShort({
  apiKey,
  artist,
  track,
  cover,
  social,
  lyrics,
  safePrompt = false,
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");

  const inputs = await prepareVeoInputs({
    artist,
    track,
    cover,
    social,
    lyrics,
    safePrompt,
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
        warning: safePrompt
          ? "Prompt sécurisé (sans noms) — filtre celebrity contourné."
          : attempt.mode === "text"
            ? "Génération texte→vidéo (sans ancrage image)."
            : undefined,
      };
    } catch (e) {
      const friendly = friendlyVeoError(e);
      console.error(`[veo] ${attempt.model}/${attempt.mode}:`, friendly);
      errors.push(`${attempt.model}/${attempt.mode}: ${friendly}`);
    }
  }

  throw new Error(
    [
      "Veo 3 n’a pas pu démarrer.",
      errors[0] || "erreur inconnue",
      "Veo = paid preview : active la facturation sur https://aistudio.google.com (clé Gemini).",
    ].join(" — "),
  );
}

export async function downloadVeoVideo(apiKey, uri) {
  const res = await fetch(uri, {
    headers: { "x-goog-api-key": apiKey },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Téléchargement Veo HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:video/mp4;base64,${buf.toString("base64")}`;
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
    mimeType: video.mimeType || "video/mp4",
    aspectRatio: "9:16",
    durationSeconds: 8,
  };
}

/** Poll REST brut — indépendant de l’instance SDK. */
async function pollVeoOperationRest(apiKey, operationName) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
    { headers: { "x-goog-api-key": apiKey } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Veo poll HTTP ${res.status}`);

  if (!data.done) return { done: false };

  if (data.error) {
    return { done: true, error: data.error };
  }

  const sample =
    data.response?.generateVideoResponse?.generatedSamples?.[0] ||
    data.response?.generateVideoResponse?.generatedVideos?.[0] ||
    data.response?.generatedVideos?.[0];

  const video = sample?.video
    ? {
        uri: sample.video.uri || sample.video.url || null,
        videoBytes: sample.video.videoBytes || sample.video.bytesBase64Encoded || null,
        mimeType: sample.video.mimeType || "video/mp4",
      }
    : null;
  const reasons =
    data.response?.generateVideoResponse?.raiMediaFilteredReasons ||
    data.response?.raiMediaFilteredReasons;

  return {
    done: true,
    error: null,
    response: {
      generatedVideos: video ? [{ video }] : [],
      raiMediaFilteredReasons: reasons,
    },
  };
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
