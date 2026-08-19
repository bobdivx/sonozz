import { json, error, readBody } from "../../../server/http.js";
import {
  getArtistHub,
  getArtistBySlug,
  createArtistRelease,
  openArtistStyleEditor,
  computeArtistStats,
  adviseArtistCareer,
  upsertArtistFromProject,
} from "../../../server/artists.js";
import { previewCareerSchedule, runCareerSchedule } from "../../../server/careerSchedule.js";
import { getUserKeys } from "../../../server/db.js";

export const prerender = false;

export async function GET({ params }) {
  try {
    const slug = params.slug;
    const hub = await getArtistHub(slug);
    if (!hub) return error("Artiste introuvable", 404);
    return json({ artist: hub });
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}

export async function POST({ params, request }) {
  try {
    const slug = params.slug;
    const body = await readBody(request);
    const action = body.action || "new-track";

    if (action === "refresh-stats") {
      const stored = (await getUserKeys()) || {};
      const keys = { ...stored, ...(body.keys || {}) };
      const onceToken = keys.onceApiToken?.trim() || body.onceApiToken?.trim() || "";
      const stats = await computeArtistStats(slug, { onceToken, keys });
      let career = null;
      let careerCached = false;
      // Après sync ONCE : recalcule le conseil (force) pour détecter ISRC / Unison
      if (body.advise !== false) {
        try {
          const advice = await adviseArtistCareer(slug, {
            keys,
            force: true,
          });
          career = advice.career;
          careerCached = Boolean(advice.cached);
        } catch {
          /* conseil non bloquant */
        }
      }
      return json({
        stats,
        onceSynced: Boolean(onceToken),
        career,
        careerCached,
      });
    }

    if (action === "career-advice") {
      const result = await adviseArtistCareer(slug, {
        keys: body.keys || {},
        force: Boolean(body.force),
      });
      return json(result);
    }

    if (action === "schedule-preview") {
      const preview = await previewCareerSchedule(slug);
      return json({ preview });
    }

    if (action === "run-schedule") {
      const result = await runCareerSchedule(slug, {
        keys: body.keys || {},
        dryRun: Boolean(body.dryRun),
      });
      return json(result);
    }

    if (action === "new-track") {
      const created = await createArtistRelease(slug, {
        theme: body.theme || "",
        variantOf: body.variantOf || null,
      });
      return json(created);
    }

    if (action === "edit-style") {
      const opened = await openArtistStyleEditor(slug);
      return json(opened);
    }

    if (action === "save-profile") {
      const existing = await getArtistBySlug(slug);
      if (!existing) return error("Artiste introuvable", 404);
      const profile = body.profile || body.artist;
      if (!profile || typeof profile !== "object") {
        return error("Profil manquant", 400);
      }
      const name = String(profile.name || existing.name || "").trim();
      if (!name) return error("Nom d’artiste manquant", 400);
      const saved = await upsertArtistFromProject(
        { ...profile, slug, name },
        { preferredSlug: slug },
      );
      return json({ ok: true, artist: saved });
    }

    return error("Action inconnue", 400);
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}
