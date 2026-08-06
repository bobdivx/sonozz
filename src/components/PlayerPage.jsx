import { useEffect, useRef, useState } from "preact/hooks";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Users,
  Music2,
  ChevronDown,
  Disc3,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { playableAudioSrc } from "../lib/audioResolve.js";

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function readQuery() {
  if (typeof location === "undefined") return {};
  const p = new URLSearchParams(location.search);
  return {
    artist: p.get("artist") || "",
    track: p.get("track") || "",
    play: p.get("play") === "1",
  };
}

function shuffleCopy(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function PlayerPage() {
  const audioRef = useRef(null);
  const seekRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });

  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("titres"); // titres | artistes | file
  const [filterArtist, setFilterArtist] = useState("");
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off"); // off | all | one
  const [expanded, setExpanded] = useState(false);
  const [audioError, setAudioError] = useState("");
  const seekingRef = useRef(false);

  const current = queue[index] || null;

  const visibleTracks = filterArtist
    ? tracks.filter((t) => t.slug === filterArtist)
    : tracks;

  // Chargement bibliothèque
  useEffect(() => {
    const q = readQuery();
    if (q.artist) {
      setFilterArtist(q.artist);
      setTab("titres");
    }
    (async () => {
      try {
        const res = await fetch("/api/library");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Impossible de charger la bibliothèque");
        const list = data.tracks || [];
        setTracks(list);
        setArtists(data.artists || []);

        if (q.artist) {
          const filtered = list.filter((t) => t.slug === q.artist);
          if (filtered.length) {
            setQueue(filtered);
            const ti = q.track ? filtered.findIndex((t) => t.id === q.track) : 0;
            setIndex(ti >= 0 ? ti : 0);
            setExpanded(true);
            if (q.play) setPlaying(true);
          }
        } else if (q.track) {
          const ti = list.findIndex((t) => t.id === q.track);
          if (ti >= 0) {
            setQueue(list);
            setIndex(ti);
            setExpanded(true);
            if (q.play) setPlaying(true);
          }
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Charger / jouer la piste courante
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.audioUrl) return;

    setAudioError("");
    const src = playableAudioSrc(current.audioUrl, current.audioS3Key);
    if (audio.dataset.trackId !== current.id) {
      audio.dataset.trackId = current.id;
      audio.src = src;
      audio.load();
    }

    if (playing) {
      audio.play().catch((e) => {
        setPlaying(false);
        setAudioError(e.message || "Lecture bloquée — appuie sur play");
      });
    } else {
      audio.pause();
    }
  }, [current?.id, current?.audioUrl, playing]);

  // Media Session
  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.trackTitle || "Sans titre",
      artist: current.artistName || "SONOZZ",
      album: current.artistName || "SONOZZ",
      artwork: current.coverUrl
        ? [{ src: current.coverUrl, sizes: "512x512", type: "image/jpeg" }]
        : [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.setActionHandler("play", () => setPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => goPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => goNext());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      const audio = audioRef.current;
      if (audio && details.seekTime != null) {
        audio.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });
  }, [current, queue, index, repeat, shuffle]);

  function playList(list, startId = null, { expand = true } = {}) {
    if (!list.length) return;
    const ordered = shuffle ? shuffleCopy(list) : [...list];
    let i = 0;
    if (startId) {
      const found = ordered.findIndex((t) => t.id === startId);
      if (found >= 0) i = found;
    }
    setQueue(ordered);
    setIndex(i);
    setPlaying(true);
    if (expand) setExpanded(true);
  }

  function playAll() {
    playList(visibleTracks);
  }

  function playArtist(slug) {
    const list = tracks.filter((t) => t.slug === slug);
    setFilterArtist(slug);
    setTab("titres");
    playList(list);
  }

  function playTrack(track, fromList = null) {
    const list = fromList || visibleTracks;
    const base = list.some((t) => t.id === track.id) ? list : [track, ...list];
    playList(base, track.id);
  }

  function goNext() {
    if (!queue.length) return;
    if (repeat === "one") {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
        setPlaying(true);
      }
      return;
    }
    if (index < queue.length - 1) {
      setIndex((i) => i + 1);
      setPlaying(true);
      return;
    }
    if (repeat === "all") {
      setIndex(0);
      setPlaying(true);
      return;
    }
    setPlaying(false);
  }

  function goPrev() {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (index > 0) {
      setIndex((i) => i - 1);
      setPlaying(true);
    } else if (repeat === "all" && queue.length) {
      setIndex(queue.length - 1);
      setPlaying(true);
    } else if (audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  }

  function onEnded() {
    goNext();
  }

  function onTimeUpdate() {
    if (seekingRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (Number.isFinite(audio.duration)) setDuration(audio.duration);
  }

  function seekToClientX(clientX) {
    const el = seekRef.current;
    const audio = audioRef.current;
    if (!el || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * audio.duration;
    audio.currentTime = t;
    setCurrentTime(t);
  }

  function onCoverTouchStart(e) {
    const t = e.changedTouches?.[0] || e.touches?.[0];
    if (!t) return;
    touchRef.current = { x: t.clientX, y: t.clientY };
  }

  function onCoverTouchEnd(e) {
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  function cycleRepeat() {
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }

  function toggleShuffle() {
    setShuffle((s) => {
      const next = !s;
      if (queue.length && current) {
        const rest = queue.filter((t) => t.id !== current.id);
        setQueue(next ? [current, ...shuffleCopy(rest)] : [current, ...rest]);
        setIndex(0);
      }
      return next;
    });
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const cover = current?.coverUrl || current?.artistImage || null;

  const artistGroups = artists
    .map((a) => ({
      ...a,
      trackCount: tracks.filter((t) => t.slug === a.slug).length,
    }))
    .filter((a) => a.trackCount > 0);

  return (
    <AppShell
      active="play"
      title="Play"
      subtitle="Lecteur tactile — tous les titres, un artiste, ou ta file d’attente."
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onLoadedMetadata={onTimeUpdate}
        onError={() =>
          setAudioError("Impossible de lire ce fichier — lien expiré ou audio manquant.")
        }
        class="hidden"
      />

      <div
        class={`mx-auto max-w-4xl pb-28 sm:pb-32 ${
          current && !expanded ? "pb-36 sm:pb-40" : ""
        }`}
      >
        {/* Filtres / actions */}
        <div class="mb-4 flex flex-wrap items-center gap-2 sm:mb-6 sm:gap-3">
          <button
            type="button"
            class="btn btn-primary min-h-12 gap-2 px-5 text-sm touch-manipulation sm:min-h-16 sm:gap-3 sm:px-8 sm:text-base"
            disabled={!visibleTracks.length}
            onClick={playAll}
          >
            <Play size={22} fill="currentColor" />
            Tout lire
            {filterArtist ? " (artiste)" : ""}
          </button>
          {filterArtist && (
            <button
              type="button"
              class="btn btn-ghost min-h-12 px-4 text-sm touch-manipulation sm:min-h-16 sm:px-6 sm:text-base"
              onClick={() => setFilterArtist("")}
            >
              Effacer filtre
            </button>
          )}
          <span class="w-full text-sm text-base-content/45 sm:ml-auto sm:w-auto">
            {visibleTracks.length} titre{visibleTracks.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Onglets */}
        <div
          class="mb-5 grid grid-cols-3 gap-1 rounded-xl border border-base-content/10 bg-base-200/50 p-1 sm:gap-1.5 sm:p-1.5"
          role="tablist"
        >
          {[
            { id: "titres", label: "Titres", icon: Music2 },
            { id: "artistes", label: "Artistes", icon: Users },
            { id: "file", label: "File", icon: ListMusic },
          ].map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                class={`flex min-h-12 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold touch-manipulation transition sm:min-h-16 sm:gap-2.5 sm:text-base ${
                  active
                    ? "bg-primary/20 text-primary"
                    : "text-base-content/60 active:bg-base-content/5"
                }`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={20} class="shrink-0" />
                <span class="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>

        {loading && (
          <div class="flex justify-center py-16">
            <span class="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {error && <p class="text-error">{error}</p>}
        {audioError && <p class="mb-3 text-sm text-warning">{audioError}</p>}

        {/* Liste titres */}
        {!loading && tab === "titres" && (
          <ul class="divide-y divide-base-content/8 border border-base-content/10 bg-base-200/30">
            {visibleTracks.map((t, i) => {
              const isCurrent = current?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    class={`flex w-full min-h-16 items-center gap-3 px-3 py-2.5 text-left touch-manipulation transition active:bg-primary/10 sm:min-h-[5.75rem] sm:gap-4 sm:px-4 sm:py-3 ${
                      isCurrent ? "bg-primary/10" : ""
                    }`}
                    onClick={() => playTrack(t)}
                  >
                    <span class="w-6 shrink-0 text-center text-xs text-base-content/40 sm:w-8 sm:text-sm">
                      {isCurrent && playing ? (
                        <span class="inline-block h-3 w-3 animate-pulse-soft rounded-full bg-primary sm:h-3.5 sm:w-3.5" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {t.coverUrl ? (
                      <img
                        src={t.coverUrl}
                        alt=""
                        class="h-12 w-12 shrink-0 object-cover sm:h-16 sm:w-16"
                        width="64"
                        height="64"
                      />
                    ) : (
                      <div class="flex h-12 w-12 shrink-0 items-center justify-center bg-base-300 sm:h-16 sm:w-16">
                        <Disc3 size={22} class="opacity-35" />
                      </div>
                    )}
                    <div class="min-w-0 flex-1">
                      <p
                        class={`truncate text-base font-semibold sm:text-lg ${
                          isCurrent ? "text-primary" : ""
                        }`}
                      >
                        {t.trackTitle}
                      </p>
                      <p class="truncate text-xs text-base-content/50 sm:text-sm">{t.artistName}</p>
                    </div>
                    <span class="flex h-11 w-11 shrink-0 items-center justify-center text-base-content/70 sm:h-14 sm:w-14">
                      {isCurrent && playing ? <Pause size={24} /> : <Play size={24} />}
                    </span>
                  </button>
                </li>
              );
            })}
            {!visibleTracks.length && (
              <li class="px-4 py-10 text-center text-sm text-base-content/50 sm:text-base">
                Aucun titre audio — génère ou importe un morceau dans le Studio.
              </li>
            )}
          </ul>
        )}

        {/* Artistes */}
        {!loading && tab === "artistes" && (
          <ul class="space-y-2 sm:space-y-3">
            {artistGroups.map((a) => (
              <li key={a.slug}>
                <div class="flex items-stretch gap-0 border border-base-content/10 bg-base-200/30">
                  <button
                    type="button"
                    class="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left touch-manipulation active:bg-primary/10 sm:min-h-[6rem] sm:gap-4 sm:px-4 sm:py-3"
                    onClick={() => {
                      setFilterArtist(a.slug);
                      setTab("titres");
                    }}
                  >
                    {a.profile?.imageUrl ? (
                      <img
                        src={a.profile.imageUrl}
                        alt=""
                        class="h-12 w-12 shrink-0 object-cover sm:h-16 sm:w-16"
                        width="64"
                        height="64"
                      />
                    ) : (
                      <div class="flex h-12 w-12 shrink-0 items-center justify-center bg-base-300 sm:h-16 sm:w-16">
                        <Users size={22} class="opacity-40" />
                      </div>
                    )}
                    <div class="min-w-0">
                      <p class="font-display truncate text-lg font-semibold sm:text-xl">{a.name}</p>
                      <p class="text-xs text-base-content/50 sm:text-sm">
                        {a.trackCount} titre{a.trackCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost h-auto min-w-14 rounded-none border-l border-base-content/10 touch-manipulation sm:min-w-20"
                    aria-label={`Lire ${a.name}`}
                    onClick={() => playArtist(a.slug)}
                  >
                    <Play size={24} fill="currentColor" />
                  </button>
                </div>
              </li>
            ))}
            {!artistGroups.length && (
              <li class="py-10 text-center text-sm text-base-content/50 sm:text-base">
                Aucun artiste avec audio pour l’instant.
              </li>
            )}
          </ul>
        )}

        {/* File d'attente */}
        {!loading && tab === "file" && (
          <ul class="divide-y divide-base-content/8 border border-base-content/10 bg-base-200/30">
            {queue.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <button
                  type="button"
                  class={`flex w-full min-h-14 items-center gap-3 px-3 py-2.5 text-left touch-manipulation sm:min-h-[5.25rem] sm:gap-4 sm:px-4 sm:py-3 ${
                    i === index ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => {
                    setIndex(i);
                    setPlaying(true);
                    setExpanded(true);
                  }}
                >
                  <span class="w-6 shrink-0 text-center text-xs opacity-50 sm:w-8 sm:text-sm">
                    {i + 1}
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-base font-semibold sm:text-lg">{t.trackTitle}</p>
                    <p class="truncate text-xs opacity-50 sm:text-sm">{t.artistName}</p>
                  </div>
                </button>
              </li>
            ))}
            {!queue.length && (
              <li class="px-4 py-10 text-center text-sm text-base-content/50 sm:text-base">
                La file est vide — lance « Tout lire » ou un titre.
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Mini-lecteur (bas d’écran) */}
      {current && !expanded && (
        <div class="fixed inset-x-0 bottom-0 z-50 border-t border-base-content/10 bg-base-200/95 backdrop-blur-md safe-bottom">
          <button
            type="button"
            class="flex w-full min-h-[4.5rem] items-center gap-3 px-3 py-2.5 text-left touch-manipulation active:bg-base-content/5 sm:min-h-[5.5rem] sm:gap-4 sm:px-4 sm:py-3"
            onClick={() => setExpanded(true)}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                class="h-12 w-12 shrink-0 object-cover sm:h-16 sm:w-16"
                width="64"
                height="64"
              />
            ) : (
              <div class="flex h-12 w-12 shrink-0 items-center justify-center bg-base-300 sm:h-16 sm:w-16">
                <Music2 size={22} class="opacity-40" />
              </div>
            )}
            <div class="min-w-0 flex-1">
              <p class="truncate text-base font-semibold sm:text-lg">{current.trackTitle}</p>
              <p class="truncate text-xs text-base-content/50 sm:text-sm">{current.artistName}</p>
            </div>
            <span
              class="btn btn-primary btn-circle h-12 w-12 min-h-12 min-w-12 touch-manipulation sm:h-16 sm:w-16 sm:min-h-16 sm:min-w-16"
              onClick={(e) => {
                e.stopPropagation();
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={24} /> : <Play size={24} fill="currentColor" />}
            </span>
          </button>
          <div class="h-1 bg-base-content/10 sm:h-1.5">
            <div
              class="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Now playing plein écran */}
      {current && expanded && (
        <div class="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-base-200/98 backdrop-blur-xl animate-rise">
          <div class="flex shrink-0 items-center justify-between px-2 pb-1 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4 sm:pb-2 sm:pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              type="button"
              class="btn btn-ghost btn-square min-h-12 min-w-12 touch-manipulation sm:min-h-16 sm:min-w-16"
              aria-label="Réduire"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={28} />
            </button>
            <p class="font-display text-xs font-semibold tracking-wide text-base-content/60 sm:text-base">
              EN LECTURE
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-square min-h-12 min-w-12 touch-manipulation sm:min-h-16 sm:min-w-16"
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setTab("file");
              }}
            >
              <ListMusic size={24} />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col justify-between gap-3 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-center sm:gap-0 sm:px-6 sm:pb-[max(1.75rem,env(safe-area-inset-bottom))] md:px-16">
            <div
              class="mx-auto w-full max-w-lg shrink-0 touch-manipulation select-none"
              onTouchStart={onCoverTouchStart}
              onTouchEnd={onCoverTouchEnd}
            >
              <div
                class={`mx-auto aspect-square w-[min(100%,52vw,38vh)] overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-base-content/10 sm:w-full ${
                  playing ? "play-cover-playing" : ""
                }`}
              >
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    class={`h-full w-full object-cover transition duration-500 ${
                      playing ? "scale-100" : "scale-[1.02] opacity-90"
                    }`}
                  />
                ) : (
                  <div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary/40 to-base-300">
                    <Disc3
                      size={72}
                      class={`opacity-30 sm:h-24 sm:w-24 ${playing ? "animate-pulse-soft" : ""}`}
                    />
                  </div>
                )}
              </div>
              <p class="mt-2 hidden text-center text-sm text-base-content/40 sm:mt-3 sm:block">
                Glisse la jaquette ← → pour changer de titre
              </p>
            </div>

            <div class="mx-auto w-full max-w-lg shrink-0 text-center sm:mt-6">
              <h2 class="font-display line-clamp-2 text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                {current.trackTitle}
              </h2>
              <p class="mt-1 truncate text-base text-base-content/55 sm:mt-2 sm:text-lg">
                {current.artistName}
              </p>
            </div>

            {/* Seek tactile */}
            <div class="mx-auto w-full max-w-lg shrink-0 sm:mt-8">
              <div
                ref={seekRef}
                class="relative h-11 cursor-pointer touch-manipulation sm:h-14"
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={currentTime}
                aria-label="Position"
                onPointerDown={(e) => {
                  seekingRef.current = true;
                  seekToClientX(e.clientX);
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (!seekingRef.current) return;
                  seekToClientX(e.clientX);
                }}
                onPointerUp={() => {
                  seekingRef.current = false;
                }}
                onPointerCancel={() => {
                  seekingRef.current = false;
                }}
              >
                <div class="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-base-content/15 sm:h-2.5">
                  <div
                    class="h-full rounded-full bg-primary"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div
                  class="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md sm:h-7 sm:w-7"
                  style={{ left: `${progress}%` }}
                />
              </div>
              <div class="mt-0.5 flex justify-between text-xs tabular-nums text-base-content/45 sm:mt-1 sm:text-sm">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Contrôles */}
            <div class="mx-auto flex w-full max-w-lg shrink-0 items-center justify-between gap-1 px-0 sm:mt-8 sm:gap-3 sm:px-1">
              <button
                type="button"
                class={`btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:min-h-16 sm:min-w-16 ${
                  shuffle ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Aléatoire"
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Shuffle size={22} class="sm:h-7 sm:w-7" />
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle h-12 min-h-12 w-12 min-w-12 touch-manipulation sm:min-h-20 sm:min-w-20"
                aria-label="Précédent"
                onClick={goPrev}
              >
                <SkipBack size={28} fill="currentColor" class="sm:h-9 sm:w-9" />
              </button>

              <button
                type="button"
                class="btn btn-primary btn-circle h-16 w-16 min-h-16 min-w-16 touch-manipulation shadow-lg shadow-primary/25 sm:h-24 sm:w-24 sm:min-h-24 sm:min-w-24"
                aria-label={playing ? "Pause" : "Lecture"}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? (
                  <Pause size={32} fill="currentColor" class="sm:h-11 sm:w-11" />
                ) : (
                  <Play size={32} fill="currentColor" class="ml-0.5 sm:ml-1 sm:h-11 sm:w-11" />
                )}
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle h-12 min-h-12 w-12 min-w-12 touch-manipulation sm:min-h-20 sm:min-w-20"
                aria-label="Suivant"
                onClick={goNext}
              >
                <SkipForward size={28} fill="currentColor" class="sm:h-9 sm:w-9" />
              </button>

              <button
                type="button"
                class={`btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:min-h-16 sm:min-w-16 ${
                  repeat !== "off" ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Répéter"
                onClick={cycleRepeat}
              >
                {repeat === "one" ? (
                  <Repeat1 size={22} class="sm:h-7 sm:w-7" />
                ) : (
                  <Repeat size={22} class="sm:h-7 sm:w-7" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
