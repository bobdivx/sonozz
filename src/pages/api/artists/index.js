import { json, error, readBody } from "../../../server/http.js";
import { listArtists, syncArtistsFromProjects, upsertArtistFromProject } from "../../../server/artists.js";
import { getUserKeys } from "../../../server/db.js";

export const prerender = false;

export async function GET({ url }) {
  try {
    const forceSync = new URL(url).searchParams.get("sync") === "1";
    // Sync forcé seulement si demandé ; sinon auto-sync uniquement table vide (dans listArtists)
    if (forceSync) {
      await syncArtistsFromProjects();
    }
    const artists = await listArtists(80);
    return json({ artists });
  } catch (e) {
    return error(e.message || "Erreur liste artistes", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    if (body.action === "save-profile") {
      const profile = body.profile || body.artist;
      const name = String(profile?.name || "").trim();
      if (!name) return error("Nom d’artiste manquant", 400);
      const saved = await upsertArtistFromProject({ ...profile, name });
      if (!saved) return error("Sauvegarde impossible", 500);
      return json({ ok: true, artist: saved });
    }
    if (body.action === "backfill-timbres") {
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
    const synced = await syncArtistsFromProjects();
    const artists = await listArtists(80);
    return json({ synced: synced.length, artists });
  } catch (e) {
    return error(e.message || "Sync artistes KO", 500);
  }
}
