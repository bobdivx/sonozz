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
  referenceImageUrls,
} = {}) {
  const geminiKey = keys?.geminiApiKey?.trim();
  const replicateToken = keys?.replicateApiToken?.trim();
  const errors = [];

  const refList = (
    Array.isArray(referenceImageUrls) && referenceImageUrls.length
      ? referenceImageUrls
      : referenceImageUrl
        ? [referenceImageUrl]
        : []
  )
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);

  let refs = [...refList];
  const usesRef = refs.length > 0 && (kind === "cover" || kind === "portrait");
  if (kind === "cover" && !isUsableRasterImage(refs[0])) {
    throw new Error(
      "Jaquette impossible sans portrait photo. Ouvre Modifier le profil (Gemini Image ou Replicate).",
    );
  }
  if (usesRef) {
    const next = [];
    for (const url of refs) {
      if (!isUsableRasterImage(url)) continue;
      if (isEphemeralImageUrl(url)) {
        try {
          next.push(await materializeImageForStorage(url));
        } catch {
          throw new Error(
            "Portrait Replicate expiré — ouvre Modifier le profil, puis relance la jaquette.",
          );
        }
      } else {
        next.push(url);
      }
    }
    refs = next;
    if (kind === "cover" && !refs.length) {
      throw new Error(
        "Jaquette impossible sans portrait photo. Ouvre Modifier le profil (Gemini Image ou Replicate).",
      );
    }
  }

  const primaryRef = refs[0];
  const multiRef = refs.length > 1;

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
      basedOnArtist: Boolean(primaryRef),
      ...extra,
    };
  }

  // Duo (2 refs) : Gemini d’abord (multi-image). Sinon Replicate Kontext (1 ref).
  const tryReplicateFirst = (kind === "portrait" || kind === "cover") && !multiRef;

  if (tryReplicateFirst && replicateToken) {
    try {
      const url = await generateImageWithReplicate(replicateToken, {
        prompt,
        kind,
        referenceImageUrl: usesRef ? primaryRef : undefined,
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
        referenceImageUrl: usesRef ? primaryRef : undefined,
        referenceImageUrls: usesRef ? refs : undefined,
      });
      const image = normalizeGeminiImage(raw);
      if (image.imageUrl && !image.fallback && isUsableRasterImage(image.imageUrl)) {
        return await finish(image.imageUrl, multiRef ? "gemini-duo" : "gemini");
      }
      if (image.warning) errors.push(image.warning);
      else if (image.fallback) errors.push("Gemini Image a renvoyé un SVG (quota image à 0 ?)");
    } catch (e) {
      errors.push(`Gemini: ${e.message}`);
    }
  }

  // Duo / Gemini d’abord a échoué : Replicate avec portrait lead seul
  if ((!tryReplicateFirst || multiRef) && replicateToken) {
    try {
      const url = await generateImageWithReplicate(replicateToken, {
        prompt,
        kind,
        referenceImageUrl: usesRef ? primaryRef : undefined,
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
