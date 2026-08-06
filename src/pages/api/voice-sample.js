import { json, error } from "../../server/http.js";
import { isS3Configured, uploadClipBuffer, testS3Connection } from "../../server/s3.js";

export const prerender = false;

const MAX_BYTES = 8_000_000;
const ALLOWED = /\.(wav|mp3|flac|ogg)$/i;

function extFromNameOrMime(name = "", mime = "") {
  const fromName = String(name).match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (fromName && ["wav", "mp3", "flac", "ogg"].includes(fromName)) return fromName;
  const m = String(mime).toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("flac")) return "flac";
  if (m.includes("ogg")) return "ogg";
  return "wav";
}

export async function GET() {
  try {
    if (!isS3Configured()) {
      return json({
        configured: false,
        ok: false,
        message: "S3 non configuré — l’extrait vocal ne pourra pas être stocké durablement",
      });
    }
    const probe = await testS3Connection();
    return json({ configured: true, ...probe });
  } catch (e) {
    return error(e.message || "Test S3 impossible", 500);
  }
}

/**
 * POST multipart : champ « audio » (+ projectId optionnel)
 * Persiste l’extrait vocal sur S3 pour le mode MOI / SongGen reference.
 */
export async function POST({ request }) {
  try {
    if (!isS3Configured()) {
      return error(
        "S3 requis pour stocker ton extrait vocal. Configure S3_* dans .env",
        503,
      );
    }

    const ctype = request.headers.get("content-type") || "";
    if (!ctype.includes("multipart/form-data")) {
      return error("Attendu multipart/form-data avec champ « audio »", 400);
    }

    const form = await request.formData();
    const audio = form.get("audio");
    if (!audio || typeof audio !== "object" || typeof audio.arrayBuffer !== "function") {
      return error("Fichier audio manquant", 400);
    }

    const fileName = String(audio.name || form.get("fileName") || "voice-sample.wav");
    const mimeType = String(audio.type || form.get("mimeType") || "audio/wav");
    if (!ALLOWED.test(fileName) && !/audio\/(wav|mpeg|mp3|flac|ogg)/i.test(mimeType)) {
      return error("Formats acceptés : WAV, MP3, FLAC, OGG", 400);
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    if (buffer.length < 1000) return error("Fichier audio trop petit / invalide", 400);
    if (buffer.length > MAX_BYTES) return error("Fichier trop lourd (max ~8 Mo)", 400);

    const projectId = String(form.get("projectId") || "voice").slice(0, 80);
    const ext = extFromNameOrMime(fileName, mimeType);
    const key = `audio/voice/${projectId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60)}/${Date.now()}.${ext}`;

    const uploaded = await uploadClipBuffer(buffer, {
      projectId,
      mimeType: mimeType.includes("audio/") ? mimeType : `audio/${ext}`,
      key,
    });

    return json({
      ok: true,
      url: uploaded.url,
      s3Key: uploaded.key,
      mimeType: uploaded.mimeType,
      byteLength: uploaded.byteLength,
      fileName: fileName.replace(/[^\w.\-]+/g, "_").slice(0, 80),
      durationSec: Number(form.get("durationSec")) || null,
    });
  } catch (e) {
    return error(e.message || "Upload extrait vocal impossible", 500);
  }
}
