/**
 * Génération morceau : la requête HTTP ne tient JAMAIS l'étape lente (plan instrumental LLM,
 * timbre, référence de style Deezer, caption ACE, arbitre GPU, switch DiT, persist audio).
 * start → job en mémoire, réponse ≤ START_WAIT_MS ; poll → avance le job, réponse ≤ POLL_WAIT_MS.
 * Cause de l'incident « Erreur API 499/502 » (20/10) : startTrack synchrone > timeout proxy.
 */
import { startTrack, pollTrack, cancelTrack } from "./trackStep.js";
import { isAceStepMusicProvider } from "../aceStep.js";
import { isSongGenMusicProvider } from "../songGeneration.js";
import { newJobId, startJob, getJob, deleteJob, settleWithin, jobError } from "../asyncJobs.js";

export const START_WAIT_MS = 8_000;
export const POLL_WAIT_MS = 20_000;
export const START_JOB_PREFIX = "sjob";

export function expectedMusicKind(keys) {
  if (isAceStepMusicProvider(keys)) return "acestep";
  if (isSongGenMusicProvider(keys)) return "songgen";
  return "replicate";
}

export function isStartJobId(id) {
  return String(id || "").startsWith(`${START_JOB_PREFIX}_`);
}

const defaults = { startTrack, pollTrack, cancelTrack, startWaitMs: START_WAIT_MS, pollWaitMs: POLL_WAIT_MS };

export async function startTrackAsync(body, { owner = null, deps = {} } = {}) {
  const d = { ...defaults, ...deps };
  const id = newJobId(START_JOB_PREFIX);
  const job = startJob(id, () => d.startTrack(body), { owner });
  await settleWithin(job, d.startWaitMs);
  if (job.done) {
    if (job.error) throw jobError(job);
    // Démarrage rapide : réponse identique à l'ancien flux, le job reste pour un éventuel poll sjob.
    return job.result;
  }
  return {
    pollNeeded: true,
    pending: true,
    musicKind: expectedMusicKind(body?.keys),
    generationId: id,
    draft: null,
  };
}

function finishedStart(job) {
  const r = job.result || {};
  return r;
}

export async function pollTrackAsync(body, { owner = null, deps = {} } = {}) {
  const d = { ...defaults, ...deps };
  let generationId = String(body?.generationId || "").trim();
  let musicKind = body?.musicKind;
  let draft = body?.draft;
  if (isStartJobId(generationId)) {
    const sj = getJob(generationId, { owner });
    if (!sj) {
      const e = new Error("Génération introuvable (serveur redémarré ?) — relance le morceau.");
      e.status = 410;
      throw e;
    }
    if (!sj.done) {
      const elapsed = Math.round((Date.now() - sj.at) / 1000);
      return {
        done: false,
        status: "pending",
        progress: Math.min(20, 3 + Math.floor(elapsed / 6)),
        stage: "prepare",
        message: "Préparation (plan, timbre, référence, modèle ACE)…",
        elapsedSeconds: elapsed,
        estimatedSeconds: 0,
        generationId,
        musicKind: musicKind || null,
      };
    }
    if (sj.error) throw jobError(sj);
    const r = finishedStart(sj);
    if (!r.pollNeeded) {
      const { pollNeeded: _p, musicKind: _m, generationId: _g, draft: dr, ...rest } = r;
      return { done: true, track: dr && typeof dr === "object" ? { ...dr, ...rest } : rest };
    }
    generationId = r.generationId;
    musicKind = r.musicKind;
    draft = r.draft;
  }
  const key = `poll:${musicKind}:${generationId}`;
  const pj = startJob(key, () => d.pollTrack({ ...body, generationId, musicKind, draft }), { owner });
  await settleWithin(pj, d.pollWaitMs);
  if (!pj.done) {
    return {
      done: false,
      status: "processing",
      progress: 96,
      stage: "save",
      message: "Finalisation (contrôle / stockage audio)…",
      elapsedSeconds: Math.round((Date.now() - pj.at) / 1000),
      estimatedSeconds: 0,
      generationId,
      musicKind,
    };
  }
  deleteJob(key);
  if (pj.error) throw jobError(pj);
  return pj.result;
}

export async function cancelTrackAsync(body, { owner = null, deps = {} } = {}) {
  const d = { ...defaults, ...deps };
  const id = String(body?.generationId || "").trim();
  if (!isStartJobId(id)) return d.cancelTrack(body);
  const sj = getJob(id, { owner });
  if (!sj) return { ok: false, skipped: true };
  const cancelReal = () => {
    const r = sj.result;
    if (r?.pollNeeded && r.generationId) {
      return d.cancelTrack({ ...body, generationId: r.generationId, musicKind: r.musicKind });
    }
    return { ok: true, skipped: true };
  };
  if (sj.done) return sj.error ? { ok: true, skipped: true } : cancelReal();
  // Démarrage encore en cours : annule dès que l'ID ACE/Replicate est connu.
  void sj.promise.then(() => (sj.error ? null : cancelReal())).catch(() => null);
  return { ok: true, deferred: true };
}
