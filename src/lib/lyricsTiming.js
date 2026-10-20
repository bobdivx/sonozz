/**
 * Durée chantée estimée d'un texte de paroles → durée ACE proportionnée (pas de longue fin vide).
 *
 * Calibrage (« Station Essence Minuit », 20/10) : 223 syllabes / 7 sections chantées en ~100 s
 * sur 173 s demandées → ~2,2 syllabes/s + ~4 s de transition par section + intro/outro.
 */
export const SUNG_SYLLABLES_PER_SEC = 2.2;
export const SECTION_GAP_SEC = 4;
export const INTRO_OUTRO_SEC = 18;
/** Fin instrumentale tolérée au-delà de l'estimation. */
export const TAIL_TOLERANCE_SEC = 15;
/** Contrôle : fin vide maximale acceptable. */
export const MAX_EMPTY_TAIL_SEC = 40;

const VOWELS = /[aeiouyàâäéèêëîïôöûùüÿœæ]+/gi;

export function countSyllables(word) {
  const m = String(word || "").match(VOWELS);
  return m ? m.length : 0;
}

/** Lignes chantées (sans tags [..], sans didascalies seules entre parenthèses). */
export function sungLines(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^\[.*\]$/.test(l) && !/^\(.*\)$/.test(l));
}

export function estimateLyricsTiming(text) {
  const lines = sungLines(text);
  let syllables = 0;
  for (const l of lines) for (const w of l.match(/[\p{L}']+/gu) || []) syllables += Math.max(1, countSyllables(w));
  const sections = (String(text || "").match(/^\[(?!singer\b)[^\]]+\]/gim) || []).length;
  const sungSec = syllables / SUNG_SYLLABLES_PER_SEC;
  const estimatedSec = Math.round(sungSec + sections * SECTION_GAP_SEC + INTRO_OUTRO_SEC);
  return { lines: lines.length, syllables, sections, sungSec: Math.round(sungSec), estimatedSec };
}

/**
 * Durée finale : explicite → plafonnée à l'estimation + tolérance ; sinon estimation bornée.
 * @returns {{ durationSec: number|null, estimatedSec: number, adjusted: boolean, emptyTailSec: number }}
 */
export function fitDurationToLyrics(text, { requestedSec = null, min = 60, max = 480 } = {}) {
  const t = estimateLyricsTiming(text);
  if (!t.lines) return { durationSec: requestedSec, estimatedSec: 0, adjusted: false, emptyTailSec: 0, timing: t };
  const target = Math.min(max, Math.max(min, t.estimatedSec + TAIL_TOLERANCE_SEC));
  const req = Number(requestedSec);
  let durationSec;
  if (Number.isFinite(req) && req > 0) durationSec = Math.min(Math.round(req), target);
  else durationSec = target;
  durationSec = Math.min(max, Math.max(min, durationSec));
  return {
    durationSec,
    estimatedSec: t.estimatedSec,
    adjusted: Number.isFinite(req) && req > 0 ? durationSec !== Math.round(req) : true,
    emptyTailSec: Math.max(0, durationSec - t.estimatedSec),
    timing: t,
  };
}

/** Contrôle paroles ↔ durée (avant génération). */
export function lyricsDurationCheck(text, durationSec) {
  const t = estimateLyricsTiming(text);
  const empty = Math.max(0, Number(durationSec || 0) - t.estimatedSec);
  return { ok: empty <= MAX_EMPTY_TAIL_SEC, emptyTailSec: Math.round(empty), estimatedSec: t.estimatedSec };
}
