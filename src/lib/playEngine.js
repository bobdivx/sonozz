/**
 * Moteur audio Play — un seul élément Audio, file + session.
 * La barre pied de page et /play partagent cette instance.
 */

import { playableAudioSrc } from "./audioResolve.js";
import {
  currentPlayTrack,
  nextPlayIndex,
  prevPlayIndex,
  readPlaySession,
  slimPlayTrack,
  writePlaySession,
} from "./playSession.js";

/** @type {HTMLAudioElement | null} */
let audio = null;
let timeWriteAt = 0;
let ignorePause = false;
let wantPlay = false;
let loadToken = 0;
let lastEndedAt = 0;
/** Ids déjà en échec pendant cette file — évite de boucler sur un fichier mort. */
const failedIds = new Set();

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function syncMediaPlayback(playing) {
  try {
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  } catch {
    /* ignore */
  }
}

function bind(el) {
  el.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - timeWriteAt < 2000) return;
    timeWriteAt = now;
    writePlaySession({ currentTime: el.currentTime || 0 }, { emitEvent: false });
  });
  el.addEventListener("ended", () => {
    const now = Date.now();
    if (ignorePause || now - lastEndedAt < 400) return;
    lastEndedAt = now;
    failedIds.delete(el.dataset.trackId || "");
    skipTrack(1);
  });
  el.addEventListener("playing", () => {
    wantPlay = false;
    ignorePause = false;
    failedIds.clear();
    syncMediaPlayback(true);
    writePlaySession({ playing: true });
  });
  el.addEventListener("pause", () => {
    if (el.ended || wantPlay || ignorePause) return;
    syncMediaPlayback(false);
    writePlaySession({
      playing: false,
      currentTime: el.currentTime || 0,
    });
  });
  el.addEventListener("error", () => {
    const code = el.error?.code || 0;
    // 1 = abort, typique quand on change de src.
    if (code === 1 || (ignorePause && code === 0)) return;
    const failedId = el.dataset.trackId || "";
    if (failedId) failedIds.add(failedId);
    if (!skipFailedTrack(failedId)) {
      ignorePause = false;
      syncMediaPlayback(false);
      writePlaySession({ playing: false });
    }
  });
}

function skipFailedTrack(failedId) {
  const session = readPlaySession();
  if (!session.queue.length) return false;
  let idx = session.index;
  for (let n = 0; n < session.queue.length; n++) {
    idx = nextPlayIndex({
      index: idx,
      queueLen: session.queue.length,
      repeat: session.repeat === "one" ? "all" : session.repeat,
    });
    if (idx < 0) return false;
    const candidate = session.queue[idx];
    if (!candidate || candidate.id === failedId || failedIds.has(candidate.id)) continue;
    writePlaySession({ index: idx, playing: true, currentTime: 0 });
    loadTrack(candidate, { time: 0, play: true });
    return true;
  }
  return false;
}

export function getPlayAudio() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio();
    audio.preload = "metadata";
    bind(audio);
  }
  return audio;
}

function srcFor(track) {
  if (!track) return "";
  return playableAudioSrc(track.audioUrl, track.audioS3Key);
}

function loadTrack(track, { time = 0, play = false } = {}) {
  const el = getPlayAudio();
  if (!el || !track) return;
  const src = srcFor(track);
  if (!src) {
    failedIds.add(track.id);
    if (!skipFailedTrack(track.id)) writePlaySession({ playing: false });
    return;
  }

  const same = el.dataset.trackId === track.id && Boolean(el.getAttribute("src"));
  if (!same) {
    const token = ++loadToken;
    ignorePause = true;
    el.dataset.trackId = track.id;
    const apply = () => {
      if (token !== loadToken) return;
      if (time > 0.4 && Number.isFinite(el.duration) && time < el.duration) {
        try {
          el.currentTime = time;
        } catch {
          /* ignore */
        }
      }
      if (!play) {
        wantPlay = false;
        ignorePause = false;
        return;
      }
      wantPlay = true;
      el.play().catch(() => {
        if (token !== loadToken) return;
        wantPlay = false;
        ignorePause = false;
        writePlaySession({ playing: false });
      });
    };
    // readyState peut encore décrire l’ancien morceau : attendre le nouveau.
    el.addEventListener("loadedmetadata", apply, { once: true });
    el.src = src;
    return;
  }

  if (play) {
    if (el.ended) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    el.play().catch(() => writePlaySession({ playing: false }));
  } else el.pause();
}

export function bootPlayEngine() {
  const el = getPlayAudio();
  const session = readPlaySession();
  const track = currentPlayTrack(session);
  if (!el || !track) return;
  loadTrack(track, {
    time: session.currentTime || 0,
    play: Boolean(session.playing),
  });
}

export function startPlayback({
  queue = [],
  index = 0,
  shuffle = false,
  repeat,
  play = true,
} = {}) {
  const slim = queue.map(slimPlayTrack).filter(Boolean);
  if (!slim.length) return;
  failedIds.clear();
  const i = Math.min(Math.max(0, index), slim.length - 1);
  const session = writePlaySession({
    queue: slim,
    index: i,
    playing: Boolean(play),
    shuffle: Boolean(shuffle),
    ...(repeat === "all" || repeat === "one" || repeat === "off" ? { repeat } : {}),
    currentTime: 0,
  });
  loadTrack(session.queue[session.index], { time: 0, play: Boolean(play) });
}

/**
 * Lance une file dans le lecteur pied de page, sans quitter la page.
 * Si le titre demandé joue déjà, bascule pause / lecture.
 */
