/**
 * Compteur local des envois TikTok (limite API ~5 pending / 24 h).
 * Stocké dans localStorage — aligné sur le navigateur / compte qui publie.
 */

const STORAGE_KEY = "sonozz.tiktok.quota.v1";
export const TIKTOK_PENDING_LIMIT = 5;
export const TIKTOK_WINDOW_MS = 24 * 60 * 60 * 1000;

function readRaw() {
  if (typeof localStorage === "undefined") return { attempts: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: [] };
    const parsed = JSON.parse(raw);
    return { attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [] };
  } catch {
    return { attempts: [] };
  }
}

function writeRaw(data) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function prune(attempts = [], now = Date.now()) {
  return attempts.filter((a) => a?.at && now - a.at < TIKTOK_WINDOW_MS);
}

export function getTikTokQuota(now = Date.now()) {
  const attempts = prune(readRaw().attempts, now);
  // Persiste le prune
  writeRaw({ attempts });
  const used = attempts.length;
  const remaining = Math.max(0, TIKTOK_PENDING_LIMIT - used);
  const oldest = attempts[0]?.at || null;
  const resetsAt = oldest ? oldest + TIKTOK_WINDOW_MS : null;
  return {
    used,
    remaining,
    limit: TIKTOK_PENDING_LIMIT,
    attempts,
    resetsAt,
    blocked: remaining <= 0,
  };
}

/**
 * Enregistre un envoi TikTok (compte même si échec après init — TikTok peut quand même compter).
 */
export function recordTikTokAttempt({
  mode = "unknown",
  ok = false,
  status = "",
  publishId = "",
  message = "",
} = {}) {
  const now = Date.now();
  const attempts = prune(readRaw().attempts, now);
  attempts.push({
    at: now,
    mode,
    ok: Boolean(ok),
    status: String(status || ""),
    publishId: String(publishId || "").slice(0, 80),
    message: String(message || "").slice(0, 160),
  });
  writeRaw({ attempts });
  return getTikTokQuota(now);
}

/** Annule le dernier enregistrement (ex. erreur avant tout appel API). */
export function undoLastTikTokAttempt() {
  const attempts = prune(readRaw().attempts);
  attempts.pop();
  writeRaw({ attempts });
  return getTikTokQuota();
}

export function formatQuotaReset(resetsAt) {
  if (!resetsAt) return "";
  const ms = resetsAt - Date.now();
  if (ms <= 0) return "maintenant";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `dans ~${h} h ${m} min`;
  return `dans ~${m} min`;
}
