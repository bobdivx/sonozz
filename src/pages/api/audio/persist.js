import { json, error, readBody } from "../../../server/http.js";
import { isS3Configured } from "../../../server/s3.js";
import {
  materializeAudioForStorage,
  persistAudioFileBuffer,
  probeAudioUrl,
  loadAudioBuffer,
  isEphemeralAudioUrl,
} from "../../../server/audioPersist.js";

export const prerender = false;

/**
 * GET ?url=… — probe
 * POST JSON { audioUrl, projectId } — persiste sur S3
 * POST multipart audio file — persiste sur S3
 * POST { action: "proxy", audioUrl } — renvoie bytes (pour decode client CORS)
 */
export async function GET({ request }) {
  try {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) {
      return json({
        s3: isS3Configured(),
        message: isS3Configured()
          ? "S3 OK — POST audioUrl pour persister"
          : "S3 manquant — les liens Replicate ne survivront pas",
      });
    }
    const probe = await probeAudioUrl(url);
    return json({ ...probe, url });
  } catch (e) {
    return error(e.message || "Probe audio impossible", 500);
  }
}

export async function POST({ request }) {
  try {
    const ctype = request.headers.get("content-type") || "";

    // Upload fichier direct
    if (ctype.includes("multipart/form-data")) {
      if (!isS3Configured()) {
        return error("S3 requis pour uploader un morceau durable", 503);
      }
      const form = await request.formData();
      const file = form.get("audio") || form.get("file");
      if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
        return error("Fichier audio manquant (champ audio)", 400);
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const projectId = String(form.get("projectId") || "anon");
      const uploaded = await persistAudioFileBuffer(buffer, {
        projectId,
        mimeHint: String(file.type || form.get("mimeType") || ""),
        fileName: String(file.name || form.get("fileName") || ""),
      });
      return json(uploaded);
    }

    const body = await readBody(request);
    const { action = "persist", audioUrl, projectId = "anon", force = false } = body;

    if (action === "probe") {
      return json(await probeAudioUrl(audioUrl));
    }

    if (action === "proxy") {
      // Sert l’audio en base64 pour le navigateur (contourne CORS / decode)
      const { buffer, mimeType } = await loadAudioBuffer(audioUrl);
      if (buffer.length > 15_000_000) {
        return error("Audio trop lourd pour proxy JSON (max ~15 Mo)", 413);
      }
      return json({
        ok: true,
        mimeType,
        base64: buffer.toString("base64"),
        byteLength: buffer.length,
        ephemeral: isEphemeralAudioUrl(audioUrl),
      });
    }

    // persist
    if (!audioUrl) return error("audioUrl manquant", 400);
    if (!isS3Configured()) {
      return error(
        "S3 non configuré — impossible de garder le morceau. Les liens Replicate expirent ~1 h.",
        503,
      );
    }

    const saved = await materializeAudioForStorage(audioUrl, {
      projectId,
      force: Boolean(force),
    });
    if (!saved?.url) {
      return json({ ok: true, audioUrl, persisted: false, message: "URL déjà durable" });
    }

    return json({
      ok: true,
      audioUrl: saved.url,
      s3Key: saved.s3Key,
      mimeType: saved.mimeType,
      byteLength: saved.byteLength,
      persisted: !saved.reused,
      reused: Boolean(saved.reused),
    });
  } catch (e) {
    return error(e.message || "Persistance audio impossible", 500);
  }
}
