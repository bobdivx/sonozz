import { error } from "../../../server/http.js";
import { downloadClipBuffer, isS3Configured } from "../../../server/s3.js";

export const prerender = false;

const ALLOWED_HOST =
  /(^|\.)replicate\.delivery$|(^|\.)replicate\.com$|(^|\.)pb\.replicate\.com$|(^|\.)googleusercontent\.com$|(^|\.)googleapis\.com$|(^|\.)scw\.cloud$|(^|\.)amazonaws\.com$|(^|\.)cloudflarestorage\.com$|(^|\.)r2\.cloudflarestorage\.com$/i;

function isAllowedVideoHost(hostname = "") {
  const h = String(hostname || "").toLowerCase();
  if (!h) return false;
  if (ALLOWED_HOST.test(h)) return true;
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  // LAN privé (Pinokio Home Server / Wan2GP / SongGen)
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

const MAX_BYTES = 80_000_000;

function videoResponse(buf, mimeType) {
  if (buf.length < 1000) return error("Vidéo trop petite / vide", 502);
  if (buf.length > MAX_BYTES) return error("Vidéo trop lourde (max ~80 Mo)", 413);

  const head = buf.subarray(0, 32).toString("utf8").toLowerCase();
  if (head.includes("{") && (head.includes("detail") || head.includes("error"))) {
    return error("Lien vidéo expiré / introuvable", 410);
  }
  if (head.includes("<!doctype") || head.includes("<html")) {
    return error("Réponse HTML au lieu d’une vidéo", 502);
  }

  const mime =
    /video\//i.test(mimeType || "") || /mp4|webm|quicktime/i.test(mimeType || "")
      ? mimeType
      : buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79
        ? "video/mp4"
        : mimeType || "video/mp4";

  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=120",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * GET ?url=… — télécharge une vidéo distante (Replicate, S3 signé, etc.) sans CORS.
 * GET ?key=clips/… — lit l’objet S3 privé (bucket sans URL publique).
 * Le client crée un blob: URL pour lecture / canvas.
 */
export async function GET({ request }) {
  try {
    const params = new URL(request.url).searchParams;
    const s3Key = String(params.get("key") || "").trim();
    const raw = params.get("url");

    if (s3Key) {
      if (!/^clips\//i.test(s3Key) || s3Key.includes("..")) {
        return error("Clé S3 non autorisée", 403);
      }
      if (!isS3Configured()) {
        return error("S3 non configuré sur le serveur — impossible de relire le clip", 503);
      }
      const { buffer, mimeType } = await downloadClipBuffer(s3Key);
      return videoResponse(buffer, mimeType);
    }

    if (!raw) return error("Paramètre url ou key manquant", 400);
    let target;
    try {
      target = new URL(raw);
    } catch {
      return error("URL invalide", 400);
    }
    if (!/^https?:$/i.test(target.protocol)) return error("Protocole non autorisé", 400);
    if (!isAllowedVideoHost(target.hostname)) {
      return error(`Hôte non autorisé: ${target.hostname}`, 403);
    }

    // URL S3 signée expirée : si ?key= n’est pas fourni, on tente quand même le fetch
    const res = await fetch(target.toString(), {
      headers: {
        Accept: "video/*,application/octet-stream,*/*",
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return error(`Téléchargement vidéo HTTP ${res.status}`, res.status === 404 ? 404 : 502);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (/json/i.test(ct)) {
      return error("Lien vidéo expiré (JSON au lieu de MP4)", 410);
    }
    return videoResponse(buf, ct);
  } catch (e) {
    return error(e.message || "Proxy vidéo impossible", 500);
  }
}
