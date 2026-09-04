import { api } from "../apiClient.js";
import { getJob, patchJob, upsertJob } from "../jobStore.js";
import { emptyProject, studioHref } from "../studio.js";
import { persistAudioRemote } from "../audioResolve.js";
import { stripClipsForDb, normalizeProjectClips } from "../clipsModel.js";
import { appendVersion, normalizeProjectVersions } from "../versionsModel.js";
import { applySonicVariation, artistWithSonicVariation } from "../sonicVariation.js";
import { trackAborts } from "./state.js";
import { ensureRunning } from "./runnerCore.js";

export function musicTrackJobId(projectId) {
  return `track-${projectId || "unknown"}`;
}

/** Évite de saturer localStorage avec le draft ACE/SongGen. */
function slimTrackDraft(draft) {
  if (!draft || typeof draft !== "object") return null;
  const { waveform: _w, audioUrl: _a, audioS3Key: _k, ...rest } = draft;
  try {
    const json = JSON.stringify(rest);
    if (json.length > 80_000) {
      return {
        isPreview: Boolean(rest.isPreview),
        status: rest.status,
        provider: rest.provider,
        bpm: rest.bpm,
        note: rest.note,
        title: rest.title,
        voiceGender: rest.voiceGender,
      };
    }
    return JSON.parse(json);
  } catch {
    return { isPreview: Boolean(draft.isPreview), status: draft.status };
  }
}

/**
 * Lance (ou reprend) un morceau unique / extrait en arrière-plan.
 * Survivt à la navigation MPA via localStorage + poll ACE/SongGen/Replicate.
 */
export function startMusicTrackJob({
  projectId,
  preview = false,
  href,
  label,
} = {}) {
  if (!projectId) throw new Error("projectId manquant pour le morceau");
  const id = musicTrackJobId(projectId);
  const existing = getJob(id);
  if (existing?.status === "running") {
    throw new Error("Une génération de morceau est déjà en cours — suis-la dans Tâches.");
  }
  upsertJob({
    id,
    type: "track",
    status: "running",
    phase: "running",
    label: label || (preview ? "Extrait audio" : "Morceau"),
    message: preview ? "Démarrage extrait…" : "Démarrage génération audio…",
    progress: 4,
    projectId,
    preview: Boolean(preview),
    generationId: null,
    musicKind: null,
    draft: null,
    href: href || studioHref(projectId, "tracks"),
  });
  ensureRunning(id);
  return id;
}

export function cancelMusicTrackJob(projectId) {
  if (!projectId) return;
  const id = musicTrackJobId(projectId);
  const abort = trackAborts.get(id);
  if (abort) abort.aborted = true;
  const job = getJob(id);
  if (job?.status === "running") {
    patchJob(id, {
      status: "interrupted",
      phase: "interrupted",
      message: "Génération audio arrêtée",
    });
  }
}

