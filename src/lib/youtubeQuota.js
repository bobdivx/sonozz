/**
 * Compteur local soft pour uploads YouTube (quota Data API ≈ 6 × 1600 = 9600 / jour).
 */

const STORAGE_KEY = "sonozz.youtube.quota.v1";
export const YOUTUBE_DAILY_LIMIT = 6;

function dayKey(d = new Date()) {
  // Reset aligné minuit Pacific (approx. UTC-8)
  const pt = new Date(d.getTime() - 8 * 3600_000);
  return pt.toISOString().slice(0, 10);
}

function loadRaw() {
  if (typeof localStorage === "undefined") return { day: dayKey(), used: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (raw.day !== dayKey()) return { day: dayKey(), used: 0 };
    return { day: raw.day, used: Number(raw.used) || 0 };
  } catch {
    return { day: dayKey(), used: 0 };
  }
}

function saveRaw(data) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function nextResetIso() {
  const now = new Date();
  const ptMs = now.getTime() - 8 * 3600_000;
  const pt = new Date(ptMs);
  const nextPt = new Date(Date.UTC(pt.getUTCFullYear(), pt.getUTCMonth(), pt.getUTCDate() + 1));
  return new Date(nextPt.getTime() + 8 * 3600_000).toISOString();
}

export function getYouTubeQuota() {
  const { used } = loadRaw();
  const remaining = Math.max(0, YOUTUBE_DAILY_LIMIT - used);
  return {
    used,
    limit: YOUTUBE_DAILY_LIMIT,
    remaining,
    blocked: remaining <= 0,
    resetsAt: nextResetIso(),
  };
}

/** Incrémente après chaque tentative d’upload non skippée. */
export function recordYouTubeAttempt() {
  const raw = loadRaw();
  raw.day = dayKey();
  raw.used = Math.min(YOUTUBE_DAILY_LIMIT, (raw.used || 0) + 1);
  saveRaw(raw);
  return getYouTubeQuota();
}

export function formatYouTubeQuotaReset(iso) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "";
  }
}
