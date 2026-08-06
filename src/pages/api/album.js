import { json, error, readBody } from "../../server/http.js";
import { planAlbumTracklist } from "../../server/album.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const action = String(body?.action || "plan").trim();

    if (action === "plan") {
      const count = Number(body?.count);
      const data = await planAlbumTracklist({
        keys: body?.keys,
        artist: body?.artist,
        leadLyrics: body?.lyrics || body?.leadLyrics,
        leadTrack: body?.track || body?.leadTrack,
        count: Number.isFinite(count) && count > 0 ? count : 7,
      });
      return json(data);
    }

    return error(`Action album inconnue: ${action}`, 400);
  } catch (e) {
    return error(e.message || "Erreur album", 500);
  }
}

export const prerender = false;
