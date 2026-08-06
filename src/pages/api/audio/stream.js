import { error } from "../../../server/http.js";
import { loadAudioBuffer } from "../../../server/audioPersist.js";
import {
  downloadClipBuffer,
  isS3Configured,
  tryParseS3ObjectKey,
} from "../../../server/s3.js";

export const prerender = false;

function sniffMime(buffer, fallback = "audio/mpeg") {
  if (!buffer?.length) return fallback;
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "audio/mpeg";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (
    buffer[0] === 0x66 &&
    buffer[1] === 0x4c &&
    buffer[2] === 0x61 &&
    buffer[3] === 0x43
  ) {
    return "audio/flac";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return "audio/wav";
  }
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67) return "audio/ogg";
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79) return "audio/mp4";
  return fallback;
}

function audioResponse(buffer, mimeHint) {
  if (!buffer?.length || buffer.length < 500) {
    return error("Audio trop petit / vide", 502);
  }
  const mime = sniffMime(buffer, mimeHint || "audio/mpeg");
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=300",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
    },
  });
}

/**
 * GET ?key=audio/… — lit l’objet S3 privé (SDK)
 * GET ?url=… — proxy (S3 sonozz via SDK si possible, sinon fetch)
 */
export async function GET({ request }) {
  try {
    const params = new URL(request.url).searchParams;
    const keyParam = String(params.get("key") || "").trim();
    const url = params.get("url");

    if (keyParam) {
      if (!/^(audio|clips)\//i.test(keyParam) || keyParam.includes("..")) {
        return error("Clé S3 non autorisée", 403);
      }
      if (!isS3Configured()) {
        return error("S3 non configuré — impossible de lire l’audio", 503);
      }
      const { buffer, mimeType } = await downloadClipBuffer(keyParam);
      return audioResponse(buffer, mimeType);
    }

    if (!url) return error("Paramètre url ou key manquant", 400);
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:audio")) {
      return error("URL audio invalide", 400);
    }

    // Bucket privé Scaleway : ne pas fetch l’URL publique (403) → SDK
    const s3Key = tryParseS3ObjectKey(url);
    if (s3Key && isS3Configured()) {
      try {
        const { buffer, mimeType } = await downloadClipBuffer(s3Key);
        return audioResponse(buffer, mimeType);
      } catch (e) {
        console.warn("[audio/stream] S3 key fallback:", e.message);
      }
    }

    const { buffer, mimeType } = await loadAudioBuffer(url);
    return audioResponse(buffer, mimeType);
  } catch (e) {
    console.error("[audio/stream]", e.message || e);
    return error(e.message || "Stream audio impossible", 500);
  }
}
