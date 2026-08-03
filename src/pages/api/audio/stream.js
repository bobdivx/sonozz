import { error } from "../../../server/http.js";
import { loadAudioBuffer } from "../../../server/audioPersist.js";

export const prerender = false;

/**
 * GET ?url=… — stream audio binaire (contourne CORS navigateur).
 */
export async function GET({ request }) {
  try {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) return error("Paramètre url manquant", 400);
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:audio")) {
      return error("URL audio invalide", 400);
    }
    const { buffer, mimeType } = await loadAudioBuffer(url);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType || "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "private, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return error(e.message || "Stream audio impossible", 500);
  }
}