export function playTracks(tracks = [], startId = null) {
  const queue = tracks.map(slimPlayTrack).filter(Boolean);
  if (!queue.length) return false;
  let index = 0;
  if (startId) {
    const found = queue.findIndex((t) => t.id === String(startId));
    if (found >= 0) index = found;
  }
  const session = readPlaySession();
  const current = currentPlayTrack(session);
  if (current?.id === queue[index].id) {
    togglePlay();
    return true;
  }
  startPlayback({
    queue,
    index,
    shuffle: Boolean(session.shuffle),
    repeat: session.repeat,
    play: true,
  });
  return true;
}

export function playCurrent() {
  const session = writePlaySession({ playing: true });
  const track = currentPlayTrack(session);
  loadTrack(track, { time: getPlayAudio()?.currentTime || session.currentTime || 0, play: true });
}

export function pauseCurrent() {
  wantPlay = false;
  ignorePause = false;
  getPlayAudio()?.pause();
}

export function togglePlay() {
  const el = getPlayAudio();
  const session = readPlaySession();
  if (!currentPlayTrack(session)) return;
  // Après navigation / autoplay bloqué, session.playing peut être true alors que l’audio est en pause.
  const audiblyPlaying = Boolean(el && !el.paused && !el.ended);
  if (audiblyPlaying) pauseCurrent();
  else playCurrent();
}

export function seekTo(seconds) {
  const el = getPlayAudio();
  if (!el) return;
  const t = Math.max(0, Number(seconds) || 0);
  if (Number.isFinite(el.duration) && el.duration > 0) {
    el.currentTime = Math.min(t, el.duration);
  } else {
    el.currentTime = t;
  }
  writePlaySession({ currentTime: el.currentTime }, { emitEvent: false });
}

export function skipTrack(direction = 1) {
  const session = readPlaySession();
  const el = getPlayAudio();
  const currentTime = el?.currentTime || 0;

  if (direction < 0) {
    // Si on a déjà avancé dans le morceau (> 3s), redémarrer à 0
    if (currentTime > 3) {
      if (el) el.currentTime = 0;
      writePlaySession({ currentTime: 0 });
      return;
    }
    
    // Sinon, aller à la piste précédente
    const next = prevPlayIndex({
      index: session.index,
      queueLen: session.queue.length,
      repeat: session.repeat,
    });
    
    // Si pas de piste précédente (début de la liste, repeat off), ne rien faire
    if (next < 0 || (next === session.index && session.index === 0)) return;
    
    writePlaySession({ index: next, playing: true, currentTime: 0 });
    loadTrack(session.queue[next], { time: 0, play: true });
    return;
  }

  const atEnd = session.index >= session.queue.length - 1;
  if (session.shuffle && session.repeat === "all" && atEnd && session.queue.length > 1) {
    const justPlayed = session.queue[session.index];
    let queue = shuffleArray(session.queue);
    if (queue[0]?.id === justPlayed?.id) {
      const swap = 1 + Math.floor(Math.random() * (queue.length - 1));
      [queue[0], queue[swap]] = [queue[swap], queue[0]];
    }
    queue = queue.map(slimPlayTrack).filter(Boolean);
    writePlaySession({ queue, index: 0, playing: true, currentTime: 0, shuffle: true, repeat: "all" });
    loadTrack(queue[0], { time: 0, play: true });
    return;
  }

  const next = nextPlayIndex({
    index: session.index,
    queueLen: session.queue.length,
    repeat: session.repeat,
  });
  if (next < 0) {
    pauseCurrent();
    syncMediaPlayback(false);
    writePlaySession({ playing: false, currentTime: 0 });
    return;
  }
  if (session.repeat === "one") {
    if (el) {
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      el.play().catch(() => writePlaySession({ playing: false }));
    }
    writePlaySession({ playing: true, currentTime: 0 });
    return;
  }
  writePlaySession({ index: next, playing: true, currentTime: 0 });
  loadTrack(session.queue[next], { time: 0, play: true });
}

export function playIndex(index) {
  const session = readPlaySession();
  if (!session.queue[index]) return;
  writePlaySession({ index, playing: true, currentTime: 0 });
  loadTrack(session.queue[index], { time: 0, play: true });
}

export function setPlayRepeat(repeat) {
  const next = repeat === "all" || repeat === "one" ? repeat : "off";
  writePlaySession({ repeat: next });
}

export function cyclePlayRepeat() {
  const cur = readPlaySession().repeat;
  setPlayRepeat(cur === "off" ? "all" : cur === "all" ? "one" : "off");
}

export function setPlayShuffle(on, current) {
  const session = readPlaySession();
  const enabled = Boolean(on);
  if (!session.queue.length || !current) {
    writePlaySession({ shuffle: enabled });
    return;
  }
  const rest = session.queue.filter((t) => t.id !== current.id);
  const shuffled = enabled ? shuffleArray(rest) : [...rest];
  writePlaySession({
    shuffle: enabled,
    queue: [current, ...shuffled],
    index: 0,
  });
}

export function stopPlayback() {
  const el = getPlayAudio();
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
    delete el.dataset.trackId;
  }
  writePlaySession({
    queue: [],
    index: 0,
    playing: false,
    currentTime: 0,
  });
}

export function bindMediaSession(handlers = {}) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  const track = currentPlayTrack();
  if (!track) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.trackTitle || "Sans titre",
    artist: track.artistName || "SONOZZ",
    album: track.artistName || "SONOZZ",
    artwork: track.coverUrl
      ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }]
      : [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
  });
  navigator.mediaSession.setActionHandler("play", handlers.play || playCurrent);
  navigator.mediaSession.setActionHandler("pause", handlers.pause || pauseCurrent);
  navigator.mediaSession.setActionHandler("previoustrack", () => skipTrack(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => skipTrack(1));
  navigator.mediaSession.setActionHandler("seekto", (details) => {
    if (details.seekTime != null) seekTo(details.seekTime);
  });
}
