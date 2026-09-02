import { json, error, readBody } from "../../../server/http.js";
import {
  getArtistHub,
  getArtistBySlug,
  createArtistRelease,
  openArtistStyleEditor,
  computeArtistStats,
  adviseArtistCareer,
  upsertArtistFromProject,
  deleteArtist,
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

export async function DELETE({ params }) {
  try {
    const slug = params.slug;
    if (!slug) return error("Slug manquant", 400);
    const result = await deleteArtist(slug);
    return json(result);
  } catch (e) {
    const msg = e.message || "Suppression impossible";
    const status = /introuvable/i.test(msg) ? 404 : 500;
    return error(msg, status);
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
        genreOverride: body.genreOverride,
        referencesOverride: body.referencesOverride,
        referenceTrackOverride: body.referenceTrackOverride,
        featArtist: body.featArtist || null,
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

    if (action === "ensure-timbre") {
      const existing = await getArtistBySlug(slug);
      if (!existing) return error("Artiste introuvable", 404);
      const { ensureArtistTimbre } = await import("../../../server/artistTimbre.js");
      const keys = { ...((await getUserKeys()) || {}), ...(body.keys || {}) };
      const profile = {
        ...(existing.profile || {}),
        slug,
        name: existing.name || existing.profile?.name,
        ...(body.profile && typeof body.profile === "object" ? body.profile : {}),
      };
      const res = await ensureArtistTimbre(keys, profile, {
        slug,
        force: Boolean(body.force),
        audioUrl: body.audioUrl || null,
      });
      if (res.ok && res.artist) {
        const saved = await upsertArtistFromProject(
          { ...res.artist, slug, name: res.artist.name || existing.name },
          { preferredSlug: slug },
        );
        return json({
          ok: true,
          skipped: Boolean(res.skipped),
          reason: res.reason,
          timbre: res.timbre,
          artist: saved,
        });
      }
      return json({
        ok: false,
        skipped: Boolean(res.skipped),
        reason: res.reason || "analyse impossible",
        timbre: null,
      });
    }

    if (action === "regenerate-track") {
      const projectId = body.projectId;
      if (!projectId) return error("ID projet manquant", 400);
      
      const { getProject, saveProject } = await import("../../../server/db.js");
      const stored = await getProject(projectId);
      if (!stored?.project) return error("Projet introuvable", 404);
      
      // Conserver l'ancienne version avant régénération
      const prevTrack = stored.project.track;
      const prevVersions = stored.project.trackVersions || [];
      if (prevTrack?.audioUrl) {
        prevVersions.push({
          audioUrl: prevTrack.audioUrl,
          audioS3Key: prevTrack.audioS3Key,
          title: prevTrack.title,
          generatedAt: new Date().toISOString(),
        });
      }

      // Appliquer les overrides au profil si fournis
      let profileOverrides = {};
      if (body.genreOverride) {
        profileOverrides.genre = body.genreOverride;
      }
      if (Array.isArray(body.referencesOverride) && body.referencesOverride.length > 0) {
        profileOverrides.styleArtists = body.referencesOverride;
      }
      if (body.referenceTrackOverride) {
        const currentLock = stored.project.artist?.styleLock || stored.seed?.styleLock || {};
        profileOverrides.styleLock = {
          ...currentLock,
          topTracks: [body.referenceTrackOverride, ...(currentLock.topTracks || []).slice(0, 4)],
        };
      }

      // Mettre à jour l'artist dans le projet si des overrides sont fournis
      const updatedArtist = Object.keys(profileOverrides).length > 0
        ? { ...stored.project.artist, ...profileOverrides }
        : stored.project.artist;

      const { normalizeFeatArtist } = await import("../../../lib/featArtist.js");
      const feat =
        body.featArtist === undefined
          ? stored.project.featArtist || null
          : normalizeFeatArtist(body.featArtist);
      
      // Réinitialiser le track pour régénération
      const updated = await saveProject({
        id: projectId,
        project: {
          ...stored.project,
          artist: updatedArtist,
          featArtist: feat,
          track: {
            ...stored.project.track,
            status: "pending",
            audioUrl: null,
            audioS3Key: null,
          },
          trackVersions: prevVersions.slice(-5), // Garder max 5 versions
        },
        seed: {
          ...stored.seed,
          ...profileOverrides,
        },
        event: {
          stepKey: "tracks",
          eventType: "regenerate",
          message: `Régénération audio demandée`,
        },
      });
      
      return json({
        ok: true,
        projectId: updated.id,
        studioUrl: `/?project=${updated.id}&step=3`,
      });
    }

    return error("Action inconnue", 400);
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}
