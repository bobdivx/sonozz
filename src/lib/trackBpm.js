/**
 * BPM d'un titre — une seule source de vérité, utilisée pour l'appel ACE ET la caption
 * (la caption est réalignée sur la valeur envoyée, cf. syncCaptionBpm).
 * Priorité : BPM du profil artiste (styleLock.bpm) → BPM de l'arrangement → tempo mesuré sur
 * l'extrait de référence (styleLock.qualityProfile.style.tempo ; mesure peu fiable, erreurs
 * d'octave possibles → dernier recours) → défaut du genre.
 */
const ok = (x) => Number.isFinite(Number(x)) && Number(x) >= 60 && Number(x) <= 200;

export function resolveTrackBpm({ styleLock = null, arrangeBpm = null, fallback = null } = {}) {
  if (ok(styleLock?.bpm)) return Math.round(Number(styleLock.bpm));
  if (ok(arrangeBpm)) return Math.round(Number(arrangeBpm));
  const measured = styleLock?.qualityProfile?.style?.tempo;
  if (ok(measured)) return Math.round(Number(measured));
  const f = typeof fallback === "function" ? fallback() : fallback;
  return ok(f) ? Math.round(Number(f)) : f ?? null;
}
