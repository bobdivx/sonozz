import { api } from "../apiClient.js";
import { getJob, listActiveJobs, patchJob, removeJob } from "../jobStore.js";
import { cancelledAlbumState } from "../albumTracks.js";
import {
  canonicalAlbumJobId,
  dedupeStoredAlbumJobs,
  markAlbumMirrorDismissed,
  removeDuplicateAlbumJobs,
} from "../albumJobMirror.js";
import { interruptAlbumJobs } from "./albumJobs.js";
import { cancelMusicTrackJob } from "./trackJobs.js";
import { interruptHttpBoundJob } from "./httpJobs.js";
import { ensureRunning } from "./runnerCore.js";
import { HTTP_BOUND_TYPES, isBooted, setBooted } from "./state.js";

/**
 * Arrête une tâche (y compris « running ») et la retire du dock.
 * Pour un album, persiste l’annulation Turso sinon le poll 4 s la recrée.
 */
export async function dismissJob(jobId) {
  const job = getJob(jobId);
  if (!job) return;

  if (job.type === "album" || job.remoteAlbum) {
    markAlbumMirrorDismissed(job.albumId, job.projectId);
    interruptAlbumJobs(job.projectId || null, "Album arrêté");
    if (job.projectId) {
      try {
        const { project: saved } = await api.getProject(job.projectId);
        const data = saved?.project || saved;
        const album = data?.album;
        if (album?.status === "running") {
          markAlbumMirrorDismissed(album.id, saved.id || job.projectId);
          await api.saveProject({
            id: saved.id || job.projectId,
            project: { ...data, album: cancelledAlbumState(album) },
            seed: saved.seed,
            event: {
              stepKey: "album",
              eventType: "album",
              message: "Album arrêté",
            },
          });
        }
      } catch {
        /* réseau : la carte locale part quand même */
      }
    }
    const canonical = job.projectId
      ? canonicalAlbumJobId({ id: job.albumId, jobId: job.id }, job.projectId)
      : job.id;
    removeDuplicateAlbumJobs(canonical, {
      projectId: job.projectId,
      albumId: job.albumId,
    });
    removeJob(job.id);
    if (canonical !== job.id) removeJob(canonical);
    return;
  }

  if (job.type === "track") {
    cancelMusicTrackJob(job.projectId);
    if (job.status === "running") {
      patchJob(job.id, {
        status: "interrupted",
        phase: "interrupted",
        message: "Génération audio arrêtée",
      });
    }
    removeJob(job.id);
    return;
  }

  if (job.status === "running" && HTTP_BOUND_TYPES.has(job.type) && !job.remoteAlbum) {
    interruptHttpBoundJob(job.id, "Tâche arrêtée");
  } else if (job.status === "running") {
    patchJob(job.id, {
      status: "interrupted",
      phase: "interrupted",
      message: "Tâche retirée",
    });
  }
  removeJob(jobId);
}

/** Au chargement de chaque page : reprend les jobs running. */
export function resumeAllJobs() {
  for (const job of listActiveJobs()) {
    if (job.remoteAlbum) continue;
    if (HTTP_BOUND_TYPES.has(job.type)) {
      interruptHttpBoundJob(
        job.id,
        job.type === "pipeline"
          ? "Pipeline coupé par la navigation. Relance Auto A→Z — évite de quitter le Studio pendant ce run."
          : "Tâche coupée par la navigation — relance depuis le Studio.",
      );
      continue;
    }
    if (job.type === "veo") {
      if (job.operationName) ensureRunning(job.id);
      else {
        patchJob(job.id, {
          status: "error",
          message: "Job Veo sans opération — relance le short",
        });
      }
      continue;
    }
    if (job.type === "seedance" || job.type === "wan2gp") {
      ensureRunning(job.id);
      continue;
    }
    if (job.type === "album") {
      if (job.projectId) ensureRunning(job.id);
      continue;
    }
    if (job.type === "track") {
      if (job.projectId) ensureRunning(job.id);
      continue;
    }
  }
}

export function bootJobRunner() {
  if (typeof window === "undefined" || isBooted()) return;
  setBooted(true);
  dedupeStoredAlbumJobs();
  resumeAllJobs();
  window.addEventListener("pagehide", () => {
    for (const job of listActiveJobs()) {
      if (HTTP_BOUND_TYPES.has(job.type)) interruptHttpBoundJob(job.id);
      // album / morceau / clips : le runner reprend au prochain chargement
    }
  });
}
