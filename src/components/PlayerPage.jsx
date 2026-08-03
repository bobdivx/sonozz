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

function streamSrc(audioUrl) {
  if (!audioUrl) return "";
  if (audioUrl.startsWith("data:audio") || audioUrl.startsWith("/")) return audioUrl;
  try {
    if (typeof location !== "undefined") {
      const u = new URL(audioUrl, location.href);
      if (u.origin === location.origin) return audioUrl;
    }
  } catch {
    /* fallthrough */
  }
  return `/api/audio/stream?url=${encodeURIComponent(audioUrl)}`;
}

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
    const src = streamSrc(current.audioUrl);
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

      <div class={`mx-auto max-w-4xl pb-32 ${current && !expanded ? "pb-40" : ""}`}>
        {/* Filtres / actions */}
        <div class="mb-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="btn btn-primary min-h-16 gap-3 px-8 text-base touch-manipulation"
            disabled={!visibleTracks.length}
            onClick={playAll}
          >
            <Play size={24} fill="currentColor" />
            Tout lire
            {filterArtist ? " (artiste)" : ""}
          </button>
          {filterArtist && (
            <button
              type="button"
              class="btn btn-ghost min-h-16 px-6 text-base touch-manipulation"
              onClick={() => setFilterArtist("")}
            >
              Effacer filtre
            </button>
          )}
          <span class="ml-auto text-sm text-base-content/45">
            {visibleTracks.length} titre{visibleTracks.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Onglets */}
        <div
          class="mb-5 grid grid-cols-3 gap-1.5 rounded-xl border border-base-content/10 bg-base-200/50 p-1.5"
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
                class={`flex min-h-16 items-center justify-center gap-2.5 rounded-lg text-base font-semibold touch-manipulation transition ${
                  active
                    ? "bg-primary/20 text-primary"
                    : "text-base-content/60 active:bg-base-content/5"
                }`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={22} />
                {t.label}
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
                    class={`flex w-full min-h-[5.75rem] items-center gap-4 px-4 py-3 text-left touch-manipulation transition active:bg-primary/10 ${
                      isCurrent ? "bg-primary/10" : ""
                    }`}
                    onClick={() => playTrack(t)}
                  >
                    <span class="w-8 shrink-0 text-center text-sm text-base-content/40">
                      {isCurrent && playing ? (
                        <span class="inline-block h-3.5 w-3.5 animate-pulse-soft rounded-full bg-primary" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {t.coverUrl ? (
                      <img
                        src={t.coverUrl}
                        alt=""
                        class="h-16 w-16 shrink-0 object-cover"
                        width="64"
                        height="64"
                      />
                    ) : (
                      <div class="flex h-16 w-16 shrink-0 items-center justify-center bg-base-300">
                        <Disc3 size={24} class="opacity-35" />
                      </div>
                    )}
                    <div class="min-w-0 flex-1">
                      <p class={`truncate text-lg font-semibold ${isCurrent ? "text-primary" : ""}`}>
                        {t.trackTitle}
                      </p>
                      <p class="truncate text-sm text-base-content/50">{t.artistName}</p>
                    </div>
                    <span class="flex h-14 w-14 shrink-0 items-center justify-center text-base-content/70">
                      {isCurrent && playing ? <Pause size={28} /> : <Play size={28} />}
                    </span>
                  </button>
                </li>
              );
            })}
            {!visibleTracks.length && (
              <li class="px-4 py-10 text-center text-base text-base-content/50">
                Aucun titre audio — génère ou importe un morceau dans le Studio.
              </li>
            )}
          </ul>
        )}

        {/* Artistes */}
        {!loading && tab === "artistes" && (
          <ul class="space-y-3">
            {artistGroups.map((a) => (
              <li key={a.slug}>
                <div class="flex items-stretch gap-0 border border-base-content/10 bg-base-200/30">
                  <button
                    type="button"
                    class="flex min-h-[6rem] min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left touch-manipulation active:bg-primary/10"
                    onClick={() => {
                      setFilterArtist(a.slug);
                      setTab("titres");
                    }}
                  >
                    {a.profile?.imageUrl ? (
                      <img
                        src={a.profile.imageUrl}
                        alt=""
                        class="h-16 w-16 object-cover"
                        width="64"
                        height="64"
                      />
                    ) : (
                      <div class="flex h-16 w-16 items-center justify-center bg-base-300">
                        <Users size={26} class="opacity-40" />
                      </div>
                    )}
                    <div class="min-w-0">
                      <p class="font-display truncate text-xl font-semibold">{a.name}</p>
                      <p class="text-sm text-base-content/50">
                        {a.trackCount} titre{a.trackCount !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost h-auto min-w-20 rounded-none border-l border-base-content/10 touch-manipulation"
                    aria-label={`Lire ${a.name}`}
                    onClick={() => playArtist(a.slug)}
                  >
                    <Play size={28} fill="currentColor" />
                  </button>
                </div>
              </li>
            ))}
            {!artistGroups.length && (
              <li class="py-10 text-center text-base text-base-content/50">
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
                  class={`flex w-full min-h-[5.25rem] items-center gap-4 px-4 py-3 text-left touch-manipulation ${
                    i === index ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => {
                    setIndex(i);
                    setPlaying(true);
                    setExpanded(true);
                  }}
                >
                  <span class="w-8 text-center text-sm opacity-50">{i + 1}</span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-lg font-semibold">{t.trackTitle}</p>
                    <p class="truncate text-sm opacity-50">{t.artistName}</p>
                  </div>
                </button>
              </li>
            ))}
            {!queue.length && (
              <li class="px-4 py-10 text-center text-base text-base-content/50">
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
            class="flex w-full min-h-[5.5rem] items-center gap-4 px-4 py-3 text-left touch-manipulation active:bg-base-content/5"
            onClick={() => setExpanded(true)}
          >
            {cover ? (
              <img src={cover} alt="" class="h-16 w-16 object-cover" width="64" height="64" />
            ) : (
              <div class="flex h-16 w-16 items-center justify-center bg-base-300">
                <Music2 size={24} class="opacity-40" />
              </div>
            )}
            <div class="min-w-0 flex-1">
              <p class="truncate text-lg font-semibold">{current.trackTitle}</p>
              <p class="truncate text-sm text-base-content/50">{current.artistName}</p>
            </div>
            <span
              class="btn btn-primary btn-circle h-16 w-16 min-h-16 min-w-16 touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause size={28} /> : <Play size={28} fill="currentColor" />}
            </span>
          </button>
          <div class="h-1.5 bg-base-content/10">
            <div class="h-full bg-primary transition-[width] duration-150" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Now playing plein écran */}
      {current && expanded && (
        <div class="fixed inset-0 z-[60] flex flex-col bg-base-200/98 backdrop-blur-xl animate-rise">
          <div class="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              type="button"
              class="btn btn-ghost btn-square min-h-16 min-w-16 touch-manipulation"
              aria-label="Réduire"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={32} />
            </button>
            <p class="font-display text-base font-semibold tracking-wide text-base-content/60">
              EN LECTURE
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-square min-h-16 min-w-16 touch-manipulation"
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setTab("file");
              }}
            >
              <ListMusic size={28} />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col justify-center px-6 md:px-16">
            <div
              class="mx-auto w-full max-w-lg touch-manipulation select-none"
              onTouchStart={onCoverTouchStart}
              onTouchEnd={onCoverTouchEnd}
            >
              <div
                class={`aspect-square overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-base-content/10 ${
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
                      size={96}
                      class={`opacity-30 ${playing ? "animate-pulse-soft" : ""}`}
                    />
                  </div>
                )}
              </div>
              <p class="mt-3 text-center text-sm text-base-content/40">
                Glisse la jaquette ← → pour changer de titre
              </p>
            </div>

            <div class="mx-auto mt-6 w-full max-w-lg text-center">
              <h2 class="font-display text-3xl font-extrabold tracking-tight md:text-4xl">
                {current.trackTitle}
              </h2>
              <p class="mt-2 text-lg text-base-content/55">{current.artistName}</p>
            </div>

            {/* Seek tactile */}
            <div class="mx-auto mt-8 w-full max-w-lg">
              <div
                ref={seekRef}
                class="relative h-14 cursor-pointer touch-manipulation"
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
                <div class="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-base-content/15">
                  <div
                    class="h-full rounded-full bg-primary"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div
                  class="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md"
                  style={{ left: `${progress}%` }}
                />
              </div>
              <div class="mt-1 flex justify-between text-sm tabular-nums text-base-content/45">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Contrôles */}
            <div class="mx-auto mt-8 flex w-full max-w-lg items-center justify-between gap-3 px-1 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                class={`btn btn-ghost btn-square min-h-16 min-w-16 touch-manipulation ${
                  shuffle ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Aléatoire"
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Shuffle size={28} />
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle min-h-20 min-w-20 touch-manipulation"
                aria-label="Précédent"
                onClick={goPrev}
              >
                <SkipBack size={36} fill="currentColor" />
              </button>

              <button
                type="button"
                class="btn btn-primary btn-circle h-24 w-24 min-h-24 min-w-24 touch-manipulation shadow-lg shadow-primary/25"
                aria-label={playing ? "Pause" : "Lecture"}
                onClick={() => setPlaying((p) => !p)}
              >
                {playing ? (
                  <Pause size={44} fill="currentColor" />
                ) : (
                  <Play size={44} fill="currentColor" class="ml-1" />
                )}
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle min-h-20 min-w-20 touch-manipulation"
                aria-label="Suivant"
                onClick={goNext}
              >
                <SkipForward size={36} fill="currentColor" />
              </button>

              <button
                type="button"
                class={`btn btn-ghost btn-square min-h-16 min-w-16 touch-manipulation ${
                  repeat !== "off" ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Répéter"
                onClick={cycleRepeat}
              >
                {repeat === "one" ? <Repeat1 size={28} /> : <Repeat size={28} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
