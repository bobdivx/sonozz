import { json, error, readBody } from "../../../server/http.js";
import { getAlbum, updateAlbum, deleteAlbum, addAlbumTrack, updateAlbumTrack, deleteAlbumTrack } from "../../../server/db.js";

export async function GET({ params }) {
  try {
    const albumId = params.id;
    const album = await getAlbum(albumId);
    if (!album) return error("Album introuvable", 404);
    return json(album);
  } catch (e) {
    return error(e.message || "Erreur récupération album", 500);
  }
}

export async function PATCH({ params, request }) {
  try {
    const albumId = params.id;
    const body = await readBody(request);
    const album = await updateAlbum(albumId, body);
    return json(album);
  } catch (e) {
    return error(e.message || "Erreur mise à jour album", 500);
  }
}

export async function DELETE({ params }) {
  try {
    const albumId = params.id;
    await deleteAlbum(albumId);
    return json({ ok: true });
  } catch (e) {
    return error(e.message || "Erreur suppression album", 500);
  }
}

export const prerender = false;
