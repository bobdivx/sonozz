import { isEphemeralImageUrl, materializeImageForStorage } from "../imagePersist.js";
import { onceFetch } from "./client.js";

export async function uploadOnceFromUrl(token, { type, url, fileName }) {
  return onceFetch(token, "/files/from-url", {
    method: "POST",
    body: JSON.stringify({ type, url, file_name: fileName }),
  });
}

export async function uploadOnceBase64(token, { type, fileName, dataBase64, mimeType }) {
  return onceFetch(token, "/files", {
    method: "POST",
    body: JSON.stringify({
      type,
      file_name: fileName,
      data_base64: dataBase64,
      mime_type: mimeType,
    }),
  });
}

function isHttpUrl(url = "") {
  return /^https?:\/\//i.test(url);
}

function isRasterDataUrl(url = "") {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

function isSvgDataUrl(url = "") {
  return /^data:image\/svg\+xml/i.test(url);
}

function pickUploadableImage(...candidates) {
  // Préférer les data URL durables aux URL Replicate (qui expirent)
  const list = candidates.filter((url) => url && typeof url === "string");
  const durable = list.find((url) => isRasterDataUrl(url));
  if (durable) return durable;
  for (const url of list) {
    if (isHttpUrl(url) || isRasterDataUrl(url)) return url;
  }
  return null;
}

function extractOnceFileUrl(uploaded) {
  return uploaded?.fileUrl || uploaded?.file_url || uploaded?.url || null;
}

async function uploadCoverImage(token, imageUrl) {
  // Toujours matérialiser → base64 : évite from-url sur replicate.delivery (expire)
  let dataUrl = isRasterDataUrl(imageUrl) ? imageUrl : null;
  if (!dataUrl && isHttpUrl(imageUrl)) {
    try {
      dataUrl = await materializeImageForStorage(imageUrl);
    } catch (e) {
      if (isEphemeralImageUrl(imageUrl)) {
        throw new Error(
          `Jaquette Replicate expirée — régénère l'étape Jaquettes puis republie. (${e.message})`,
        );
      }
      throw e;
    }
  }

  if (isRasterDataUrl(dataUrl)) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match[1];
    const dataBase64 = match[2];
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const uploaded = await uploadOnceBase64(token, {
      type: "coverArt",
      fileName: `cover.${ext}`,
      dataBase64,
      mimeType,
    });
    const fileUrl = extractOnceFileUrl(uploaded);
    if (!fileUrl) throw new Error("ONCE n'a pas renvoyé de fileUrl pour la jaquette");
    return fileUrl;
  }

  // Dernier recours : URL publique non-éphémère
  if (isHttpUrl(imageUrl) && !isEphemeralImageUrl(imageUrl)) {
    const uploaded = await uploadOnceFromUrl(token, {
      type: "coverArt",
      url: imageUrl,
      fileName: "cover.jpg",
    });
    const fileUrl = extractOnceFileUrl(uploaded);
    if (!fileUrl) throw new Error("ONCE n'a pas renvoyé de fileUrl pour la jaquette");
    return fileUrl;
  }

  throw new Error(
    "Format de jaquette non supporté pour ONCE — régénère l'étape Jaquettes (data URL JPEG).",
  );
}

async function regenerateCoverImage({ cover, artist, track, keys }) {
  const replicateToken = keys?.replicateApiToken?.trim();
  if (!replicateToken) {
    throw new Error(
      "Jaquette Replicate expirée ou absente. Régénère l'étape Jaquettes (token Replicate requis), puis republie.",
    );
  }
  const { generateImageWithReplicate } = await import("../replicate.js");
  const prompt =
    cover?.prompt ||
    `Square album cover for "${track?.title || "Single"}" by ${artist?.name || "artist"}, ${artist?.genre || "pop"}, cinematic, high detail, no text, no watermark`;
  const fresh = await generateImageWithReplicate(replicateToken, {
    prompt,
    kind: "cover",
    referenceImageUrl: isRasterDataUrl(artist?.imageUrl) ? artist.imageUrl : undefined,
  });
  return (await materializeImageForStorage(fresh)) || fresh;
}

/**
 * Résout une jaquette uploadable pour ONCE.
 * Ordre : data URL durable → HTTP encore vivante → régénération Flux.
 */
