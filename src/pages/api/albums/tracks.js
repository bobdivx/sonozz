import { json, error, readBody } from "../../../server/http.js";
import { addAlbumTrack, updateAlbumTrack, deleteAlbumTrack } from "../../../server/db.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    
    if (!body.albumId) {
      return error("albumId requis", 400);
    }
    
    const track = await addAlbumTrack({
      albumId: body.albumId,
      projectId: body.projectId,
      role: body.role || "member",
      index: body.index,
      workingTitle: body.workingTitle || "",
      theme: body.theme || "",
      status: body.status || "pending",
    });
    
    return json(track);
  } catch (e) {
    return error(e.message || "Erreur ajout track", 500);
  }
}

export async function PATCH({ request }) {
  try {
    const body = await readBody(request);
    
    if (!body.trackId) {
      return error("trackId requis", 400);
    }
    
    const result = await updateAlbumTrack(body.trackId, body);
    return json(result);
  } catch (e) {
    return error(e.message || "Erreur mise à jour track", 500);
  }
}

export async function DELETE({ request }) {
  try {
    const body = await readBody(request);
    
    if (!body.trackId) {
      return error("trackId requis", 400);
    }
    
    const result = await deleteAlbumTrack(body.trackId);
    return json(result);
  } catch (e) {
    return error(e.message || "Erreur suppression track", 500);
  }
}

export const prerender = false;
