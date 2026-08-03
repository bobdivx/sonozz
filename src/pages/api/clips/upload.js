import { json, error } from "../../../server/http.js";
import { isS3Configured, uploadClipBuffer, testS3Connection } from "../../../server/s3.js";

export const prerender = false;

export async function GET() {
  try {
    if (!isS3Configured()) {
      return json({
        configured: false,
        ok: false,
        message:
          "S3 non configuré — IndexedDB local uniquement. Ajoute S3_BUCKET + clés dans .env",
      });
    }
    const probe = await testS3Connection();
    return json({ configured: true, ...probe });
  } catch (e) {
    return error(e.message || "Test S3 impossible", 500);
  }
}

export async function POST({ request }) {
  try {
    if (!isS3Configured()) {
      return error(
        "S3 non configuré. Ajoute S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY dans .env",
        503,
      );
    }

    const ctype = request.headers.get("content-type") || "";
    if (!ctype.includes("multipart/form-data")) {
      return error("Attendu multipart/form-data avec champ « video »", 400);
    }

    const form = await request.formData();
    const video = form.get("video");
    if (!video || typeof video !== "object" || typeof video.arrayBuffer !== "function") {
      return error("Fichier vidéo manquant", 400);
    }

    const buffer = Buffer.from(await video.arrayBuffer());
    if (buffer.length < 1000) return error("Vidéo trop petite / invalide", 400);
    if (buffer.length > 80_000_000) return error("Vidéo trop lourde (max ~80 Mo)", 400);

    const projectId = String(form.get("projectId") || "anon");
    const mimeType = String(video.type || form.get("mimeType") || "video/webm");

    const uploaded = await uploadClipBuffer(buffer, { projectId, mimeType });

    return json({
      ok: true,
      videoUrl: uploaded.url,
      s3Key: uploaded.key,
      mimeType: uploaded.mimeType,
      byteLength: uploaded.byteLength,
      storedRemote: true,
    });
  } catch (e) {
    return error(e.message || "Upload S3 impossible", 500);
  }
}
