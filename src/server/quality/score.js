/**
 * Profil cible + score d'une prise (0–100). Pur calcul, testable sans audio.
 *
 * Profil = mesures de l'extrait de référence (même code d'analyse) — calculé une fois et stocké
 * dans styleLock.qualityProfile. Chaque critère donne 0..1 ; défauts = pénalités multiplicatives.
 */

export const QA_PROFILE_VERSION = 1;
export const QA_MAX_RETRIES = 2;
export const QA_MAX_RETRIES_PREVIEW = 1;
/** Sous ce score → nouvelle graine (calibré sur les extraits de la box, voir PROGRESS.md). */
export const QA_RETRY_BELOW = 66;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const gauss = (d) => Math.exp(-0.5 * d * d);
const num = (x) => (x == null || x === "" ? NaN : Number(x));
const fin = (x) => Number.isFinite(num(x));

/** Écart absolu normalisé par une tolérance. */
const absScore = (x, t, tol) => (fin(x) && fin(t) ? gauss((num(x) - num(t)) / tol) : null);
/** Écart en log (rapport) ; tolRatio = 1.8 → ×1.8 = 1 sigma. */
const logScore = (x, t, tolRatio) =>
  fin(x) && fin(t) && num(x) > 0 && num(t) > 0 ? gauss(Math.log(num(x) / num(t)) / Math.log(tolRatio)) : null;
/** Asymétrique : écart au-dessus de la cible (tolUp) / en dessous (tolDown). */
const asymScore = (x, t, tolUp, tolDown) => {
  if (!fin(x) || !fin(t)) return null;
  const d = num(x) - num(t);
  return gauss(d / (d > 0 ? tolUp : tolDown));
};
/** Tempo : tolère le double / la moitié (détection d'octave). */
const tempoScore = (x, t) => {
  if (!fin(x) || !fin(t) || num(x) <= 0 || num(t) <= 0) return null;
  const r = Math.log2(num(x) / num(t));
  const folded = Math.abs(r - Math.round(r));
  return gauss(folded / 0.08);
};

/** Profil cible stockable (petit JSON) depuis une analyse de la référence. */
export function buildQualityProfile(analysis, { duo = false, source = null } = {}) {
  if (!analysis?.ok) return null;
  const v = analysis.voice || {};
  const s = analysis.style || {};
  return {
    version: QA_PROFILE_VERSION,
    duo: Boolean(duo),
    source: source || undefined,
    computedAt: new Date().toISOString(),
    style: {
      drumShare: s.drumShare, subShare: s.subShare, melodicShare: s.melodicShare,
      kickPerSec: s.kickPerSec, hatPerSec: s.hatPerSec, brightnessHz: s.brightnessHz,
      distortion: s.distortion, tempo: s.tempo, vocalEnergyShare: s.vocalEnergyShare,
    },
    voice: duo
      ? { voicedShare: v.voicedShare, maleShare: v.maleShare, maleF0: v.maleF0, maleHnr: v.maleHnr, femaleF0: v.femaleF0, femaleHnr: v.femaleHnr }
      : { voicedShare: v.voicedShare, f0: v.f0, hnr: v.hnr, maleShare: v.maleShare },
  };
}

export const QA_WEIGHTS = {
  // voix
  presence: 0.1, grain: 0.18, balance: 0.1, pitch: 0.12,
  // style / mix
  drumShare: 0.12, subShare: 0.08, melodicShare: 0.1, distortion: 0.07, brightness: 0.06,
  // kick : mesure non fiable (Spearman < 0 vs stem batterie) → affichée, non notée
  hatPerSec: 0.06, kickPerSec: 0, tempo: 0.03,
};

/** Écart en demi-tons au-delà duquel une voix plus GRAVE que la cible est un défaut. */
export const REGISTER_LOW_SEMITONES = 7;

/** Registre mesuré vs cible (F0 médian, Hz). */
export function registerCheck(f0, target) {
  if (!fin(f0) || !fin(target) || num(f0) <= 0 || num(target) <= 0) return null;
  const semitones = Math.round(12 * Math.log2(num(f0) / num(target)) * 10) / 10;
  return { f0: num(f0), target: num(target), semitones };
}

/** Plus grave que la cible : pénalisé ~2× plus vite que plus aigu (ACE dérive vers le baryton). */
export function registerScore(f0, target) {
  const r = registerCheck(f0, target);
  if (!r) return null;
  return r.semitones < 0 ? gauss(r.semitones / 3) : gauss(r.semitones / 5);
}

/** Défauts évidents (indépendants du profil). Renvoie { factor, list }. */
export function defectPenalty(analysis, { expectVocals = true } = {}) {
  const d = analysis?.defects || {};
  const s = analysis?.style || {};
  const v = analysis?.voice || {};
  const list = [];
  let f = 1;
  if (num(d.silentShare) > 0.25) { f *= 0.4; list.push("silence"); }
  else if (num(d.midGapSec) > 2.5) { f *= 0.6; list.push("trou de silence"); }
  if (num(d.clipShare) > 0.002) { f *= 0.6; list.push("saturation numérique"); }
  if (d.cut) { f *= 0.55; list.push("prise coupée"); }
  if (expectVocals && d.tailNoVocals) { f *= 0.85; list.push("longue fin sans voix (≈ 40 s)"); }
  if (expectVocals && analysis?.style && (num(s.vocalEnergyShare) < 0.04 || num(v.voicedShare) < 0.12)) {
    f *= 0.35; list.push("voix absente");
  }
  return { factor: f, list };
}

/**
 * Score d'une prise vs profil. Sans profil : défauts seulement (score 100 × facteur).
 * @returns {{ score: number, parts: object, defects: string[], profile: boolean }}
 */
