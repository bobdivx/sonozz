import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import sharp from "sharp";
import { resolveReferenceImage } from "../gemini.js";
import { isUsableRasterImage } from "../imagePersist.js";
import { buildVeoShortPrompt } from "./prompt.js";

export const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-001",
];

export const NEGATIVE =
  "celebrity, famous person, real public figure, known actor, named star, cartoon, anime, illustration, slideshow, UI, watermark, logo, text overlay, distorted hands, plastic skin, uncanny valley, morphing face, low quality, oversmoothed, SONOZZ branding, letterboxing, black bars, widescreen matte, cinema bars, lip sync, singing mouth close-up, karaoke face, phoneme mouth shapes, horizontal 16:9 framing";

export function client(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/**
 * Compacte l’image pour Veo (JPEG ≤1280).
 * @param {{ optional?: boolean }} [opts] — si optional, 404 → null au lieu de throw
 */
export async function toVeoImage(url, { optional = false } = {}) {
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

export function friendlyVeoError(err) {
  const msg = String(err?.message || err || "");
  if (/expiré|temporaire|Régénère l’étape/i.test(msg)) {
    return msg.slice(0, 400);
  }
  // Plafond mensuel ≠ facturation absente (souvent confondu)
  if (/spending.?cap|spend.?cap|monthly.?spend/i.test(msg)) {
    return (
      "Plafond de dépense mensuel Gemini atteint (pas un souci de « facturation absente »). " +
      "Va sur https://ai.studio/spend → Monthly spend cap → Edit → augmente ou désactive le cap, " +
      "attends ~10 min. Si le plafond de ton Tier (compte) est aussi atteint, il faut attendre le 1er du mois ou monter de Tier. " +
      `Détail: ${msg.slice(0, 180)}`
    );
  }
  if (/billing|payment|paid|enable.?billing|consumer.?paid/i.test(msg)) {
    return `Veo nécessite la facturation Gemini (paid preview). Active la facturation sur AI Studio / Google Cloud. Détail: ${msg.slice(0, 240)}`;
  }
  if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg)) {
    return `Quota Veo dépassé. Attends un peu ou vérifie ton plan / spend cap. Détail: ${msg.slice(0, 240)}`;
  }
  if (/403|PERMISSION|not.+enabled|ACCESS/i.test(msg)) {
    return `Accès Veo refusé — clé ou projet sans droit vidéo. Détail: ${msg.slice(0, 240)}`;
  }
  if (/modèle Veo introuvable|NOT_FOUND/i.test(msg) && !/image|portrait|jaquette|HTTP 404/i.test(msg)) {
    return `Modèle Veo introuvable pour cette clé/région. Détail: ${msg.slice(0, 240)}`;
  }
  return msg.slice(0, 500);
}

export async function prepareVeoInputs({
  artist,
  track,
  cover,
  social,
  lyrics,
  safePrompt = false,
  audioBrief = null,
}) {
  const portraitUrl = artist?.imageUrl;
  const coverUrl = cover?.imageUrl;

  if (!isUsableRasterImage(portraitUrl) && !isUsableRasterImage(coverUrl)) {
    throw new Error(
      "Portrait artiste photo requis pour Veo (pas de SVG). Ouvre Modifier le profil et régénère la photo.",
    );
  }

  const prompt = buildVeoShortPrompt(
    { artist, track, cover, social, lyrics, audioBrief },
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
        "Impossible de charger le portrait pour Veo. Ouvre Modifier le profil (photo durable), puis relance.",
    );
  }

  return {
    prompt,
    portrait,
    coverImg: coverImg && coverImg !== portrait ? coverImg : null,
    usedPortrait: Boolean(portraitUrl && !portraitError),
    usedCover: Boolean(coverImg),
    safePrompt: Boolean(safePrompt),
    audioBrief,
  };
}

export function isUsableAudioBrief(brief) {
  if (!brief || typeof brief !== "object") return false;
  return Boolean(
    brief.veoDirection ||
      brief.energy ||
      brief.mood ||
      (Array.isArray(brief.visualBeats) && brief.visualBeats.length),
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

/** Poll REST brut — indépendant de l’instance SDK. */
export async function pollVeoOperationRest(apiKey, operationName) {
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

export { GenerateVideosOperation };
