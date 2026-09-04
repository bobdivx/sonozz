import { createJobId, getJob, subscribeJobs, upsertJob, patchJob } from "../jobStore.js";
import { HTTP_BOUND_TYPES } from "./state.js";

export function waitForJob(jobId, { onUpdate } = {}) {
  return new Promise((resolve, reject) => {
    const unsub = subscribeJobs((jobs) => {
      const j = jobs.find((x) => x.id === jobId) || getJob(jobId);
      if (!j) return;
      onUpdate?.(j);
      if (j.status === "done") {
        unsub();
        resolve(j);
      } else if (j.status === "error" || j.status === "interrupted") {
        unsub();
        reject(new Error(j.message || "Job échoué"));
      }
    });
  });
}

export function trackPipelineJob({ jobId, label, projectId, message, progress } = {}) {
  const id = jobId || createJobId("pipe");
  upsertJob({
    id,
    type: "pipeline",
    status: "running",
    phase: "streaming",
    progress: progress ?? 5,
    message: message || "Pipeline A→Z…",
    label: label || "Pipeline auto",
    projectId: projectId || null,
    href: projectId ? `/?project=${projectId}` : "/",
  });
  return id;
}

/**
 * Tâche HTTP liée à la page (étape Studio, publish) — visible sidebar,
 * interrompue si navigation / reload (pas de worker serveur).
 */
export function trackStepJob({
  jobId,
  type = "step",
  label,
  projectId,
  stepKey,
  message,
  progress,
  href,
} = {}) {
  const id = jobId || createJobId(type === "publish" ? "pub" : "step");
  const stepHref =
    href ||
    (projectId && stepKey
      ? `/?project=${projectId}&step=${stepKey}`
      : projectId
        ? `/?project=${projectId}`
        : "/");
  upsertJob({
    id,
    type: type === "publish" ? "publish" : "step",
    status: "running",
    phase: "running",
    progress: progress ?? 8,
    message: message || "En cours…",
    label: label || "Tâche",
    projectId: projectId || null,
    stepKey: stepKey || null,
    href: stepHref,
  });
  return id;
}

export function finishStepJob(jobId, { ok, message, progress } = {}) {
  if (!jobId) return;
  patchJob(jobId, {
    status: ok ? "done" : "error",
    phase: ok ? "done" : "error",
    progress: ok ? (progress ?? 100) : undefined,
    message: message || (ok ? "Terminé" : "Échec"),
  });
}

export function interruptHttpBoundJob(jobId, message) {
  if (!jobId) return;
  const job = getJob(jobId);
  if (!job || job.status !== "running" || !HTTP_BOUND_TYPES.has(job.type)) return;
  if (job.remoteAlbum) return;
  patchJob(jobId, {
    status: "interrupted",
    phase: "interrupted",
    message:
      message ||
      (job.type === "pipeline"
        ? "Pipeline interrompu (navigation). Relance Auto A→Z depuis le Studio."
        : "Tâche interrompue par la navigation — relance depuis le Studio."),
  });
}

export function finishPipelineJob(jobId, { ok, message, projectId } = {}) {
  if (!jobId) return;
  patchJob(jobId, {
    status: ok ? "done" : "error",
    phase: ok ? "done" : "error",
    progress: ok ? 100 : undefined,
    message: message || (ok ? "Pipeline terminé" : "Pipeline en erreur"),
    ...(projectId ? { projectId, href: `/?project=${projectId}` } : {}),
  });
}

export function interruptPipelineJob(jobId, message) {
  interruptHttpBoundJob(
    jobId,
    message ||
      "Pipeline interrompu (navigation). Relance Auto A→Z depuis le Studio — les tokens déjà utilisés ne sont pas récupérés.",
  );
}