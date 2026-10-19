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

    let cloneSource = null;
    const cloneSlug = String(body.cloneFromSlug || "").trim().slice(0, 120);
    if (cloneSlug) {
      const { getArtistBySlug } = await import("../../server/artists.js");
      const src = await getArtistBySlug(cloneSlug);
      if (!src) return error("Artiste source introuvable", 404);
      if (session.role !== ROLE_ADMIN && src.ownerEmail && src.ownerEmail !== session.email) {
        return error("Tu ne peux cloner que tes propres artistes", 403);
      }
      if (preferredSlug && preferredSlug === src.slug) {
        return error("Un artiste ne peut pas être cloné sur lui-même", 400);
      }
      cloneSource = { ...(src.profile || {}), slug: src.slug, name: src.profile?.name || src.name };
    }

    const { cloneSource: _ignored, ...safeBody } = body;
    const data = await runArtist({ ...safeBody, cloneSource });
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
