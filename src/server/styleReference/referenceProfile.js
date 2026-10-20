/**
 * Profil qualité cible calculé À LA VOLÉE depuis l'extrait de référence quand l'artiste n'en a pas
 * en base (ex. référence posée à la main, comme Mantra sur Skarlvind). Rien n'est écrit en base :
 * cache mémoire par extrait (≈ 10–15 s la 1re fois par processus, 0 ensuite).
 */
const CACHE = new Map();
const MAX = 50;
const TIMEOUT_MS = 45000;

export async function referenceQualityProfile(styleRef, { duo = false, fetchImpl } = {}) {
  const url = String(styleRef?.url || "");
  if (!/^https?:\/\//i.test(url)) return null;
  const key = `${styleRef?.deezerTrackId || styleRef?.title || url.split("?")[0]}|${duo ? "duo" : "solo"}`;
  if (CACHE.has(key)) return CACHE.get(key);
  let q;
  try {
    q = await import("../quality/index.js");
    if (!(await q.qualityCheckAvailable())) return null;
  } catch {
    return null;
  }
  const job = (async () => {
    const analysis = await q.analyzeTake(url, { duo, nBlocks: 3, fetchImpl });
    return q.buildQualityProfile(analysis, { duo, source: styleRef?.title || null });
  })();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout profil référence")), TIMEOUT_MS).unref?.());
  try {
    const prof = await Promise.race([job, timeout]);
    if (prof) {
      if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(key, prof);
    }
    return prof || null;
  } catch (e) {
    console.warn("[qa] profil référence indisponible:", e?.message || e);
    return null;
  }
}
