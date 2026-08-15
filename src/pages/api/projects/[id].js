import { json, error } from "../../../server/http.js";
import { getProject, deleteProject } from "../../../server/db.js";
import { hydrateProjectArtistGender } from "../../../server/artists.js";

export const prerender = false;

export async function GET({ params }) {
  try {
    const project = await getProject(params.id);
    if (!project) return error("Projet introuvable", 404);
    const hydrated = await hydrateProjectArtistGender(project);
    return json({ project: hydrated });
  } catch (e) {
    return error(e.message || "Erreur lecture projet", 500);
  }
}

export async function DELETE({ params }) {
  try {
    await deleteProject(params.id);
    return json({ ok: true });
  } catch (e) {
    return error(e.message || "Erreur suppression", 500);
  }
}
