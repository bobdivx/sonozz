import { json, error } from "../../../server/http.js";
import { getProject, deleteProject } from "../../../server/db.js";
import {
  hydrateProjectArtistGender,
  collectS3KeysFromProject,
} from "../../../server/artists.js";
import { deleteS3Keys, deleteS3Prefix } from "../../../server/s3.js";

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
    const id = params.id;
    const stored = await getProject(id);
    if (stored?.project) {
      const keys = collectS3KeysFromProject(stored.project);
      await deleteS3Keys(keys);
      const seg = String(id || "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(0, 80);
      if (seg) {
        await deleteS3Prefix(`audio/${seg}`);
        await deleteS3Prefix(`clips/${seg}`);
      }
    }
    await deleteProject(id);
    return json({ ok: true });
  } catch (e) {
    return error(e.message || "Erreur suppression", 500);
  }
}
