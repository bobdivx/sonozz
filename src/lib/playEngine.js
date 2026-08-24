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

function bind(el) {
  el.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - timeWriteAt < 2000) return;
    timeWriteAt = now;
    writePlaySession({ currentTime: el.currentTime || 0 }, { emitEvent: false });
  });
  el.addEventListener("ended", () => {
    skipTrack(1);
  });
  el.addEventListener("play", () => {
    writePlaySession({ playing: true });
  });
  el.addEventListener("pause", () => {
    if (ignorePause || el.ended) return;
    writePlaySession({
      playing: false,
      currentTime: el.currentTime || 0,
    });
  });
  el.addEventListener("error", () => {
    writePlaySession({ playing: false });
  });
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
    writePlaySession({ playing: false });
    return;
  }

  const same = el.dataset.trackId === track.id;
  if (!same) {
    ignorePause = true;
    el.dataset.trackId = track.id;
    el.src = src;
    el.load();
    const apply = () => {
      if (time > 0.4 && Number.isFinite(el.duration) && time < el.duration) {
        el.currentTime = time;
      }
      if (play) {
        el.play()
          .catch(() => writePlaySession({ playing: false }))
          .finally(() => {
            ignorePause = false;
          });
      } else {
        ignorePause = false;
      }
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
    return;
  }

  if (play) el.play().catch(() => writePlaySession({ playing: false }));
  else el.pause();
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
  getPlayAudio()?.pause();
}

export function togglePlay() {
  const el = getPlayAudio();
  const session = readPlaySession();
  if (!currentPlayTrack(session)) return;
  if (session.playing && el && !el.paused) pauseCurrent();
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

  const next = nextPlayIndex({
    index: session.index,
    queueLen: session.queue.length,
    repeat: session.repeat,
  });
  if (next < 0) {
    pauseCurrent();
    writePlaySession({ playing: false, currentTime: 0 });
    return;
  }
  if (session.repeat === "one") {
    if (el) {
      el.currentTime = 0;
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
  const shuffled = [...rest];
  if (enabled) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
  }
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
