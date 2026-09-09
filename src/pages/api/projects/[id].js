import { json, error } from "../../../server/http.js";
import { getProject, deleteProject } from "../../../server/db.js";
import {
  hydrateProjectArtistGender,
  collectS3KeysFromProject,
} from "../../../server/artists.js";
import { deleteS3Keys, deleteS3Prefix } from "../../../server/s3.js";
import { getSessionFromCookies, ROLE_ADMIN } from "../../../server/auth.js";

export const prerender = false;

function assertProjectAccess(stored, session) {
  if (!session?.email) {
    const err = new Error("Non autorisé");
    err.status = 401;
    throw err;
  }
  if (session.role === ROLE_ADMIN) return;
  const owner = stored?.ownerEmail ? String(stored.ownerEmail).toLowerCase() : null;
  if (owner && owner !== session.email.toLowerCase()) {
    const err = new Error("Ce projet appartient à un autre compte");
    err.status = 403;
    throw err;
  }
}

export async function GET({ params, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    const project = await getProject(params.id);
    if (!project) return error("Projet introuvable", 404);
    assertProjectAccess(project, session);
    const hydrated = await hydrateProjectArtistGender(project);
    return json({ project: hydrated });
  } catch (e) {
    return error(e.message || "Erreur lecture projet", e.status || 500);
  }
}

export async function DELETE({ params, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    const id = params.id;
    const stored = await getProject(id);
    if (!stored) return error("Projet introuvable", 404);
    assertProjectAccess(stored, session);
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
    return error(e.message || "Erreur suppression", e.status || 500);
  }
}
