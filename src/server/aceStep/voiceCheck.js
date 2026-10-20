/**
 * Vérification auto de la voix d'homme (duos internes) — après génération ACE.
 *
 * La mesure (séparation de la voix + HNR Praat) se fait dans un petit worker Python
 * (tools/voice-check/server.py : demucs + parselmouth), à faire tourner à côté d'ACE (GPU)
 * ou sur n'importe quelle machine avec torch. Le conteneur Sonozz (node:22-slim) n'a ni
 * Python ni ffmpeg : il n'appelle que l'URL du worker.
 * Un proxy calculé sur le mix seul a été testé et rejeté (AUC 0.60–0.66 contre le HNR réel).
 *
 * Config : SONOZZ_VOICE_CHECK_URL (env serveur) ou keys.voiceCheckUrl. Absent -> pas de vérif.
 */

// Seuil sur l'échelle du WORKER (fenêtres de 3 s sur la piste voix demucs 2 stems).
// Calibrage box (oct. 2026) : prises rauques validées à l'oreille = 10.4–11.3 dB worker
// (≈ 6.5 dB analyse complète), prises trop propres = 13.7–18.6 dB. 10 dB « analyse complète »
// ≈ 12 dB worker. Surcharge : SONOZZ_VOICE_CHECK_HNR_MAX_DB.
const envMax = Number(typeof process !== "undefined" ? process.env?.SONOZZ_VOICE_CHECK_HNR_MAX_DB : NaN);
export const VOICE_CHECK_HNR_MAX_DB = Number.isFinite(envMax) && envMax > 0 ? envMax : 12;
export const VOICE_CHECK_MAX_RETRIES = 2;
export const VOICE_CHECK_MIN_MALE_SECONDS = 3;

export function voiceCheckEndpoint(keys, env = process.env) {
  const u = String(keys?.voiceCheckUrl || env?.SONOZZ_VOICE_CHECK_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return /^https?:\/\//i.test(u) ? u : "";
}

/** @returns {Promise<null | { maleHnr: number|null, maleSeconds: number }>} */
export async function measureMaleVoice(keys, audioUrl, { fetchImpl = fetch, env = process.env } = {}) {
  const base = voiceCheckEndpoint(keys, env);
  const url = String(audioUrl || "").trim();
  if (!base || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetchImpl(`${base}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioUrl: url, maxSeconds: 45 }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    const hnr = Number(j?.maleHnr);
    return {
      maleHnr: Number.isFinite(hnr) ? Math.round(hnr * 10) / 10 : null,
      maleSeconds: Number(j?.maleSeconds) || 0,
    };
  } catch (e) {
    console.warn("[voice-check] worker injoignable:", e?.message || e);
    return null;
  }
}

/** "clean" (relancer), "rough" (OK), "unknown" (pas de mesure fiable -> on garde). */
export function voiceCheckVerdict(m, maxDb = VOICE_CHECK_HNR_MAX_DB) {
  if (!m || m.maleHnr == null || m.maleSeconds < VOICE_CHECK_MIN_MALE_SECONDS) return "unknown";
  return m.maleHnr > maxDb ? "clean" : "rough";
}

/** Garde la prise la plus rauque (HNR le plus bas). */
export function pickRougherTake(a, b) {
  if (!a?.url) return b || null;
  if (!b?.url) return a;
  const ha = Number(a.hnr);
  const hb = Number(b.hnr);
  if (!Number.isFinite(ha)) return b;
  if (!Number.isFinite(hb)) return a;
  return hb < ha ? b : a;
}

const TAG = "ACE_VOICE_CLEAN";

export function voiceCleanError(attempt, take) {
  const best = JSON.stringify({ url: take?.url || "", hnr: take?.hnr ?? null });
  return new Error(
    `${TAG}: voix d'homme trop propre (HNR ${take?.hnr} dB > ${VOICE_CHECK_HNR_MAX_DB}) — nouvelle graine ${attempt}/${VOICE_CHECK_MAX_RETRIES} best=${best}`,
  );
}

export function parseVoiceCleanError(message) {
  const s = String(message || "");
  if (!s.includes(TAG)) return null;
  const m = s.match(/best=(\{.*\})\s*$/);
  if (!m) return { best: null };
  try {
    const j = JSON.parse(m[1]);
    return { best: j?.url ? { url: String(j.url), hnr: j.hnr == null ? null : Number(j.hnr) } : null };
  } catch {
    return { best: null };
  }
}
