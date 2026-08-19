import { json, error, readBody } from "../../../server/http.js";
import { listArtists, syncArtistsFromProjects, upsertArtistFromProject } from "../../../server/artists.js";

export const prerender = false;

export async function GET({ url }) {
  try {
    const forceSync = new URL(url).searchParams.get("sync") === "1";
    // Sync forcé seulement si demandé ; sinon auto-sync uniquement table vide (dans listArtists)
    if (forceSync) {
      await syncArtistsFromProjects();
    }
    const artists = await listArtists(80);
    return json({ artists });
  } catch (e) {
    return error(e.message || "Erreur liste artistes", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    if (body.action === "save-profile") {
      const profile = body.profile || body.artist;
      const name = String(profile?.name || "").trim();
      if (!name) return error("Nom d’artiste manquant", 400);
      const saved = await upsertArtistFromProject({ ...profile, name });
      if (!saved) return error("Sauvegarde impossible", 500);
      return json({ ok: true, artist: saved });
    }
    const synced = await syncArtistsFromProjects();
    const artists = await listArtists(80);
    return json({ synced: synced.length, artists });
  } catch (e) {
    return error(e.message || "Sync artistes KO", 500);
  }
}
