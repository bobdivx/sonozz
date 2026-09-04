import { GEMINI_IMAGE_MODELS } from "./models.js";

function extractInlineImage(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      const mime = inline.mimeType || inline.mime_type || "image/png";
      return `data:${mime};base64,${inline.data}`;
    }
  }
  return null;
}

/**
 * Convertit data: URL ou http(s) en { mimeType, data } pour Gemini inlineData.
 */
export async function resolveReferenceImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) return null; // SVG non-base64 inutilisable
    if (/svg/i.test(match[1])) return null;
    return { mimeType: match[1], data: match[2] };
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    const ephemeral = /replicate\.delivery|pb\.replicate\.com|fal\.media|oaidalleapiprodscus/i.test(
      imageUrl,
    );
    let res;
    try {
      res = await fetch(imageUrl);
    } catch {
      throw new Error(
        ephemeral
          ? "Portrait/jaquette inaccessible (URL temporaire morte). Régénère le profil (Modifier le profil) ou la jaquette."
          : "Impossible de télécharger l’image de référence.",
      );
    }
    if (!res.ok) {
      throw new Error(
        ephemeral || res.status === 404
          ? `Portrait/jaquette expiré (HTTP ${res.status}). Régénère le portrait (Modifier le profil) puis relance Veo.`
          : `Référence image HTTP ${res.status}`,
      );
    }
    const mime = (res.headers.get("content-type") || "image/png").split(";")[0];
    if (/svg/i.test(mime)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Limite ~8 Mo pour rester sous la contrainte Gemini inline
    if (buf.length > 8_000_000) throw new Error("Image artiste trop lourde pour Gemini");
    return { mimeType: mime || "image/png", data: buf.toString("base64") };
  }

  return null;
}

async function tryGeminiImageModel(apiKey, model, fullPrompt, modalities, referenceImages = null) {
  const parts = [];
  const refs = Array.isArray(referenceImages)
    ? referenceImages
    : referenceImages?.data
      ? [referenceImages]
      : [];
  for (const referenceImage of refs) {
    if (!referenceImage?.data) continue;
    parts.push({
      inlineData: {
        mimeType: referenceImage.mimeType || "image/png",
        data: referenceImage.data,
      },
    });
  }
  parts.push({ text: fullPrompt });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: modalities,
        },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `${model}: HTTP ${res.status}`);
  }
  const imageUrl = extractInlineImage(data);
  if (!imageUrl) throw new Error(`${model}: pas d'image dans la réponse`);
  return imageUrl;
}

async function tryImagen(apiKey, prompt) {
  const models = ["imagen-4.0-fast-generate-001", "imagen-4.0-generate-001"];
  let lastError;
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio: "1:1" },
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data?.error?.message || `${model}: HTTP ${res.status}`;
        continue;
      }
      const b64 =
        data?.predictions?.[0]?.bytesBase64Encoded ||
        data?.predictions?.[0]?.image?.bytesBase64Encoded;
      if (b64) return `data:image/png;base64,${b64}`;
      lastError = `${model}: pas d'image`;
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(lastError || "Imagen indisponible");
}

export async function listGeminiModels(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `ListModels HTTP ${res.status}`);
  return data.models || [];
}

