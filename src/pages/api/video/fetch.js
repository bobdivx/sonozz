import { error } from "../../../server/http.js";

export const prerender = false;

const ALLOWED_HOST =
  /(^|\.)replicate\.delivery$|(^|\.)replicate\.com$|(^|\.)pb\.replicate\.com$|(^|\.)googleusercontent\.com$|(^|\.)googleapis\.com$|(^|\.)scw\.cloud$|(^|\.)amazonaws\.com$|(^|\.)cloudflarestorage\.com$|(^|\.)r2\.cloudflarestorage\.com$/i;

const MAX_BYTES = 80_000_000;

/**
 * GET ?url=… — télécharge une vidéo distante (Replicate, etc.) sans CORS navigateur.
 * Le client crée un blob: URL pour le canvas MediaRecorder.
 */
export async function GET({ request }) {
  try {
    const raw = new URL(request.url).searchParams.get("url");
    if (!raw) return error("Paramètre url manquant", 400);
    let target;
    try {
      target = new URL(raw);
    } catch {
      return error("URL invalide", 400);
    }
    if (!/^https?:$/i.test(target.protocol)) return error("Protocole non autorisé", 400);
    if (!ALLOWED_HOST.test(target.hostname)) {
      return error(`Hôte non autorisé: ${target.hostname}`, 403);
    }

    const res = await fetch(target.toString(), {
      headers: {
        Accept: "video/*,application/octet-stream,*/*",
        // Pas de Range : évite HTTP 416 sur replicate.delivery
      },
      redirect: "follow",
    });
    if (!res.ok) {
      return error(`Téléchargement vidéo HTTP ${res.status}`, res.status === 404 ? 404 : 502);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return error("Vidéo trop petite / vide", 502);
    if (buf.length > MAX_BYTES) return error("Vidéo trop lourde (max ~80 Mo)", 413);

    const head = buf.subarray(0, 32).toString("utf8").toLowerCase();
    if (head.includes("{") && (head.includes("detail") || head.includes("error"))) {
      return error("Lien vidéo Replicate expiré / introuvable", 410);
    }
    if (head.includes("<!doctype") || head.includes("<html")) {
      return error("Réponse HTML au lieu d’une vidéo", 502);
    }

    const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (/json/i.test(ct)) {
      return error("Lien vidéo expiré (JSON au lieu de MP4)", 410);
    }
    const mime =
      /video\//i.test(ct) || /mp4|webm|quicktime/i.test(ct)
        ? ct
        : buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79
          ? "video/mp4"
          : "video/mp4";

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=120",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return error(e.message || "Proxy vidéo impossible", 500);
  }
}
