/**
 * Jobs longs persistés (localStorage) — survivent à la navigation MPA Astro.
 * Les opérations Veo/Seedance/Wan2GP continuent côté provider ; on reprend le poll au chargement.
 * Les jobs step/pipeline/publish sont liés au HTTP de la page (interrompus à la navigation).
 * Les jobs album / track / veo / seedance / wan2gp reprennent au chargement suivant.
 */

const STORAGE_KEY = "sonozz-jobs-v1";
const CHANNEL = "sonozz-jobs";
const MAX_JOBS = 20;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** @typedef {'running'|'done'|'error'|'interrupted'} JobStatus */
/** @typedef {'veo'|'seedance'|'wan2gp'|'pipeline'|'step'|'publish'|'album'|'track'} JobType */

function uid(prefix = "job") {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
  } catch {
    return `${prefix}_${Date.now().toString(36)}`;
  }
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(jobs) {
  const trimmed = jobs
    .filter((j) => j && j.id)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, MAX_JOBS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: "jobs", jobs: trimmed });
    bc.close();
  } catch {
    /* BroadcastChannel indisponible */
  }
  window.dispatchEvent(new CustomEvent("sonozz-jobs", { detail: trimmed }));
}

function prune(jobs) {
  const now = Date.now();
  return jobs.filter((j) => {
    if (!j?.updatedAt) return true;
    if (j.status === "running") return true;
    return now - j.updatedAt < MAX_AGE_MS;
  });
}

export function listJobs() {
  return prune(readAll());
}

export function getJob(id) {
  return listJobs().find((j) => j.id === id) || null;
}

export function listActiveJobs() {
  return listJobs().filter((j) => j.status === "running");
}

export function upsertJob( partial ) {
  const jobs = prune(readAll());
  const now = Date.now();
  const idx = jobs.findIndex((j) => j.id === partial.id);
  let next;
  if (idx >= 0) {
    next = { ...jobs[idx], ...partial, updatedAt: now };
    jobs[idx] = next;
  } else {
    next = {
      id: partial.id || uid(),
      type: partial.type || "veo",
      status: "running",
      progress: 0,
      message: "",
      label: partial.label || "Tâche",
      createdAt: now,
      ...partial,
      updatedAt: now,
    };
    jobs.unshift(next);
  }
  writeAll(jobs);
  return next;
}

export function patchJob(id, patch) {
  return upsertJob({ id, ...patch });
}

export function removeJob(id) {
  writeAll(readAll().filter((j) => j.id !== id));
}

export function clearFinishedJobs() {
  writeAll(readAll().filter((j) => j.status === "running"));
}

/** Abonnement multi-onglet / même page. */
export function subscribeJobs(cb) {
  const emit = () => cb(listJobs());
  emit();

  let bc;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = () => emit();
  } catch {
    /* ignore */
  }

  const onStorage = (e) => {
    if (e.key === STORAGE_KEY) emit();
  };
  const onCustom = () => emit();
  window.addEventListener("storage", onStorage);
  window.addEventListener("sonozz-jobs", onCustom);

  const timer = setInterval(emit, 4000);

  return () => {
    clearInterval(timer);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("sonozz-jobs", onCustom);
    try {
      bc?.close();
    } catch {
      /* ignore */
    }
  };
}

export { uid as createJobId };
