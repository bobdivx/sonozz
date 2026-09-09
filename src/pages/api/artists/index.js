import { json, error, readBody } from "../../../server/http.js";
import { listArtists, syncArtistsFromProjects, upsertArtistFromProject, getArtistBySlug } from "../../../server/artists.js";
import { getUserKeys } from "../../../server/db.js";
import { getSessionFromCookies, ROLE_ADMIN } from "../../../server/auth.js";
import { assertArtistQuota } from "../../../server/quotas.js";

export const prerender = false;

export async function GET({ url, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const forceSync = new URL(url).searchParams.get("sync") === "1";
    const scopeAll =
      session.role === ROLE_ADMIN && new URL(url).searchParams.get("scope") === "all";

    if (forceSync && session.role === ROLE_ADMIN) {
      await syncArtistsFromProjects();
    }

    // Studio / artistes : toujours le catalogue du compte (sauf admin ?scope=all)
    const artists = await listArtists(80, {
      ownerEmail: session.email,
      includeAll: scopeAll,
    });
    return json({ artists });
  } catch (e) {
    return error(e.message || "Erreur liste artistes", 500);
  }
}

export async function POST({ request, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const body = await readBody(request);
    if (body.action === "save-profile") {
      const profile = body.profile || body.artist;
      const name = String(profile?.name || "").trim();
      if (!name) return error("Nom d’artiste manquant", 400);
      const slug = profile?.slug ? String(profile.slug).trim() : "";
      const existing = slug ? await getArtistBySlug(slug) : null;
      if (!existing) {
        await assertArtistQuota(session.email, { role: session.role });
      } else if (
        session.role !== ROLE_ADMIN &&
        existing.ownerEmail &&
        existing.ownerEmail.toLowerCase() !== session.email.toLowerCase()
      ) {
        return error("Cet artiste appartient à un autre compte", 403);
      }
      const saved = await upsertArtistFromProject(
        { ...profile, name },
        { ownerEmail: session.email },
      );
      if (!saved) return error("Sauvegarde impossible", 500);
      return json({ ok: true, artist: saved });
    }
    if (body.action === "backfill-timbres") {
      if (session.role !== ROLE_ADMIN) return error("Réservé admin", 403);
      const { backfillAllArtistTimbres } = await import("../../../server/artistTimbre.js");
      const keys = { ...((await getUserKeys()) || {}), ...(body.keys || {}) };
      const report = await backfillAllArtistTimbres(keys, {
        limit: Number(body.limit) || 80,
      });
      return json({ ok: true, report });
    }
    if (body.action === "analyze-voice-sample") {
      const { ensureArtistTimbre } = await import("../../../server/artistTimbre.js");
      const keys = { ...((await getUserKeys()) || {}), ...(body.keys || {}) };
      const sample = body.voiceSample || body.sample;
      if (!sample?.url && !sample?.s3Key) {
        return error("voiceSample url/s3Key manquant", 400);
      }
      const draft = {
        name: body.name || "Artist",
        slug: body.slug || undefined,
        gender: body.gender || undefined,
        voiceSample: sample,
      };
      const res = await ensureArtistTimbre(keys, draft, { force: true });
      return json({
        ok: Boolean(res.ok),
        reason: res.reason,
        timbre: res.timbre || null,
        voiceSample: res.artist?.voiceSample || sample,
        artist: res.artist || null,
      });
    }
    if (session.role !== ROLE_ADMIN) return error("Réservé admin", 403);
    const synced = await syncArtistsFromProjects();
    const artists = await listArtists(80, { includeAll: true });
    return json({ synced: synced.length, artists });
  } catch (e) {
    const status = e.code === "QUOTA_ARTISTS" ? 403 : 500;
    return error(e.message || "Sync artistes KO", status);
  }
}
