/**
 * Session lecteur Play — survit à la navigation (localStorage + BroadcastChannel).
 */

export const PLAY_STORAGE_KEY = "sonozz-play-v1";
const CHANNEL = "sonozz-play";
const MAX_QUEUE = 200;

/** @typedef {{ id: string, trackTitle?: string, artistName?: string, audioUrl?: string, audioS3Key?: string, coverUrl?: string, artistImage?: string, slug?: string }} PlayTrack */

function lightUrl(url) {
  if (typeof url !== "string") return "";
  const u = url.trim();
  if (!u) return "";
  if (u.startsWith("data:") && u.length > 12_000) return "";
  return u;
}

export function slimPlayTrack(track = {}) {
  if (!track || typeof track !== "object") return null;
  const id = String(track.id || "").trim();
  const audioUrl = typeof track.audioUrl === "string" ? track.audioUrl : "";
  const audioS3Key = typeof track.audioS3Key === "string" ? track.audioS3Key : "";
  if (!id || (!audioUrl && !audioS3Key)) return null;
  return {
    id,
    trackTitle: String(track.trackTitle || track.title || "Sans titre").slice(0, 200),
    artistName: String(track.artistName || "").slice(0, 120),
    audioUrl,
    audioS3Key,
    coverUrl: lightUrl(track.coverUrl),
    artistImage: lightUrl(track.artistImage),
    slug: String(track.slug || "").slice(0, 80),
  };
}

export function emptyPlaySession() {
  return {
    queue: [],
    index: 0,
    playing: false,
    shuffle: false,
    repeat: "off",
    currentTime: 0,
    updatedAt: 0,
  };
}

function readRaw() {
  try {
    const raw = localStorage.getItem(PLAY_STORAGE_KEY);
    if (!raw) return emptyPlaySession();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyPlaySession();
    const queue = Array.isArray(parsed.queue)
      ? parsed.queue.map(slimPlayTrack).filter(Boolean).slice(0, MAX_QUEUE)
      : [];
    const index = Math.min(Math.max(0, Number(parsed.index) || 0), Math.max(0, queue.length - 1));
    const repeat = parsed.repeat === "all" || parsed.repeat === "one" ? parsed.repeat : "off";
    return {
      queue,
      index: queue.length ? index : 0,
      playing: Boolean(parsed.playing) && queue.length > 0,
      shuffle: Boolean(parsed.shuffle),
      repeat,
      currentTime: Math.max(0, Number(parsed.currentTime) || 0),
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return emptyPlaySession();
  }
}

export function readPlaySession() {
  if (typeof localStorage === "undefined") return emptyPlaySession();
  return readRaw();
}

function emit(session) {
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage({ type: "play", session });
    bc.close();
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent("sonozz-play", { detail: session }));
  } catch {
    /* ignore */
  }
}

export function writePlaySession(patch = {}, { emitEvent = true } = {}) {
  if (typeof localStorage === "undefined") return emptyPlaySession();
  const prev = readRaw();
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  if (Array.isArray(patch.queue)) {
    next.queue = patch.queue.map(slimPlayTrack).filter(Boolean).slice(0, MAX_QUEUE);
  }
  if (next.queue.length) {
    next.index = Math.min(Math.max(0, Number(next.index) || 0), next.queue.length - 1);
  } else {
    next.index = 0;
    next.playing = false;
    next.currentTime = 0;
  }
  localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify(next));
  if (emitEvent) emit(next);
  return next;
}

export function clearPlaySession() {
  return writePlaySession(emptyPlaySession());
}

export function currentPlayTrack(session = readPlaySession()) {
  return session.queue[session.index] || null;
}

/**
 * Prochain index, ou -1 si la lecture s’arrête.
 */
export function nextPlayIndex({ index, queueLen, repeat } = {}) {
  const i = Number(index) || 0;
  const len = Number(queueLen) || 0;
  if (len <= 0) return -1;
  if (repeat === "one") return i;
  if (i < len - 1) return i + 1;
  if (repeat === "all") return 0;
  return -1;
}

export function prevPlayIndex({ index, queueLen, repeat, currentTime } = {}) {
  const i = Number(index) || 0;
  const len = Number(queueLen) || 0;
  if (len <= 0) return -1;
  if ((Number(currentTime) || 0) > 3) return i;
  if (i > 0) return i - 1;
  if (repeat === "all") return len - 1;
  return i;
}

export function subscribePlaySession(cb) {
  const emitNow = () => cb(readPlaySession());
  emitNow();
  let bc;
  try {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = () => emitNow();
  } catch {
    /* ignore */
  }
  const onStorage = (e) => {
    if (e.key === PLAY_STORAGE_KEY) emitNow();
  };
  const onCustom = () => emitNow();
  window.addEventListener("storage", onStorage);
  window.addEventListener("sonozz-play", onCustom);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("sonozz-play", onCustom);
    try {
      bc?.close();
    } catch {
      /* ignore */
    }
  };
}

export function setPlayExpanded(expanded) {
  if (typeof document === "undefined") return;
  if (expanded) document.documentElement.dataset.playExpanded = "1";
  else delete document.documentElement.dataset.playExpanded;
  window.dispatchEvent(new CustomEvent("sonozz-play-expanded", { detail: Boolean(expanded) }));
}

/** Overlay plein écran /play uniquement — jamais hors de cette page. */
export function isPlayOverlayOpen() {
  if (typeof document === "undefined" || typeof location === "undefined") return false;
  return location.pathname === "/play" && document.documentElement.dataset.playExpanded === "1";
}