/** Modèles susceptibles de générer des images pour cette clé API. */
export async function discoverImageModels(apiKey) {
  try {
    const models = await listGeminiModels(apiKey);
    const discovered = models
      .map((m) => (m.name || "").replace(/^models\//, ""))
      .filter((name) => /image|imagen|banana/i.test(name))
      .filter((name) => !/embed|tts|live|robotics/i.test(name));
    // Priorité aux modèles connus + découverte
    const ordered = [...GEMINI_IMAGE_MODELS, ...discovered];
    return [...new Set(ordered)];
  } catch {
    return [...GEMINI_IMAGE_MODELS];
  }
}

function imageQuotaHint(errors) {
  const joined = errors.join(" ");
  if (/free_tier|limit: 0|quota/i.test(joined)) {
    return [
      "Tu as probablement du quota TEXTE (Flash Lite), mais le quota IMAGE de cette clé API est à 0.",
      "L’UI Google AI Studio ≠ la clé collée dans SONOZZ (projets différents).",
      "Solution : dans AI Studio → API key → active Pay-as-you-go sur LE MÊME projet,",
      "ou utilise Replicate Flux (déjà branché en fallback).",
    ].join(" ");
  }
  return "Vérifie le billing Gemini Image / Imagen sur le projet de ta clé API.";
}

export async function geminiImage(apiKey, prompt, { kind = "image", referenceImageUrl, referenceImageUrls } = {}) {
  const urlList = (
    Array.isArray(referenceImageUrls) && referenceImageUrls.length
      ? referenceImageUrls
      : referenceImageUrl
        ? [referenceImageUrl]
        : []
  ).filter(Boolean);

  const referenceImages = [];
  for (const url of urlList) {
    const resolved = await resolveReferenceImage(url);
    if (resolved) referenceImages.push(resolved);
  }
  if (!referenceImages.length && kind === "cover" && urlList.length) {
    throw new Error(
      "Portrait artiste invalide pour la jaquette (SVG ou format non supporté). Régénère le profil avec une vraie photo (Flux/Gemini).",
    );
  }

  const multi = referenceImages.length > 1;
  const lead =
    kind === "portrait" && referenceImages.length
      ? [
          "Using the provided photo as the ONLY identity reference,",
          "restyle the SAME person (keep face, age, hair, skin tone, identity).",
          "Photorealistic square music-artist portrait.",
          "Do not change sex, age or who they are.",
          "No text, no watermark, no logo:",
        ].join(" ")
      : kind === "portrait"
      ? "Generate a realistic photographic portrait of a music artist (square, no text, no watermark, no logo):"
      : kind === "cover" && multi
        ? [
            "Using the provided reference portraits in order:",
            "image 1 = LEAD artist, image 2 = FEATURED artist.",
            "Create a square album cover (1:1) showing BOTH people clearly recognizable",
            "(face, age, hair, skin tone, gender) as a featuring / duet artwork.",
            "Do not merge faces or invent other people. Cinematic album artwork, not a plain crop.",
            "No watermark, no logo, minimal or no typography:",
          ].join(" ")
      : kind === "cover" && referenceImages.length
        ? [
            "Using the provided artist portrait as the ONLY facial/identity reference,",
            "create a square album cover (1:1).",
            "The same person must remain clearly recognizable (face, age, hair, skin tone).",
            "Transform the photo into cinematic album artwork — not a plain crop of the portrait.",
            "No watermark, no logo, minimal or no typography:",
          ].join(" ")
      : kind === "cover"
        ? "Generate an album cover image (square, cinematic):"
        : "Generate an image:";
  const fullPrompt = `${lead} ${prompt}`;

  const errors = [];
  const models = await discoverImageModels(apiKey);

  for (const model of models) {
    for (const modalities of [
      ["TEXT", "IMAGE"],
      ["IMAGE"],
    ]) {
      try {
        return await tryGeminiImageModel(apiKey, model, fullPrompt, modalities, referenceImages);
      } catch (e) {
        const msg = String(e.message || e);
        if (/not found|not supported|not available/i.test(msg)) {
          errors.push(`${model}: indisponible`);
          break;
        }
        // Quota image → inutile d'enchaîner toutes les variantes du même modèle
        if (/quota|free_tier|429|rate limit/i.test(msg)) {
          errors.push(msg.slice(0, 180));
          break;
        }
        errors.push(msg.slice(0, 180));
      }
    }
    // Si quota sur un modèle image, les autres free-tier image sont souvent aussi à 0
    if (errors.some((e) => /quota|free_tier|limit: 0/i.test(e))) break;
  }

  // Imagen ne prend pas de référence image — skip si jaquette basée portrait
  if (!referenceImages.length) {
    try {
      return await tryImagen(apiKey, fullPrompt);
    } catch (e) {
      errors.push(String(e.message).slice(0, 180));
    }
  } else {
    errors.push("Imagen ignoré (pas de référence portrait)");
  }

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3d6b5a"/>
          <stop offset="50%" stop-color="#c9a227"/>
          <stop offset="100%" stop-color="#0c0f12"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#g)"/>
      <circle cx="700" cy="320" r="220" fill="#d4784a" opacity="0.35"/>
      <text x="64" y="880" font-family="Arial" font-size="48" fill="#f2efe6" font-weight="700">SONOZZ</text>
      <text x="64" y="940" font-family="Arial" font-size="28" fill="#e8d5a3">${String(prompt).slice(0, 42)}</text>
    </svg>
  `);

  return {
    imageUrl: `data:image/svg+xml,${svg}`,
    fallback: true,
    warning: `${imageQuotaHint(errors)} (${errors[0] || "erreur image"})`,
  };
}

/** Normalise le retour geminiImage en { imageUrl, fallback, warning } */
export function normalizeGeminiImage(image) {
  if (typeof image === "string") {
    return { imageUrl: image, fallback: false };
  }
  return {
    imageUrl: image?.imageUrl,
    fallback: Boolean(image?.fallback),
    warning: image?.warning,
  };
}
