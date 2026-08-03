import { json, error } from "../../../server/http.js";
import { listArtists, syncArtistsFromProjects } from "../../../server/artists.js";

export const prerender = false;

export async function GET({ url }) {
  try {
    const forceSync = new URL(url).searchParams.get("sync") === "1";
    if (forceSync) {
      await syncArtistsFromProjects();
    }
    const artists = await listArtists(80);
    return json({ artists });
  } catch (e) {
    return error(e.message || "Erreur liste artistes", 500);
  }
}

export async function POST() {
  try {
    const synced = await syncArtistsFromProjects();
    const artists = await listArtists(80);
    return json({ synced: synced.length, artists });
  } catch (e) {
    return error(e.message || "Sync artistes KO", 500);
  }
}