export async function resolveCoverFileUrl(token, cover, { artist, track, keys } = {}) {
  let imageUrl = pickUploadableImage(cover?.imageUrl, artist?.imageUrl);

  if (!imageUrl) {
    const why = !cover?.imageUrl
      ? "Jaquette absente."
      : isSvgDataUrl(cover.imageUrl)
        ? "Jaquette SVG non acceptée par ONCE."
        : "Jaquette dans un format non uploadable.";
    try {
      imageUrl = await regenerateCoverImage({ cover, artist, track, keys });
    } catch (e) {
      throw new Error(`${why} ${e.message}`);
    }
  } else if (isEphemeralImageUrl(imageUrl)) {
    // replicate.delivery : tenter le fetch tant qu'il est vivant, sinon régénérer
    try {
      const persisted = await materializeImageForStorage(imageUrl);
      if (persisted) return uploadCoverImage(token, persisted);
    } catch {
      /* expirée */
    }
    try {
      imageUrl = await regenerateCoverImage({ cover, artist, track, keys });
    } catch (e) {
      throw new Error(
        `URL Replicate expirée et régénération échouée (${e.message}). Régénère l'étape Jaquettes, puis republie.`,
      );
    }
  }

  return uploadCoverImage(token, imageUrl);
}

export async function resolveAudioFileUrl(token, track) {
  const audioUrl = track?.audioUrl;
  const audioS3Key =
    (typeof track?.audioS3Key === "string" && track.audioS3Key.trim()) || null;
  if (!audioUrl && !audioS3Key) {
    return null;
  }

  const { loadAudioBuffer, extFromMime, sniffMime } = await import("../audioPersist.js");
  const { isS3Configured, tryParseS3ObjectKey, signedUrlForKey } = await import("../s3.js");

  const s3Key =
    (audioS3Key && /^(audio|clips)\//i.test(audioS3Key) && audioS3Key) ||
    (audioUrl && tryParseS3ObjectKey(audioUrl)) ||
    null;

  // 1) Bucket privé Scaleway : ONCE ne peut pas GET l'URL (403).
  //    → URL signée fraîche (from-url), sinon upload base64 côté SONOZZ.
  if (s3Key && isS3Configured()) {
    const keyExt = String(s3Key).split(".").pop()?.toLowerCase() || "mp3";
    try {
      const freshUrl = await signedUrlForKey(s3Key, 60 * 60 * 24);
      const uploaded = await uploadOnceFromUrl(token, {
        type: "audio",
        url: freshUrl,
        fileName: `track.${keyExt}`,
      });
      const fileUrl = extractOnceFileUrl(uploaded);
      if (fileUrl) return fileUrl;
    } catch (e) {
      console.warn("[once] from-url signé KO, fallback base64:", e.message);
    }

    try {
      const { downloadClipBuffer } = await import("../s3.js");
      const dl = await downloadClipBuffer(s3Key);
      const mime = sniffMime(dl.buffer, dl.mimeType || "audio/mpeg");
      const ext = extFromMime(mime) || keyExt;
      const uploaded = await uploadOnceBase64(token, {
        type: "audio",
        fileName: `track.${ext}`,
        dataBase64: dl.buffer.toString("base64"),
        mimeType: mime,
      });
      const fileUrl = extractOnceFileUrl(uploaded);
      if (fileUrl) return fileUrl;
      throw new Error("ONCE n'a pas renvoyé de fileUrl pour l'audio");
    } catch (e) {
      throw new Error(
        `Audio S3 inaccessible pour ONCE (${e.message}). Rouvre l'étape Morceaux → Re-sauver, puis republie.`,
      );
    }
  }

  if (!audioUrl || !(audioUrl.startsWith("http://") || audioUrl.startsWith("https://"))) {
    throw new Error(
      "Audio manquant ou non public — génère / importe un morceau (étape Morceaux) avant de publier sur ONCE.",
    );
  }

  try {
    const uploaded = await uploadOnceFromUrl(token, {
      type: "audio",
      url: audioUrl,
      fileName: "track.mp3",
    });
    return extractOnceFileUrl(uploaded);
  } catch (e) {
    const msg = String(e.message || e);
    if (/403|Forbidden|Failed to download/i.test(msg)) {
      // URL signée expirée ou bucket privé sans clé — tenter lecture locale + base64
      try {
        const { buffer, mimeType } = await loadAudioBuffer(audioUrl);
        const mime = sniffMime(buffer, mimeType || "audio/mpeg");
        const uploaded = await uploadOnceBase64(token, {
          type: "audio",
          fileName: `track.${extFromMime(mime)}`,
          dataBase64: buffer.toString("base64"),
          mimeType: mime,
        });
        const fileUrl = extractOnceFileUrl(uploaded);
        if (fileUrl) return fileUrl;
      } catch (inner) {
        throw new Error(
          `ONCE ne peut pas télécharger l'audio (HTTP 403 — bucket privé / lien expiré). ${inner.message}. Étape Morceaux → Re-sauver, puis republie.`,
        );
      }
    }
    throw e;
  }
}
