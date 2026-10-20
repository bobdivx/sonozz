/**
 * Jobs en mémoire (process unique) : aucune étape lente ne doit tenir une requête HTTP
 * au-delà de quelques secondes (proxy / tunnel Cloudflare ~100 s → 499 / 502 / 524).
 * La requête attend au plus `waitMs`, puis répond « pending » ; le client poll.
 */
import { randomUUID } from "node:crypto";

const JOBS = new Map();
const TTL_MS = 45 * 60_000;

function gc(now = Date.now()) {
  for (const [id, j] of JOBS) {
    if (now - j.at > TTL_MS) JOBS.delete(id);
  }
}

export function newJobId(prefix = "job") {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

/** Lance `fn` en tâche de fond (single-flight par id). */
export function startJob(id, fn, { owner = null } = {}) {
  gc();
  const existing = JOBS.get(id);
  if (existing) return existing;
  const job = { id, owner: owner || null, at: Date.now(), done: false, result: null, error: null };
  job.promise = Promise.resolve()
    .then(fn)
    .then(
      (r) => {
        job.done = true;
        job.result = r;
      },
      (e) => {
        job.done = true;
        job.error = {
          message: String(e?.message || e || "Erreur"),
          status: e?.status || (e?.code === "CREDITS" ? 402 : 500),
        };
      },
    );
  JOBS.set(id, job);
  return job;
}

export function getJob(id, { owner = null } = {}) {
  const job = JOBS.get(String(id || ""));
  if (!job) return null;
  if (job.owner && owner && job.owner !== owner) return null;
  return job;
}

export function deleteJob(id) {
  JOBS.delete(String(id || ""));
}

/** Attend la fin du job au plus `ms` (ne rejette jamais). */
export async function settleWithin(job, ms) {
  if (!job || job.done) return job;
  let t;
  await Promise.race([job.promise, new Promise((r) => (t = setTimeout(r, Math.max(0, ms))))]);
  clearTimeout(t);
  return job;
}

export function jobError(job) {
  const e = new Error(job?.error?.message || "Erreur");
  e.status = job?.error?.status || 500;
  return e;
}

export function _jobsSize() {
  return JOBS.size;
}
