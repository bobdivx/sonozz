import { json, error, readBody } from "../../server/http.js";
import { runArtist } from "../../server/pipeline.js";
import { upsertArtistFromProject } from "../../server/artists.js";
import { getSessionFromCookies, ROLE_ADMIN } from "../../server/auth.js";
import { assertArtistQuota } from "../../server/quotas.js";

export async function POST({ request, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const body = await readBody(request);
    const preferredSlug = body.slug || undefined;
    // Nouveau profil → quota (update d’un existant = pas de nouveau slot)
    if (body.persist !== false) {
      const { getArtistBySlug } = await import("../../server/artists.js");
      const existing = preferredSlug ? await getArtistBySlug(preferredSlug) : null;
      if (!existing) {
        await assertArtistQuota(session.email, { role: session.role });
      } else if (
        session.role !== ROLE_ADMIN &&
        existing.ownerEmail &&
        existing.ownerEmail !== session.email
      ) {
        return error("Cet artiste appartient à un autre compte", 403);
      }
    }

    const data = await runArtist(body);
    let slug = preferredSlug || data.slug || null;
    if (body.persist !== false) {
      const saved = await upsertArtistFromProject(
        { ...data, slug: slug || data.slug },
        {
          preferredSlug: slug || undefined,
          ownerEmail: session.role === ROLE_ADMIN ? session.email : session.email,
        },
      );
      slug = saved?.slug || slug;
    }
    return json({ ...data, slug });
  } catch (e) {
    const status = e.code === "QUOTA_ARTISTS" ? 403 : 500;
    return error(e.message || "Erreur artiste", status);
  }
}

export const prerender = false;