export function scoreTake(analysis, profile, { duo = false, expectVocals = true, leadGender = null } = {}) {
  const pen = defectPenalty(analysis, { expectVocals });
  if (!analysis?.ok) return { score: null, parts: {}, defects: [], profile: Boolean(profile) };
  if (!profile) {
    return { score: Math.round(100 * pen.factor), parts: {}, defects: pen.list, profile: false };
  }
  const s = analysis.style || {};
  const v = analysis.voice || {};
  const ps = profile.style || {};
  const pv = profile.voice || {};
  const isDuo = Boolean(duo || profile.duo);
  const parts = {};
  parts.presence = fin(s.vocalEnergyShare) && fin(ps.vocalEnergyShare)
    ? clamp01(logScore(s.vocalEnergyShare, ps.vocalEnergyShare, 2.0))
    : null;
  if (isDuo) {
    // grain : une voix d'homme PLUS PROPRE que la cible est pénalisée fort, plus rauque peu
    parts.grain = asymScore(v.maleHnr, pv.maleHnr, 2.5, 6);
    // duo Sonozz : les DEUX voix doivent s'entendre (la répartition de la référence n'est pas imposée)
    if (fin(v.maleShare)) {
      const ms = num(v.maleShare);
      parts.balance = ms < 0.2 ? gauss((0.2 - ms) / 0.1) : ms > 0.8 ? gauss((ms - 0.8) / 0.1) : 1;
    } else parts.balance = null;
    parts.pitch = registerScore(v.maleF0, pv.maleF0);
  } else {
    parts.grain = absScore(v.hnr, pv.hnr, 3.5);
    // voix seule : bon genre de voix (cible = genre du chanteur, sinon celui de la référence)
    const target = leadGender === "male" ? 0.9 : leadGender === "female" ? 0.1 : fin(pv.maleShare) ? (num(pv.maleShare) >= 0.5 ? 0.9 : 0.1) : null;
    parts.balance = target != null && fin(v.maleShare) ? gauss(Math.max(0, Math.abs(num(v.maleShare) - target) - 0.1) / 0.3) : null;
    parts.pitch = registerScore(v.f0, pv.f0);
  }
  parts.drumShare = absScore(s.drumShare, ps.drumShare, 0.08);
  // sous-basse : tolérance large (mastering ACE plus léger que les masters du commerce)
  parts.subShare = logScore(s.subShare, ps.subShare, 2.5);
  parts.melodicShare = absScore(s.melodicShare, ps.melodicShare, 0.1);
  // metal / guitare saturée : seulement au-dessus de la cible
  parts.distortion = fin(s.distortion) && fin(ps.distortion)
    ? s.distortion <= ps.distortion ? 1 : logScore(s.distortion, ps.distortion, 1.6)
    : null;
  parts.brightness = logScore(s.brightnessHz, ps.brightnessHz, 1.35);
  parts.hatPerSec = absScore(s.hatPerSec, ps.hatPerSec, 1.5);
  parts.kickPerSec = absScore(s.kickPerSec, ps.kickPerSec, 1.2);
  parts.tempo = tempoScore(s.tempo, ps.tempo);
  let wsum = 0;
  let acc = 0;
  for (const [k, w] of Object.entries(QA_WEIGHTS)) {
    const x = parts[k];
    if (x == null || !Number.isFinite(x)) continue;
    acc += w * x;
    wsum += w;
  }
  let base = wsum > 0 ? acc / wsum : 1;
  // Registre : voix nettement plus grave que la cible (prod 20/10 : ♂ 128 Hz pour une cible ≈ 298 Hz).
  const reg = registerCheck(isDuo ? v.maleF0 : v.f0, isDuo ? pv.maleF0 : pv.f0);
  const defects = [...pen.list];
  if (reg && reg.semitones < -REGISTER_LOW_SEMITONES) {
    base *= 0.8;
    defects.push(`registre trop grave (${isDuo ? "♂ " : ""}${Math.round(reg.f0)} Hz vs cible ${Math.round(reg.target)} Hz)`);
  }
  for (const k of Object.keys(parts)) if (parts[k] != null) parts[k] = Math.round(parts[k] * 100) / 100;
  return { score: Math.round(100 * base * pen.factor), parts, defects, profile: true, ...(reg ? { register: reg } : {}) };
}

/** Garde la meilleure prise ({url, score}). */
export function pickBestTake(a, b) {
  const sa = num(a?.score);
  const sb = num(b?.score);
  if (!a?.url) return b?.url ? b : null;
  if (!b?.url) return a;
  if (!Number.isFinite(sb)) return a;
  if (!Number.isFinite(sa)) return b;
  return sb > sa ? b : a;
}

export function qaMaxRetries({ preview = false } = {}) {
  return preview ? QA_MAX_RETRIES_PREVIEW : QA_MAX_RETRIES;
}

/** Erreur transportant la meilleure prise jusqu'au client (relance avec une autre graine). */
export function qaRetryError(attempt, best, score) {
  const max = QA_MAX_RETRIES;
  const e = new Error(
    `ACE_QA_RETRY: prise sous le seuil (score ${score ?? "?"} < ${QA_RETRY_BELOW}) — nouvelle graine ${attempt}/${max} best=${JSON.stringify(best || null)}`,
  );
  e.code = "ACE_QA_RETRY";
  return e;
}

export function parseQaRetryError(msg) {
  const m = String(msg || "").match(/best=(\{.*\}|null)\s*$/);
  let best = null;
  try {
    best = m ? JSON.parse(m[1]) : null;
  } catch {
    best = null;
  }
  return { best: best?.url ? best : null };
}
