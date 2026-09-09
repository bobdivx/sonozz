import { json, error, readBody } from "../../../server/http.js";
import { createAlbumFromLead, migrateAlbumsFromProjects } from "../../../server/albums.js";
import { listAlbumsByArtist } from "../../../server/db.js";
import { getSessionFromCookies, ROLE_ADMIN } from "../../../server/auth.js";
import { assertAlbumQuota, assertCanOwnArtistSlug } from "../../../server/quotas.js";

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

export async function POST({ request, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const body = await readBody(request);

    if (body.action === "migrate") {
      if (session.role !== ROLE_ADMIN) return error("Réservé admin", 403);
      const result = await migrateAlbumsFromProjects();
      return json(result);
    }

    if (!body.artistSlug || !body.leadProjectId) {
      return error("artistSlug et leadProjectId requis", 400);
    }

    await assertCanOwnArtistSlug(session.email, body.artistSlug, { role: session.role });
    await assertAlbumQuota(session.email, { role: session.role });

    const album = await createAlbumFromLead({
      artistSlug: body.artistSlug,
      leadProjectId: body.leadProjectId,
      title: body.title,
      concept: body.concept,
      targetCount: body.targetCount || 8,
    });

    return json(album);
  } catch (e) {
    const status =
      e.code === "QUOTA_ALBUMS" || e.code === "FORBIDDEN_ARTIST" ? 403 : 500;
    return error(e.message || "Erreur création album", status);
  }
}

export const prerender = false;
