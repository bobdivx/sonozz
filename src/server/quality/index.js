/**
 * Contrôle qualité intégré (aucun service externe) : analyse dans le process Sonozz
 * (ffmpeg de l'image + onnxruntime-node + modèle voix MDX embarqué), en tâche de fond
 * pour ne pas bloquer la requête de poll.
 */
import { analyzeTake, analyzeStyleQuick } from "./analyze.js";
import { hasFfmpeg } from "./decode.js";
import { scoreTake, buildQualityProfile, QA_RETRY_BELOW, qaMaxRetries, pickBestTake, qaRetryError, parseQaRetryError } from "./score.js";

export { analyzeTake, analyzeStyleQuick, scoreTake, buildQualityProfile, QA_RETRY_BELOW, qaMaxRetries, pickBestTake, qaRetryError, parseQaRetryError };

/** Désactivable : SONOZZ_QA=off. Activé par défaut si ffmpeg est dans l'image. */
export async function qualityCheckAvailable(env = process.env) {
  if (/^(0|off|false|no)$/i.test(String(env?.SONOZZ_QA || "").trim())) return false;
  return hasFfmpeg();
}

// Une analyse à la fois (CPU borné) + cache des résultats par génération.
let chain = Promise.resolve();
const jobs = new Map();
const JOB_TTL_MS = 20 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [k, j] of jobs) if (now - j.at > JOB_TTL_MS) jobs.delete(k);
}

/**
 * Lance (ou relit) l'analyse d'une prise. Renvoie { pending: true } tant que ce n'est pas fini,
 * puis { pending: false, result } (result = { analysis, verdict } ou { error }).
 */
export function qualityJob(key, src, { profile = null, duo = false, requestedSec = null, expectVocals = true, leadGender = null } = {}) {
  gc();
  let j = jobs.get(key);
  if (!j) {
    j = { at: Date.now(), done: false, result: null };
    jobs.set(key, j);
    const run = async () => {
      const full = Boolean(profile);
      // sans profil : défauts seulement → pas besoin de séparation complète, 1 bloc suffit pour la voix
      // duo : 4 blocs (une voix peut manquer sur 3 fenêtres de 6 s alors qu'elle chante ailleurs)
      const analysis = await analyzeTake(src, { duo, requestedSec, nBlocks: full ? (duo ? 4 : 3) : 1 });
      const verdict = scoreTake(analysis, profile, { duo, expectVocals, leadGender: duo ? null : leadGender });
      return { analysis, verdict };
    };
    chain = chain.then(run, run).then(
      (r) => { j.done = true; j.result = r; },
      (e) => { j.done = true; j.result = { error: String(e?.message || e) }; },
    );
  }
  return j.done ? { pending: false, result: j.result } : { pending: true, sinceMs: Date.now() - j.at };
}

export function forgetQualityJob(key) {
  jobs.delete(key);
}

/** Vue compacte stockée sur le track (debug + affichage discret). */
export function qualitySummary(result, { retry = 0, keptPrevious = false, threshold = QA_RETRY_BELOW } = {}) {
  if (!result || result.error) return { status: "error", error: result?.error || "inconnu", retry };
  const { analysis, verdict } = result;
  return {
    status: verdict?.score == null ? "skipped" : verdict.score >= threshold ? "ok" : "low",
    score: verdict?.score ?? null,
    threshold,
    withProfile: Boolean(verdict?.profile),
    parts: verdict?.parts || {},
    defects: verdict?.defects || [],
    retry,
    keptPrevious: keptPrevious || undefined,
    measures: analysis?.ok
      ? { voice: analysis.voice, style: analysis.style, defects: analysis.defects, ms: analysis.ms }
      : { reason: analysis?.reason || null },
  };
}
