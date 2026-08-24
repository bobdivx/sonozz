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
  Star,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import {
  bindMediaSession,
  cyclePlayRepeat,
  getPlayAudio,
  playIndex,
  seekTo,
  setPlayShuffle,
  skipTrack,
  startPlayback,
  togglePlay,
} from "../lib/playEngine.js";
import {
  currentPlayTrack,
  readPlaySession,
  setPlayExpanded,
  subscribePlaySession,
} from "../lib/playSession.js";

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
  const seekRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });

  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("titres"); // titres | artistes | file
  const [filterArtist, setFilterArtist] = useState("");
  const [session, setSession] = useState(() =>
    typeof window === "undefined"
      ? { queue: [], index: 0, playing: false, shuffle: false, repeat: "off" }
      : readPlaySession(),
  );
  const [expanded, setExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [trackRating, setTrackRating] = useState(null);
  const [ratingStats, setRatingStats] = useState(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const seekingRef = useRef(false);

  // Réinitialiser la durée lors du changement de morceau
  useEffect(() => {
    if (!current) {
      setDuration(0);
      setCurrentTime(0);
      setAudioError("");
      return;
    }
    // Essayer d'utiliser la durée stockée immédiatement
    if (current.duration && Number.isFinite(current.duration) && current.duration > 0) {
      setDuration(current.duration);
    }
  }, [current?.id]);

  // Générer ou récupérer un player_id anonyme stable
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let id = localStorage.getItem("sonozz-player-id");
    if (!id) {
      id = `player_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("sonozz-player-id", id);
    }
    setPlayerId(id);
  }, []);

  const queue = session.queue || [];
  const index = session.index || 0;
  const playing = Boolean(session.playing);
  const shuffle = Boolean(session.shuffle);
  const repeat = session.repeat || "off";
  const current = currentPlayTrack(session);

  const visibleTracks = filterArtist
    ? tracks.filter((t) => t.slug === filterArtist)
    : tracks;

  useEffect(() => {
    return subscribePlaySession(setSession);
  }, []);

  useEffect(() => {
    setPlayExpanded(expanded);
    return () => setPlayExpanded(false);
  }, [expanded]);

  useEffect(() => {
    const collapseIfLeft = () => {
      if (typeof location !== "undefined" && location.pathname !== "/play") {
        setExpanded(false);
        setPlayExpanded(false);
      }
    };
    document.addEventListener("astro:after-swap", collapseIfLeft);
    return () => document.removeEventListener("astro:after-swap", collapseIfLeft);
  }, []);

  useEffect(() => {
    const open = () => setExpanded(true);
    const close = () => setExpanded(false);
    window.addEventListener("sonozz-play-open", open);
    window.addEventListener("sonozz-play-close", close);
    return () => {
      window.removeEventListener("sonozz-play-open", open);
      window.removeEventListener("sonozz-play-close", close);
    };
  }, []);

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
            const ti = q.track ? filtered.findIndex((t) => t.id === q.track) : 0;
            startPlayback({
              queue: filtered,
              index: ti >= 0 ? ti : 0,
              shuffle,
              play: Boolean(q.play),
            });
            setExpanded(true);
          }
        } else if (q.track) {
          const ti = list.findIndex((t) => t.id === q.track);
          if (ti >= 0) {
            startPlayback({ queue: list, index: ti, shuffle, play: Boolean(q.play) });
            setExpanded(true);
          }
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Horloge audio globale
  useEffect(() => {
    const el = getPlayAudio();
    if (!el) return;
    const onTime = () => {
      if (seekingRef.current) return;
      setCurrentTime(el.currentTime || 0);
      // Utiliser el.duration si disponible, sinon fallback sur current.duration stockée
      if (Number.isFinite(el.duration) && el.duration > 0) {
        setDuration(el.duration);
      } else if (current?.duration && Number.isFinite(current.duration) && current.duration > 0) {
        setDuration(current.duration);
      }
    };
    const onErr = () =>
      setAudioError("Impossible de lire ce fichier — lien expiré ou audio manquant.");
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onTime);
    el.addEventListener("durationchange", onTime);
    el.addEventListener("error", onErr);
    onTime();
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onTime);
      el.removeEventListener("durationchange", onTime);
      el.removeEventListener("error", onErr);
    };
  }, [current?.id, current?.duration]);

  useEffect(() => {
    bindMediaSession();
  }, [current?.id, queue.length, index, repeat, shuffle]);

  // Charger la note et les stats du morceau actuel
  useEffect(() => {
    if (!current?.id || !playerId) {
      setTrackRating(null);
      setRatingStats(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/ratings?trackId=${encodeURIComponent(current.id)}&playerId=${encodeURIComponent(playerId)}`);
        if (!res.ok) return;
        const data = await res.json();
        setTrackRating(data.userRating);
        setRatingStats(data.stats);
      } catch {
        /* ignore */
      }
    })();
  }, [current?.id, playerId]);

  async function rateTrack(rating) {
    if (!current?.id || !playerId || ratingBusy) return;
    setRatingBusy(true);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId,
          trackId: current.id,
          rating,
        }),
      });
      if (!res.ok) throw new Error("Erreur lors de la notation");
      const data = await res.json();
      setTrackRating(data.rating.rating);
      setRatingStats(data.stats);
    } catch (e) {
      console.error("Rating error:", e);
    } finally {
      setRatingBusy(false);
    }
  }

  function playList(list, startId = null, { expand = false } = {}) {
    if (!list.length) return;
    const ordered = shuffle ? shuffleCopy(list) : [...list];
    let i = 0;
    if (startId) {
      const found = ordered.findIndex((t) => t.id === startId);
      if (found >= 0) i = found;
    }
    startPlayback({ queue: ordered, index: i, shuffle, repeat });
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
    skipTrack(1);
  }

  function goPrev() {
    skipTrack(-1);
  }

  function seekToClientX(clientX) {
    const el = seekRef.current;
    const audio = getPlayAudio();
    if (!el || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * audio.duration;
    seekTo(t);
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
    cyclePlayRepeat();
  }

  function toggleShuffle() {
    setPlayShuffle(!shuffle, current);
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
      fillViewport
    >
      <div class="flex min-h-0 flex-1 flex-col">
        {/* Filtres / actions */}
        <div class="mb-3 flex shrink-0 flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
          <button
            type="button"
            class="btn btn-primary min-h-11 gap-2 px-5 text-sm touch-manipulation sm:min-h-12 sm:gap-3 sm:px-6 sm:text-base"
            disabled={loading || !visibleTracks.length}
            onClick={playAll}
          >
            <Play size={20} fill="currentColor" />
            Tout lire
            {filterArtist ? " (artiste)" : ""}
          </button>
          {filterArtist && (
            <button
              type="button"
              class="btn btn-ghost min-h-11 px-4 text-sm touch-manipulation sm:min-h-12 sm:px-5 sm:text-base"
              onClick={() => setFilterArtist("")}
            >
              Effacer filtre
            </button>
          )}
          {!loading && visibleTracks.length > 0 && (
            <span class="w-full text-sm text-base-content/45 sm:ml-auto sm:w-auto">
              {visibleTracks.length} titre{visibleTracks.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Onglets */}
        <div
          class="mb-3 grid shrink-0 grid-cols-3 gap-1 rounded-xl border border-base-content/10 bg-base-200/50 p-1 sm:mb-4 sm:gap-1.5 sm:p-1.5"
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
                class={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold touch-manipulation transition sm:min-h-12 sm:gap-2 sm:text-base ${
                  active
                    ? "bg-primary/20 text-primary"
                    : "text-base-content/60 active:bg-base-content/5"
                }`}
                onClick={() => setTab(t.id)}
              >
                <Icon size={18} class="shrink-0" />
                <span class="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>

        {loading && (
          <div class="flex min-h-0 flex-1 items-center justify-center">
            <span class="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {error && <p class="shrink-0 text-error">{error}</p>}
        {audioError && <p class="mb-2 shrink-0 text-sm text-warning">{audioError}</p>}

        {/* Liste titres */}
        {!loading && tab === "titres" && (
          <ul class="min-h-0 flex-1 divide-y divide-base-content/8 overflow-y-auto overscroll-contain border border-base-content/10 bg-base-200/30">
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
          <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain sm:space-y-3">
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
          <ul class="min-h-0 flex-1 divide-y divide-base-content/8 overflow-y-auto overscroll-contain border border-base-content/10 bg-base-200/30">
            {queue.map((t, i) => (
              <li key={`${t.id}-${i}`}>
                <button
                  type="button"
                  class={`flex w-full min-h-14 items-center gap-3 px-3 py-2.5 text-left touch-manipulation sm:min-h-[5.25rem] sm:gap-4 sm:px-4 sm:py-3 ${
                    i === index ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => {
                    playIndex(i);
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

      {/* Now playing plein écran — tout tient dans le viewport, sans scroll */}
      {current && expanded && (
        <div class="fixed inset-x-0 top-0 bottom-[var(--sonozz-now-playing,5.25rem)] z-[60] flex flex-col overflow-hidden bg-base-200/98 backdrop-blur-xl animate-rise">
          <div class="flex h-12 shrink-0 items-center justify-between px-1 pt-[env(safe-area-inset-top)] sm:h-14 sm:px-3">
            <button
              type="button"
              class="btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:h-12 sm:min-h-12 sm:w-12 sm:min-w-12"
              aria-label="Réduire"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={26} />
            </button>
            <p class="font-display text-xs font-semibold tracking-wide text-base-content/60 sm:text-sm">
              EN LECTURE
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:h-12 sm:min-h-12 sm:w-12 sm:min-w-12"
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setTab("file");
              }}
            >
              <ListMusic size={22} />
            </button>
          </div>

          <div class="flex min-h-0 flex-1 flex-col px-4 pb-2 sm:px-6 md:px-16">
            <div
              class="flex min-h-0 flex-1 items-center justify-center touch-manipulation select-none"
              style={{ containerType: "size" }}
              onTouchStart={onCoverTouchStart}
              onTouchEnd={onCoverTouchEnd}
            >
              <div
                class={`overflow-hidden shadow-2xl shadow-black/40 ring-1 ring-base-content/10 ${
                  playing ? "play-cover-playing" : ""
                }`}
                style={{ width: "min(100%, 100cqh)", aspectRatio: "1 / 1" }}
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
                      size={64}
                      class={`opacity-30 sm:h-20 sm:w-20 ${playing ? "animate-pulse-soft" : ""}`}
                    />
                  </div>
                )}
              </div>
            </div>

            <div class="mx-auto w-full max-w-lg shrink-0 py-2 text-center sm:py-3">
              <h2 class="font-display line-clamp-1 text-xl font-extrabold tracking-tight sm:text-2xl md:text-3xl">
                {current.trackTitle}
              </h2>
              <p class="mt-0.5 truncate text-sm text-base-content/55 sm:text-base">
                {current.artistName}
              </p>

              {/* Système de notation */}
              {playerId && (
                <div class="mt-3 flex flex-col items-center gap-2">
                  <div class="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        class="btn btn-ghost btn-circle btn-sm touch-manipulation"
                        onClick={() => rateTrack(star)}
                        disabled={ratingBusy}
                        aria-label={`Noter ${star} étoile${star > 1 ? "s" : ""}`}
                      >
                        <Star
                          size={20}
                          fill={trackRating && star <= trackRating ? "currentColor" : "none"}
                          class={trackRating && star <= trackRating ? "text-warning" : "text-base-content/30"}
                        />
                      </button>
                    ))}
                  </div>
                  {ratingStats && ratingStats.count > 0 && (
                    <p class="text-xs text-base-content/45">
                      {ratingStats.average.toFixed(1)} / 5 · {ratingStats.count} note{ratingStats.count > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Seek tactile */}
            <div class="mx-auto w-full max-w-lg shrink-0">
              <div
                ref={seekRef}
                class="relative h-9 cursor-pointer touch-manipulation sm:h-11"
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
                <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-base-content/15 sm:h-2">
                  <div
                    class="h-full rounded-full bg-primary"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div
                  class="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md sm:h-5 sm:w-5"
                  style={{ left: `${progress}%` }}
                />
              </div>
              <div class="flex justify-between text-[11px] tabular-nums text-base-content/45 sm:text-xs">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Contrôles */}
            <div class="mx-auto flex w-full max-w-lg shrink-0 items-center justify-between gap-1 py-1 sm:py-2">
              <button
                type="button"
                class={`btn btn-ghost btn-square h-10 min-h-10 w-10 min-w-10 touch-manipulation sm:h-12 sm:min-h-12 sm:w-12 sm:min-w-12 ${
                  shuffle ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Aléatoire"
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Shuffle size={20} class="sm:h-6 sm:w-6" />
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14"
                aria-label="Précédent"
                onClick={goPrev}
              >
                <SkipBack size={24} fill="currentColor" class="sm:h-7 sm:w-7" />
              </button>

              <button
                type="button"
                class="btn btn-primary btn-circle h-14 w-14 min-h-14 min-w-14 touch-manipulation shadow-lg shadow-primary/25 sm:h-16 sm:w-16 sm:min-h-16 sm:min-w-16"
                aria-label={playing ? "Pause" : "Lecture"}
                onClick={() => togglePlay()}
              >
                {playing ? (
                  <Pause size={28} fill="currentColor" class="sm:h-8 sm:w-8" />
                ) : (
                  <Play size={28} fill="currentColor" class="ml-0.5 sm:h-8 sm:w-8" />
                )}
              </button>

              <button
                type="button"
                class="btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14"
                aria-label="Suivant"
                onClick={goNext}
              >
                <SkipForward size={24} fill="currentColor" class="sm:h-7 sm:w-7" />
              </button>

              <button
                type="button"
                class={`btn btn-ghost btn-square h-10 min-h-10 w-10 min-w-10 touch-manipulation sm:h-12 sm:min-h-12 sm:w-12 sm:min-w-12 ${
                  repeat !== "off" ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Répéter"
                onClick={cycleRepeat}
              >
                {repeat === "one" ? (
                  <Repeat1 size={20} class="sm:h-6 sm:w-6" />
                ) : (
                  <Repeat size={20} class="sm:h-6 sm:w-6" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