export async function runTrackBackgroundJob(job) {
  const id = job.id;
  const projectId = job.projectId;
  if (!projectId) throw new Error("Morceau sans projectId");

  const abortState = { aborted: false };
  trackAborts.set(id, abortState);

  const { project: saved } = await api.getProject(projectId);
  if (!saved?.id) throw new Error("Projet introuvable pour le morceau");
  if (abortState.aborted) return;

  let project = { ...emptyProject(), ...(saved.project || {}) };
  const seed = saved.seed || {};
  const preview = Boolean(job.preview);
  const live = getJob(id) || job;

  patchJob(id, {
    message: live.generationId
      ? preview
        ? "Reprise extrait…"
        : "Reprise génération audio…"
      : preview
        ? "Extrait en arrière-plan…"
        : "Morceau en arrière-plan…",
  });

  try {
    const variation = applySonicVariation({
      musicArrange: project.musicArrange,
      styleLock: project.artist?.styleLock,
      role:
        project.sonicRole ||
        project.albumMeta?.trackRole ||
        (project.albumMeta?.index === 1 ? "single" : undefined),
      title: project.lyrics?.title || project.track?.title || "",
      artistKey: project.artist?.slug || project.artist?.name || "",
      trackIndex: project.albumMeta?.index ?? null,
      trackTotal: null,
    });
    // Fige l’arrangement / rôle sur le projet pour les régénérations cohérentes.
    project = {
      ...project,
      musicArrange: variation.musicArrange,
      sonicRole: variation.sonicRole,
    };

    let result = await api.track(
      {
        preview,
        lyrics: project.lyrics,
        artist: artistWithSonicVariation(
          {
            ...project.artist,
            featArtist: project.featArtist || null,
          },
          variation,
        ),
      },
      (p) => {
        if (!p || abortState.aborted || !getJob(id)) return;
        patchJob(id, {
          progress: Math.max(8, Math.min(96, Number(p.percent) || 12)),
          message: p.message || (preview ? "Extrait…" : "Génération audio…"),
          phase: p.phase || "running",
          model: p.model || p.modelLabel || undefined,
          modelLabel: p.modelLabel || undefined,
          gpu: p.gpu || undefined,
        });
      },
      {
        signal: abortState,
        onStarted: (started) => {
          if (!started?.generationId) return;
          try {
            patchJob(id, {
              generationId: started.generationId,
              musicKind: started.musicKind || null,
              draft: slimTrackDraft(started.draft),
              model: started.model || started.draft?.aceStepModel || undefined,
              modelLabel: started.quality || undefined,
              gpu: started.gpu || undefined,
              phase: "generating",
            });
          } catch {
            patchJob(id, {
              generationId: started.generationId,
              musicKind: started.musicKind || null,
              draft: null,
            });
          }
        },
        generationId: live.generationId || undefined,
        musicKind: live.musicKind || undefined,
        draft: live.draft || undefined,
      },
    );

    if (abortState.aborted) {
      if (getJob(id)) {
        patchJob(id, {
          status: "interrupted",
          phase: "interrupted",
          message: "Génération audio annulée",
        });
      }
      return;
    }

    if (result?.audioUrl) {
      patchJob(id, { progress: 88, message: "Persistance audio S3…" });
      try {
        const persisted = await persistAudioRemote(result.audioUrl, projectId);
        if (persisted?.audioUrl) {
          result = {
            ...result,
            audioUrl: persisted.audioUrl,
            audioS3Key: persisted.s3Key,
            audioEphemeral: false,
            warning: persisted.persisted ? undefined : result.warning,
            note: persisted.persisted
              ? `${result.note || "Audio OK"} · sauvé sur S3`
              : result.note,
          };
        }
      } catch (persistErr) {
        result = {
          ...result,
          audioEphemeral: true,
          warning:
            persistErr.message ||
            "Audio non persisté (expire ~1 h) — configure S3 ou réimporte bientôt.",
        };
      }
    }

    if (result?.isPreview || result?.status === "preview-ready") {
      result = { ...result, status: "preview-ready", isPreview: true };
    } else if (result?.audioUrl) {
      result = { ...result, status: "audio-ready", isPreview: false };
    }

    const next = stripClipsForDb(
      normalizeProjectVersions(normalizeProjectClips(appendVersion(project, "track", result))),
    );
    await api.saveProject({
      id: projectId,
      project: next,
      seed,
      event: {
        stepKey: "track",
        eventType: "step",
        message:
          result?.isPreview || result?.status === "preview-ready"
            ? "Extrait prêt — écoute le brouillon"
            : "Étape Morceau générée",
      },
    });

    // Fige le timbre depuis le nouveau morceau si le profil n’en a pas encore.
    if (
      result?.audioUrl &&
      !result?.isPreview &&
      result?.status !== "preview-ready" &&
      next?.artist?.slug
    ) {
      try {
        await api.ensureArtistTimbre(next.artist.slug, {
          force: false,
          audioUrl: result.audioUrl,
          profile: next.artist,
        });
      } catch (e) {
        console.warn("[timbre] post-track:", e?.message || e);
      }
    }

    if (abortState.aborted || !getJob(id)) return;

    if (getJob(id)) {
      patchJob(id, {
        status: "done",
        phase: "done",
        progress: 100,
        message:
          result?.isPreview || result?.status === "preview-ready"
            ? "Extrait prêt — écoute le brouillon"
            : "Morceau terminé",
        generationId: null,
        draft: null,
      });
    }
  } catch (e) {
    const wasAbort = e?.name === "AbortError" || abortState.aborted;
    if (getJob(id)) {
      patchJob(id, {
        status: wasAbort ? "interrupted" : "error",
        phase: wasAbort ? "interrupted" : "error",
        message: wasAbort ? "Génération audio annulée" : e?.message || "Morceau en erreur",
      });
    }
    if (!wasAbort) throw e;
  } finally {
    trackAborts.delete(id);
  }
}
