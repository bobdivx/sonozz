import { resolveReferenceImage } from "./gemini.js";
import { isUsableRasterImage } from "./imagePersist.js";

const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-001",
];

const BASE = "https://generativelanguage.googleapis.com/v1beta";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Prompt cinéma 9:16 fidèle à l’artiste + jaquette + thème du titre.
 */
export function buildVeoShortPrompt({ artist, track, cover, social, lyrics }) {
  const vi = artist?.visualIdentity || {};
  const palette = (artist?.palette || []).join(", ");
  const hook = social?.hook || track?.title || "";
  const scenes = (social?.scenes || []).slice(0, 3).join(" → ");
  const lyricBit = String(lyrics?.text || social?.caption || "")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("["))
    .slice(0, 4)
    .join(" / ")
    .slice(0, 280);

  return [
    `Vertical 9:16 music promotional short film for the song "${track?.title || "Untitled"}" by artist "${artist?.name || "artist"}".`,
    `The lead character MUST match the provided artist portrait reference exactly: same face, age, hair, skin tone, and vibe.`,
    `Visual identity: look ${vi.look || artist?.mood || "cinematic"}, wardrobe ${vi.wardrobe || "contemporary"}, photography ${vi.photographyStyle || "film grain"}.`,
    `Album cover aesthetic as style/mood board (second reference): ${cover?.prompt || artist?.genre || "cinematic album art"}, palette ${palette || "warm brass and deep ink"}.`,
    `Genre/mood: ${artist?.genre || "pop"}, ${artist?.mood || "emotional"}.`,
    `Narrative beats: ${scenes || "intimate close-up → walking night city → hold album cover to camera"}.`,
    `Hook energy: ${hook}.`,
    lyricBit ? `Subtle lip-sync / emotional delivery inspired by lyrics: ${lyricBit}.` : "",
    "Cinematic lighting, shallow depth of field, music-video camera language, no logos, no watermarks, no UI, no misspelled text, keep the same person throughout.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function toInlineImage(url) {
  if (!isUsableRasterImage(url)) return null;
  const ref = await resolveReferenceImage(url);
  if (!ref?.data) return null;
  return {
    inlineData: {
      mimeType: ref.mimeType || "image/jpeg",
      data: ref.data,
    },
  };
}

