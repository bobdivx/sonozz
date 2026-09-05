/**
 * Étapes UX de génération audio (ACE / SongGen / cloud).
 * Les `phase` émises par trackPoll / trackJobs s’y mappent.
 */

export const TRACK_GEN_STEPS_ACE = [
  { id: "probe", label: "Studio", short: "Lien" },
  { id: "style", label: "Style IA", short: "Style" },
  { id: "gpu", label: "GPU / modèle", short: "GPU" },
  { id: "generating", label: "Génération", short: "Audio" },
  { id: "saving", label: "Sauvegarde", short: "Save" },
];

export const TRACK_GEN_STEPS_SONGGEN = [
  { id: "probe", label: "Studio", short: "Lien" },
  { id: "gpu", label: "Modèle", short: "Modèle" },
  { id: "generating", label: "Génération", short: "Audio" },
  { id: "saving", label: "Sauvegarde", short: "Save" },
];

export const TRACK_GEN_STEPS_CLOUD = [
  { id: "starting", label: "Lancement", short: "Start" },
  { id: "generating", label: "Génération", short: "Audio" },
  { id: "saving", label: "Sauvegarde", short: "Save" },
];

const PHASE_TO_STEP = {
  probe: "probe",
  starting: "probe",
  style: "style",
  "gpu-queue": "gpu",
  "loading-model": "gpu",
  gpu: "gpu",
  generating: "generating",
  retry: "generating",
  running: "generating",
  saving: "saving",
  persist: "saving",
  done: "saving",
};

/**
 * @param {{ phase?: string, musicKind?: string, percent?: number } | null} progress
 */
export function resolveTrackGenSteps(progress) {
  const kind = String(progress?.musicKind || "").toLowerCase();
  if (kind === "songgen") return TRACK_GEN_STEPS_SONGGEN;
  if (kind === "acestep" || kind === "ace") return TRACK_GEN_STEPS_ACE;
  // Heuristique : si on a déjà vu des phases ACE côté client
  const phase = String(progress?.phase || "").toLowerCase();
  if (phase === "style" || phase === "gpu-queue" || phase === "loading-model" || phase === "probe") {
    return TRACK_GEN_STEPS_ACE;
  }
  if (kind === "minimax" || kind === "replicate") return TRACK_GEN_STEPS_CLOUD;
  return TRACK_GEN_STEPS_ACE;
}

/**
 * Index de l’étape active (0-based). Terminé → dernier index.
 * @returns {{ steps: object[], activeIndex: number, done: boolean }}
 */
export function resolveTrackGenStepState(progress) {
  const steps = resolveTrackGenSteps(progress);
  const phase = String(progress?.phase || "").toLowerCase();
  const percent = Number(progress?.percent);
  const done =
    phase === "done" ||
    (Number.isFinite(percent) && percent >= 100);

  if (done) {
    return { steps, activeIndex: steps.length - 1, done: true };
  }

  const stepId = PHASE_TO_STEP[phase] || null;
  let activeIndex = stepId ? steps.findIndex((s) => s.id === stepId) : -1;

  if (activeIndex < 0 && Number.isFinite(percent)) {
    if (percent < 8) activeIndex = 0;
    else if (percent < 18) activeIndex = Math.min(1, steps.length - 1);
    else if (percent < 25) activeIndex = Math.min(2, steps.length - 1);
    else if (percent < 90) activeIndex = Math.min(steps.length - 2, steps.length - 1);
    else activeIndex = steps.length - 1;
  }

  if (activeIndex < 0) activeIndex = 0;
  return { steps, activeIndex, done: false };
}
