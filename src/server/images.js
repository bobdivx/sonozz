import { geminiImage, normalizeGeminiImage } from "./gemini.js";
import { generateImageWithReplicate } from "./replicate.js";
import { isUsableRasterImage, materializeImageForStorage } from "./imagePersist.js";

/**
 * Gemini Image + Replicate → vraie photo/raster uniquement.
 * Plus de SVG pour portrait/jaquette (non persistable / refusé ONCE).
 */
export async function generateVisual({
  keys,
  prompt,
  kind = "image",
  referenceImageUrl,
} = {}) {
  const geminiKey = keys?.geminiApiKey?.trim();
  const replicateToken = keys?.replicateApiToken?.trim();
  const errors = [];

  if (kind === "cover" && !isUsableRasterImage(referenceImageUrl)) {
    throw new Error(
      "Jaquette impossible sans portrait photo. Régénère l’étape Artiste (Replicate Flux).",
    );
  }

  async function finish(imageUrl, provider, extra = {}) {
    const persisted = await materializeImageForStorage(imageUrl);
    const finalUrl = persisted || imageUrl;
    if (!isUsableRasterImage(finalUrl)) {
      throw new Error("Image générée inutilisable (SVG ou vide)");
    }
    return {
      imageUrl: finalUrl,
      fallback: false,
      provider,
      basedOnArtist: Boolean(referenceImageUrl),
      ...extra,
    };
  }

  // Portrait : Replicate d’abord (Gemini Image souvent quota 0)
  const tryReplicateFirst = kind === "portrait" || kind === "cover";

  if (tryReplicateFirst && replicateToken) {
    try {
      const url = await generateImageWithReplicate(replicateToken, {
        prompt,
        kind,
        referenceImageUrl: kind === "cover" ? referenceImageUrl : undefined,
      });
      return await finish(url, kind === "cover" && referenceImageUrl ? "replicate-kontext" : "replicate-flux");
    } catch (e) {
      errors.push(`Replicate: ${e.message}`);
    }
  }

  if (geminiKey) {
    try {
      const raw = await geminiImage(geminiKey, prompt, {
        kind,
        referenceImageUrl: kind === "cover" ? referenceImageUrl : undefined,
      });
      const image = normalizeGeminiImage(raw);
      if (image.imageUrl && !image.fallback && isUsableRasterImage(image.imageUrl)) {
        return await finish(image.imageUrl, "gemini");
      }
      if (image.warning) errors.push(image.warning);
      else if (image.fallback) errors.push("Gemini Image a renvoyé un SVG (quota image à 0 ?)");
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }

  // Gemini d’abord a échoué : retenter Replicate si pas encore fait
  if (!tryReplicateFirst && replicateToken) {
    try {
      const url = await generateImageWithReplicate(replicateToken, {
        prompt,
        kind,
        referenceImageUrl: kind === "cover" ? referenceImageUrl : undefined,
      });
      return await finish(url, "replicate-flux");
    } catch (e) {
      errors.push(`Replicate: ${e.message}`);
    }
  }

  if (!replicateToken) {
    errors.push("Token Replicate manquant — requis pour les portraits/jaquettes photo");
  }

  throw new Error(
    [
      kind === "cover" ? "Jaquette photo impossible." : "Portrait photo impossible.",
      ...errors.slice(0, 3),
      "Vérifie le billing Replicate (https://replicate.com/account/billing) et/ou Gemini Image.",
    ].join(" "),
  );
}
