import { json, error, readBody } from "../../../server/http.js";
import { createAlbumFromLead, migrateAlbumsFromProjects } from "../../../server/albums.js";
import { listAlbumsByArtist } from "../../../server/db.js";

export async function GET({ url }) {
  try {
    const artistSlug = url.searchParams.get("artistSlug");
    if (!artistSlug) {
      return error("artistSlug requis", 400);
    }
    const albums = await listAlbumsByArtist(artistSlug);
    return json({ albums });
  } catch (e) {
    return error(e.message || "Erreur récupération albums", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    
    if (body.action === "migrate") {
      const result = await migrateAlbumsFromProjects();
      return json(result);
    }
    
    if (!body.artistSlug || !body.leadProjectId) {
      return error("artistSlug et leadProjectId requis", 400);
    }
    
    const album = await createAlbumFromLead({
      artistSlug: body.artistSlug,
      leadProjectId: body.leadProjectId,
      title: body.title,
      concept: body.concept,
      targetCount: body.targetCount || 8,
    });
    
    return json(album);
  } catch (e) {
    return error(e.message || "Erreur création album", 500);
  }
}

export const prerender = false;
