import { json, error, readBody } from "../../../server/http.js";
import { publishShortEverywhere } from "../../../server/socialPublish.js";
import { downloadClipBuffer, isS3Configured } from "../../../server/s3.js";

export const prerender = false;

async function parsePublishRequest(request) {
  const ctype = request.headers.get("content-type") || "";

  if (ctype.includes("multipart/form-data")) {
    const form = await request.formData();
    const video = form.get("video");
    let videoBuffer = null;
    let mimeType = String(form.get("mimeType") || "video/webm");
    if (video && typeof video === "object" && typeof video.arrayBuffer === "function") {
      videoBuffer = Buffer.from(await video.arrayBuffer());
      mimeType = video.type || mimeType;
    }
    const keysRaw = form.get("keys");
    const socialRaw = form.get("social");
    const artistRaw = form.get("artist");
    const trackRaw = form.get("track");
    const targetsRaw = form.get("targets");
    const parse = (v, fallback = {}) => {
      if (typeof v !== "string" || !v) return fallback;
      try {
        return JSON.parse(v);
      } catch {
        return fallback;
      }
    };
    return {
      keys: parse(keysRaw),
      social: parse(socialRaw),
      artist: parse(artistRaw),
      track: parse(trackRaw),
      targets: parse(targetsRaw, { tiktok: true, webhook: true }),
      videoBuffer,
      mimeType,
      videoBase64: null,
      videoUrl: form.get("videoUrl") ? String(form.get("videoUrl")) : null,
      s3Key: form.get("s3Key") ? String(form.get("s3Key")) : null,
    };
  }

  const body = await readBody(request);
  return {
    keys: body.keys || {},
    social: body.social,
    artist: body.artist,
    track: body.track,
    targets: body.targets,
    videoBase64: body.videoBase64,
    videoBuffer: null,
    mimeType: body.mimeType || null,
    videoUrl: body.videoUrl || null,
    s3Key: body.s3Key || null,
  };
}

export async function POST({ request }) {
  try {
    let {
      keys,
      videoBase64,
      videoBuffer,
      mimeType,
      social,
      artist,
      track,
      targets,
      videoUrl,
      s3Key,
    } = await parsePublishRequest(request);

    // Pas de fichier envoyé → récupérer depuis S3 / URL publique
    if (!videoBuffer && !videoBase64) {
      const ref = s3Key || videoUrl;
      if (ref) {
        try {
          const downloaded = await downloadClipBuffer(ref);
          videoBuffer = downloaded.buffer;
          mimeType = mimeType || downloaded.mimeType;
        } catch (e) {
          if (!isS3Configured() && s3Key && !videoUrl) {
            return error("S3 non configuré pour lire la clé clip", 503);
          }
          return error(e.message || "Impossible de télécharger le clip distant", 400);
        }
      }
    }

    if (!videoBuffer && (!videoBase64 || typeof videoBase64 !== "string")) {
      return error("Vidéo manquante (exporte d’abord le short)", 400);
    }

    const data = await publishShortEverywhere({
      keys: keys || {},
      videoBase64,
      videoBuffer,
      mimeType,
      videoUrl,
      social,
      artist,
      track,
      targets,
    });

    return json(data);
  } catch (e) {
    return error(e.message || "Publication réseaux impossible", 500);
  }
}