async function startVeo(apiKey, model, { prompt, referenceImages, firstFrame }) {
  const instance = { prompt };
  if (referenceImages?.length) instance.referenceImages = referenceImages;
  if (firstFrame) instance.image = firstFrame;

  const body = {
    instances: [instance],
    parameters: {
      aspectRatio: "9:16",
      durationSeconds: referenceImages?.length ? 8 : 8,
      personGeneration: "allow_adult",
    },
  };

  const res = await fetch(`${BASE}/models/${model}:predictLongRunning?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `${model}: HTTP ${res.status}`);
  }
  if (!data?.name) throw new Error(`${model}: pas d’operation name`);
  return data.name;
}

async function pollVeo(apiKey, operationName, { maxPolls = 60 } = {}) {
  for (let i = 0; i < maxPolls; i++) {
    const res = await fetch(`${BASE}/${operationName}?key=${apiKey}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Veo poll HTTP ${res.status}`);

    if (data.done) {
      if (data.error) throw new Error(data.error.message || "Veo échec");
      const sample =
        data.response?.generateVideoResponse?.generatedSamples?.[0] ||
        data.response?.generatedVideos?.[0];
      const uri = sample?.video?.uri || sample?.video?.url;
      const bytes = sample?.video?.videoBytes || sample?.video?.bytesBase64Encoded;
      if (bytes) {
        return { videoBase64: `data:video/mp4;base64,${bytes}`, uri: null };
      }
      if (!uri) throw new Error("Veo terminé sans URI vidéo");
      return { uri, videoBase64: null };
    }
    await sleep(10_000);
  }
  throw new Error("Timeout Veo (~10 min)");
}

async function downloadVeoVideo(apiKey, uri) {
  const res = await fetch(uri, {
    headers: { "x-goog-api-key": apiKey },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Téléchargement Veo HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:video/mp4;base64,${buf.toString("base64")}`;
}

/**
 * Génère un short 9:16 via Veo 3.1, ancré sur portrait artiste + jaquette.
 */
export async function generateVeoShort({
  apiKey,
  artist,
  track,
  cover,
  social,
  lyrics,
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");

  const portraitUrl = artist?.imageUrl;
  const coverUrl = cover?.imageUrl;

  if (!isUsableRasterImage(portraitUrl)) {
    throw new Error(
      "Portrait artiste photo requis pour Veo (pas de SVG). Régénère l’étape Artiste.",
    );
  }

  const prompt = buildVeoShortPrompt({ artist, track, cover, social, lyrics });
  const negativePrompt =
    "wrong face, different person, watermark, logo, UI overlay, distorted hands, low quality, misspelled text";

  const portraitInline = await toInlineImage(portraitUrl);
  const coverInline = coverUrl && isUsableRasterImage(coverUrl) ? await toInlineImage(coverUrl) : null;

  const referenceImages = [];
  if (portraitInline) {
    referenceImages.push({ image: portraitInline, referenceType: "asset" });
  }
  if (coverInline) {
    // jaquette = style / objet produit
    referenceImages.push({ image: coverInline, referenceType: "asset" });
  }

  // Première frame = jaquette si dispo (ouverture clip album), sinon portrait
  const firstFrame = coverInline || portraitInline;

  const errors = [];

  for (const model of VEO_MODELS) {
    try {
      console.info(`[veo] start ${model}…`);
      const opName = await startVeo(apiKey.trim(), model, {
        prompt: `${prompt}\nAvoid: ${negativePrompt}`,
        referenceImages: referenceImages.length ? referenceImages : undefined,
        firstFrame,
      });
      console.info(`[veo] polling ${opName}`);
      const result = await pollVeo(apiKey.trim(), opName);
      let videoBase64 = result.videoBase64;
      if (!videoBase64 && result.uri) {
        videoBase64 = await downloadVeoVideo(apiKey.trim(), result.uri);
      }
      if (!videoBase64) throw new Error("Vidéo Veo vide");

      return {
        provider: model,
        videoBase64,
        videoUrl: videoBase64,
        mimeType: "video/mp4",
        aspectRatio: "9:16",
        durationSeconds: 8,
        prompt,
        usedPortrait: Boolean(portraitInline),
        usedCover: Boolean(coverInline),
      };
    } catch (e) {
      console.error(`[veo] ${model}:`, e.message);
      errors.push(`${model}: ${e.message}`);
      // Si référence non supportée, retenter sans referenceImages (image first frame only)
      if (/reference|not supported|invalid/i.test(e.message) && referenceImages.length) {
        try {
          console.info(`[veo] retry ${model} first-frame only…`);
          const opName = await startVeo(apiKey.trim(), model, {
            prompt: `${prompt}\nAvoid: ${negativePrompt}`,
            firstFrame,
          });
          const result = await pollVeo(apiKey.trim(), opName);
          let videoBase64 = result.videoBase64;
          if (!videoBase64 && result.uri) {
            videoBase64 = await downloadVeoVideo(apiKey.trim(), result.uri);
          }
          return {
            provider: `${model}-i2v`,
            videoBase64,
            videoUrl: videoBase64,
            mimeType: "video/mp4",
            aspectRatio: "9:16",
            durationSeconds: 8,
            prompt,
            usedPortrait: firstFrame === portraitInline,
            usedCover: firstFrame === coverInline,
            warning: "Références multi-images indisponibles — génération image→vidéo (frame de départ).",
          };
        } catch (e2) {
          errors.push(`${model} i2v: ${e2.message}`);
        }
      }
    }
  }

  throw new Error(
    `Veo indisponible (${errors[0] || "erreur"}). Billing Gemini Veo requis (paid preview).`,
  );
}
