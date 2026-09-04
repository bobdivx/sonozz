import { getJob, patchJob } from "../jobStore.js";
import { cleanupShotBlobs } from "./clipVideo.js";
import { runAlbumBackgroundJob } from "./albumJobs.js";
import { runTrackBackgroundJob } from "./trackJobs.js";
import { runVeoJob, runSeedanceJob, runWan2gpJob } from "./videoJobs.js";
import { memVideo, inflight } from "./state.js";

export function ensureRunning(jobId) {
  if (!jobId || inflight.has(jobId)) return;
  const p = runJob(jobId).finally(() => inflight.delete(jobId));
  inflight.set(jobId, p);
}

async function runJob(jobId) {
  const job = getJob(jobId);
  if (!job || job.status !== "running") return;

  try {
    if (job.type === "veo") await runVeoJob(job);
    else if (job.type === "seedance") await runSeedanceJob(job);
    else if (job.type === "wan2gp") await runWan2gpJob(job);
    else if (job.type === "album") await runAlbumBackgroundJob(job);
    else if (job.type === "track") await runTrackBackgroundJob(job);
  } catch (e) {
    if (!getJob(jobId)) return;
    patchJob(jobId, {
      status: "error",
      phase: "error",
      message: e?.message || "Échec du job",
    });
    memVideo.delete(jobId);
    try {
      await cleanupShotBlobs(job.shotStorageKeys || getJob(jobId)?.shotStorageKeys || []);
    } catch {
      /* ignore */
    }
  }
}
