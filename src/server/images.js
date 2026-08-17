import { geminiImage, normalizeGeminiImage } from "./gemini.js";
import { generateImageWithReplicate } from "./replicate.js";
import {
  isEphemeralImageUrl,
  isUsableRasterImage,
  materializeImageForStorage,
} from "./imagePersist.js";

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

  let refUrl = referenceImageUrl;
  const usesRef = Boolean(refUrl) && (kind === "cover" || kind === "portrait");
  if (kind === "cover" && !isUsableRasterImage(refUrl)) {
    throw new Error(
      "Jaquette impossible sans portrait photo. Régénère l’étape Artiste (Gemini Image ou Replicate).",
    );
  }
  if (usesRef && isEphemeralImageUrl(refUrl)) {
    try {
      refUrl = await materializeImageForStorage(refUrl);
    } catch {
      throw new Error(
        "Portrait Replicate expiré — régénère l’étape Artiste, puis la jaquette.",
      );
    }
  }

  async function finish(imageUrl, provider, extra = {}) {
    // Toujours matérialiser en data URL — les URL replicate.delivery expirent (~1 h)
    const persisted = await materializeImageForStorage(imageUrl);
    if (!persisted || !isUsableRasterImage(persisted)) {
      throw new Error(
        "Impossible de persister l’image (URL expirée ou format invalide). Régénère le visuel.",
      );
    }
    return {
      imageUrl: persisted,
      fallback: false,
      provider,
      basedOnArtist: Boolean(refUrl),
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
        referenceImageUrl: usesRef ? refUrl : undefined,
      });
      return await finish(
        url,
        usesRef ? "replicate-kontext" : "replicate-flux",
      );
    } catch (e) {
      errors.push(`Replicate: ${e.message}`);
    }
  }

  if (geminiKey) {
    try {
      const raw = await geminiImage(geminiKey, prompt, {
        kind,
        referenceImageUrl: usesRef ? refUrl : undefined,
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
        referenceImageUrl: usesRef ? refUrl : undefined,
      });
      return await finish(url, usesRef ? "replicate-kontext" : "replicate-flux");
    } catch (e) {
      errors.push(`Replicate: ${e.message}`);
    }
  }

  if (!geminiKey && !replicateToken) {
    errors.push("Ajoute une clé Gemini (Image) ou un token Replicate dans Paramètres.");
  }

  throw new Error(
    [
      kind === "cover" ? "Jaquette photo impossible." : "Portrait photo impossible.",
      ...errors.slice(0, 3),
      geminiKey
        ? "Replicate n’est pas obligatoire : active Gemini Image (pay-as-you-go) sur le projet de ta clé."
        : "Ajoute Gemini Image, ou un crédit Replicate si tu préfères Flux.",
    ].join(" "),
  );
}
