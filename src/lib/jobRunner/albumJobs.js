import { api } from "../apiClient.js";
import { getJob, listActiveJobs, patchJob, upsertJob } from "../jobStore.js";
import { emptyProject, studioHref } from "../studio.js";
import { runAlbumJob } from "../runAlbumJob.js";
import { albumAborts } from "./state.js";
import { ensureRunning } from "./runnerCore.js";

export function albumJobId(projectId) {
  return `album-${projectId || "unknown"}`;
}

export function interruptAlbumJobs(projectId, message = "Album arrêté") {
  if (!projectId) return;
  const canonicalId = albumJobId(projectId);
  const abort = albumAborts.get(canonicalId);
  if (abort) abort.aborted = true;

  for (const job of listActiveJobs()) {
    if (job.projectId !== projectId) continue;
    if (job.type !== "album" && !job.remoteAlbum) continue;
    const inflightAbort = albumAborts.get(job.id);
    if (inflightAbort) inflightAbort.aborted = true;
    if (job.status === "running") {
      patchJob(job.id, {
        status: "interrupted",
        phase: "interrupted",
        message,
      });
    }
  }
}

/**
 * Lance (ou reprend) la génération album en arrière-plan.
 * Survivt à la navigation MPA via localStorage + Turso.
 */
export function startAlbumJob({
  projectId,
  totalCount = 8,
  resume = false,
  href,
  label,
  title = "",
  concept = "",
  dbAlbumId = null,
  withFeats = false,
  featArtists = [],
} = {}) {
  if (!projectId) throw new Error("projectId manquant pour l’album");
  const id = albumJobId(projectId);
  upsertJob({
    id,
    type: "album",
    status: "running",
    phase: "running",
    label: label || (title ? `Album · ${title}` : `Album · ${totalCount} titres`),
    message: resume
      ? "Reprise album…"
      : withFeats
        ? "Démarrage album (feats auto)…"
        : "Démarrage album…",
    progress: resume ? 8 : 4,
    projectId,
    totalCount,
    resume: Boolean(resume),
    href: href || studioHref(projectId, "tracks"),
    remoteAlbum: false,
    preferredTitle: title || "",
    preferredConcept: concept || "",
    dbAlbumId: dbAlbumId || null,
    withFeats: Boolean(withFeats),
    featArtists: Array.isArray(featArtists) ? featArtists : [],
  });
  ensureRunning(id);
  return id;
}

export function cancelAlbumJob(projectId) {
  interruptAlbumJobs(projectId);
}

export async function runAlbumBackgroundJob(job) {
  const id = job.id;
  const projectId = job.projectId;
  if (!projectId) throw new Error("Album sans projectId");

  const abortState = { aborted: false };
  albumAborts.set(id, abortState);

  const { project: saved } = await api.getProject(projectId);
  if (!saved?.id) throw new Error("Projet album introuvable");
  if (abortState.aborted) return;

  const project = { ...emptyProject(), ...(saved.project || {}) };
  const seed = saved.seed || {};
  const workingRef = { current: project };
  if (abortState.aborted || project.album?.status === "cancelled") {
    if (getJob(id)) {
      patchJob(id, {
        status: "interrupted",
        phase: "interrupted",
        message: "Album arrêté",
      });
    }
    return;
  }
  const resume =
    Boolean(job.resume) ||
    (project.album?.status === "running" && (project.album.tracks || []).length > 0);

  patchJob(id, {
    message: resume ? "Reprise album…" : "Album en arrière-plan…",
  });

  try {
    const preferredTitle = String(job.preferredTitle || "").trim();
    const preferredConcept = String(job.preferredConcept || "").trim();
    const withFeats = Boolean(job.withFeats);
    const featArtists = Array.isArray(job.featArtists) ? job.featArtists : [];
    if ((preferredTitle || preferredConcept || withFeats) && !resume) {
      project.album = {
        ...(project.album || {}),
        ...(preferredTitle ? { title: preferredTitle } : {}),
        ...(preferredConcept ? { concept: preferredConcept } : {}),
        withFeats,
      };
      workingRef.current = project;
    }

    const result = await runAlbumJob({
      project,
      projectId,
      seed,
      totalCount: job.totalCount || project.album?.targetCount || 8,
      resume,
      abortState,
      preferredTitle,
      preferredConcept,
      withFeats,
      featArtists,
      persist: async (next, event) => {
        if (abortState.aborted) return;
        workingRef.current = next;
        await api.saveProject({
          id: projectId,
          project: next,
          seed,
          event,
        });
      },
      syncWorking: (next) => {
        workingRef.current = next;
      },
      getWorking: () => workingRef.current,
      jobId: id,
      onProgress: ({ percent, message, label }) => {
        if (abortState.aborted || !getJob(id)) return;
        patchJob(id, {
          progress: percent,
          message,
          ...(label ? { label } : {}),
        });
      },
    });
    if (getJob(id)) {
      patchJob(id, {
        status: result?.ok ? "done" : result?.providerDown ? "error" : "done",
        phase: result?.ok ? "done" : "error",
        progress: 100,
        message: result?.message || "Album terminé",
      });
    }
  } catch (e) {
    const wasAbort = e?.name === "AbortError" || abortState.aborted;
    if (getJob(id)) {
      patchJob(id, {
        status: wasAbort ? "interrupted" : "error",
        phase: wasAbort ? "interrupted" : "error",
        message: wasAbort ? "Album annulé" : e?.message || "Album en erreur",
      });
    }
    if (!wasAbort) throw e;
  } finally {
    albumAborts.delete(id);
  }
}
