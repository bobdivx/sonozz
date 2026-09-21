import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Home,
  Library,
  Search,
  ChevronDown,
  Disc3,
  Star,
  X,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import { Pressable, FadeIn } from "./ui/Motion.jsx";
import AudioBars from "./AudioBars.jsx";
import { PlayHomeSkeleton } from "./ui/Skeleton.jsx";
import { ensurePlayAnalyser } from "../lib/playAnalyser.js";
import {
  bindMediaSession,
  cyclePlayRepeat,
  getPlayAudio,
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
import {
  bootstrapLibraryFromCache,
  prefetchLibrary,
  writeLibraryCache,
} from "../lib/libraryCache.js";

const RECENT_KEY = "sonozz-play-recent";

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
    q: p.get("q") || "",
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

function readRecentIds() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function pushRecentId(id) {
  if (!id || typeof localStorage === "undefined") return;
  const next = [String(id), ...readRecentIds().filter((x) => x !== String(id))].slice(0, 24);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function CoverThumb({ src, class: cls = "", rounded = "rounded", eager = false }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        class={`object-cover ${rounded} ${cls}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    );
  }
  return (
    <div class={`flex items-center justify-center bg-base-300 ${rounded} ${cls}`}>
      <Disc3 size={22} class="opacity-35" />
    </div>
  );
}

export default function PlayerPage() {
  const seekRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });
  const searchInputRef = useRef(null);
  const boot = bootstrapLibraryFromCache();

  const [tracks, setTracks] = useState(boot.tracks);
  const [artists, setArtists] = useState(boot.artists);
  const [loading, setLoading] = useState(!boot.fromCache);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("home");
  const [filterArtist, setFilterArtist] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentIds, setRecentIds] = useState([]);
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

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let id = localStorage.getItem("sonozz-player-id");
    if (!id) {
      id = `player_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("sonozz-player-id", id);
    }
    setPlayerId(id);
    setRecentIds(readRecentIds());
    try {
      localStorage.removeItem("sonozz-play-car");
    } catch {
      /* ignore */
    }
    delete document.documentElement.dataset.playCar;
  }, []);

  const queue = session.queue || [];
  const index = session.index || 0;
  const playing = Boolean(session.playing);
  const shuffle = Boolean(session.shuffle);
  const repeat = session.repeat || "off";
  const current = currentPlayTrack(session);

  useEffect(() => {
    if (!current) {
      setDuration(0);
      setCurrentTime(0);
      setAudioError("");
      return;
    }
    if (current.duration && Number.isFinite(current.duration) && current.duration > 0) {
      setDuration(current.duration);
    }
    pushRecentId(current.id);
    setRecentIds(readRecentIds());
  }, [current?.id]);

  const visibleTracks = useMemo(() => {
    let list = filterArtist ? tracks.filter((t) => t.slug === filterArtist) : tracks;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          String(t.trackTitle || "").toLowerCase().includes(q) ||
          String(t.artistName || "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [tracks, filterArtist, searchQuery]);

  const artistGroups = useMemo(
    () =>
      artists
        .map((a) => ({
          ...a,
          trackCount: tracks.filter((t) => t.slug === a.slug).length,
          cover:
            a.profile?.imageUrl ||
            tracks.find((t) => t.slug === a.slug)?.coverUrl ||
            tracks.find((t) => t.slug === a.slug)?.artistImage ||
            "",
        }))
        .filter((a) => a.trackCount > 0),
    [artists, tracks],
  );

  const recentTracks = useMemo(() => {
    const byId = new Map(tracks.map((t) => [String(t.id), t]));
    const fromRecent = recentIds.map((id) => byId.get(String(id))).filter(Boolean);
    const limit = 6;
    if (fromRecent.length >= limit) return fromRecent.slice(0, limit);
    const rest = tracks.filter((t) => !fromRecent.some((r) => r.id === t.id));
    return [...fromRecent, ...rest].slice(0, limit);
  }, [tracks, recentIds]);

  const filteredArtists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return artistGroups;
    return artistGroups.filter((a) => String(a.name || "").toLowerCase().includes(q));
  }, [artistGroups, searchQuery]);

  useEffect(() => subscribePlaySession(setSession), []);

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

  useEffect(() => {
    const q = readQuery();
    if (q.artist) {
      setFilterArtist(q.artist);
      setTab("library");
    }
    if (q.q) {
      setSearchQuery(q.q);
      setTab("search");
    }

    const applyDeepLink = (list) => {
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
    };

    if (boot.tracks.length) {
      applyDeepLink(boot.tracks);
      setLoading(false);
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await prefetchLibrary();
        if (cancelled) return;
        const list = data.tracks || [];
        setTracks(list);
        setArtists(data.artists || []);
        if (list.length) writeLibraryCache(list, data.artists || []);
        if (!boot.tracks.length) applyDeepLink(list);
      } catch (e) {
        if (cancelled) return;
        if (!boot.tracks.length) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = getPlayAudio();
    if (!el) return;
    const onTime = () => {
      if (seekingRef.current) return;
      setCurrentTime(el.currentTime || 0);
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

  useEffect(() => {
    if (!current?.id || !playerId || expanded) {
      if (expanded) {
        setTrackRating(null);
        setRatingStats(null);
      }
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/ratings?trackId=${encodeURIComponent(current.id)}&playerId=${encodeURIComponent(playerId)}`,
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setTrackRating(data.userRating);
        setRatingStats(data.stats);
      } catch {
        /* ignore */
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [current?.id, playerId, expanded]);

  useEffect(() => {
    if (tab === "search" && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [tab]);

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

  function playList(list, startId = null) {
    if (!list.length) return;
    const ordered = shuffle ? shuffleCopy(list) : [...list];
    let i = 0;
    if (startId) {
      const found = ordered.findIndex((t) => t.id === startId);
      if (found >= 0) i = found;
    }
    startPlayback({ queue: ordered, index: i, shuffle, repeat });
    setExpanded(true);
  }

  function playArtist(slug) {
    const list = tracks.filter((t) => t.slug === slug);
    setFilterArtist(slug);
    setTab("library");
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
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  function clearArtistFilter() {
    setFilterArtist("");
    const url = new URL(location.href);
    url.searchParams.delete("artist");
    history.replaceState({}, "", url.pathname + url.search);
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const cover = current?.coverUrl || current?.artistImage || null;

  function TrackRows({ list, empty }) {
    return (
      <ul class="divide-y divide-base-content/6">
        {list.map((t, i) => {
          const isCurrent = current?.id === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                class={`flex w-full min-h-[4.5rem] items-center gap-3 px-2 text-left touch-manipulation transition active:bg-base-content/10 sm:min-h-[5rem] sm:gap-4 sm:px-3 ${
                  isCurrent ? "bg-primary/12" : "hover:bg-base-content/5"
                }`}
                onClick={() => playTrack(t, list)}
              >
                <span
                  class={`w-7 shrink-0 text-center text-sm tabular-nums ${
                    isCurrent ? "text-primary" : "text-base-content/35"
                  }`}
                >
                  {isCurrent && playing ? (
                    <AudioBars playing bars={3} class="mx-auto" />
                  ) : (
                    i + 1
                  )}
                </span>
                <CoverThumb
                  src={t.coverUrl || t.artistImage}
                  class="h-12 w-12 shrink-0 sm:h-14 sm:w-14"
                  rounded="rounded"
                />
                <div class="min-w-0 flex-1">
                  <p
                    class={`truncate text-base font-semibold sm:text-lg ${
                      isCurrent ? "text-primary" : ""
                    }`}
                  >
                    {t.trackTitle}
                  </p>
                  <p class="truncate text-sm text-base-content/50">{t.artistName}</p>
                </div>
                <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base-content/55 sm:h-14 sm:w-14 sm:bg-primary/15 sm:text-primary">
                  {isCurrent && playing ? (
                    <Pause size={24} fill="currentColor" />
                  ) : (
                    <Play size={24} fill="currentColor" />
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li class="px-4 py-14 text-center text-base text-base-content/45">{empty}</li>
        )}
      </ul>
    );
  }

  const tabs = [
    { id: "home", label: "Accueil", icon: Home },
    { id: "search", label: "Recherche", icon: Search },
    { id: "library", label: "Bibliothèque", icon: Library },
  ];

  return (
    <AppShell active="play" fillViewport playFocused>
      <div class="play-shell relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && (
          <div class="flex min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
            <PlayHomeSkeleton />
          </div>
        )}
        {error && <p class="mb-2 shrink-0 px-4 text-error sm:px-6">{error}</p>}
        {audioError && <p class="mb-2 shrink-0 px-4 text-sm text-warning sm:px-6">{audioError}</p>}

        {!loading && (
          <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-6">
              {tab === "home" && (
                <div class="mx-auto w-full max-w-5xl space-y-7 sm:space-y-8">
                  <header class="flex items-end justify-between gap-3">
                    <h1
                      class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl"
                      data-play-rev="2026-09-16"
                    >
                      Écouter
                    </h1>
                    {queue.length > 0 && (
                      <button
                        type="button"
                        class="btn btn-ghost btn-md gap-2 cursor-pointer touch-manipulation sm:btn-lg sm:min-h-14"
                        onClick={() => setExpanded(true)}
                      >
                        <ListMusic size={20} />
                        File
                      </button>
                    )}
                  </header>

                  {tracks.length > 0 && (
                    <Pressable
                      type="button"
                      class="play-shuffle-cta flex min-h-[5.5rem] w-full cursor-pointer items-center gap-4 rounded-2xl bg-primary px-5 py-4 text-left text-primary-content shadow-xl shadow-primary/25 touch-manipulation sm:min-h-[6rem] sm:px-6"
                      scale={0.98}
                      onClick={() => {
                        if (!shuffle) setPlayShuffle(true, current);
                        playList(shuffleCopy(tracks));
                      }}
                    >
                      <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary-content/20 sm:h-16 sm:w-16">
                        <Shuffle size={28} />
                      </span>
                      <span class="min-w-0 flex-1">
                        <span class="font-display block text-xl font-extrabold sm:text-2xl md:text-3xl">
                          Lecture aléatoire
                        </span>
                        <span class="block text-sm opacity-80 sm:text-base">
                          {tracks.length} titre{tracks.length > 1 ? "s" : ""} · un tap
                        </span>
                      </span>
                      <Play size={36} fill="currentColor" class="shrink-0" />
                    </Pressable>
                  )}

                  {recentTracks.length > 0 && (
                    <section>
                      <div class="mb-3 flex items-end justify-between gap-3">
                        <h2 class="font-display text-xl font-bold sm:text-2xl md:text-3xl">Récents</h2>
                        <button
                          type="button"
                          class="min-h-11 cursor-pointer px-2 text-sm font-semibold text-primary touch-manipulation sm:text-base"
                          onClick={() => {
                            setFilterArtist("");
                            setTab("library");
                          }}
                        >
                          Tout voir
                        </button>
                      </div>
                      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                        {recentTracks.map((t, idx) => {
                          const isCurrent = current?.id === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              class={`group flex min-h-[4.75rem] cursor-pointer items-center gap-0 overflow-hidden rounded-md bg-base-300/70 text-left touch-manipulation transition duration-200 hover:bg-base-300 hover:scale-[1.01] active:bg-base-300 sm:min-h-[5.25rem] ${
                                isCurrent ? "ring-1 ring-primary/40" : ""
                              }`}
                              onClick={() => playTrack(t, recentTracks)}
                            >
                              <CoverThumb
                                src={t.coverUrl || t.artistImage}
                                class="h-[4.75rem] w-[4.75rem] shrink-0 sm:h-[5.25rem] sm:w-[5.25rem]"
                                rounded="rounded-none"
                                eager={idx < 4}
                              />
                              <span class="min-w-0 flex-1 px-3 py-2 sm:px-4">
                                <span
                                  class={`block truncate text-base font-bold sm:text-lg ${
                                    isCurrent ? "text-primary" : ""
                                  }`}
                                >
                                  {t.trackTitle}
                                </span>
                                <span class="mt-0.5 block truncate text-sm text-base-content/50">
                                  {t.artistName}
                                </span>
                              </span>
                              <span class="mr-3 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content shadow-md sm:h-14 sm:w-14">
                                {isCurrent && playing ? (
                                  <Pause size={22} fill="currentColor" />
                                ) : (
                                  <Play size={22} fill="currentColor" />
                                )}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  {artistGroups.length > 0 && (
                    <section>
                      <h2 class="mb-3 font-display text-xl font-bold sm:text-2xl md:text-3xl">
                        Artistes
                      </h2>
                      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                        {artistGroups.map((a) => (
                          <button
                            key={a.slug}
                            type="button"
                            class="flex min-h-[8rem] cursor-pointer flex-col items-center gap-2.5 rounded-2xl bg-base-300/50 p-3 text-center touch-manipulation transition duration-200 hover:scale-[1.02] hover:bg-base-300 active:bg-base-300 sm:min-h-[9rem] sm:p-4"
                            onClick={() => playArtist(a.slug)}
                          >
                            <CoverThumb
                              src={a.cover}
                              class="h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24"
                              rounded="rounded-full"
                            />
                            <span class="line-clamp-2 text-sm font-bold leading-tight sm:text-base">
                              {a.name}
                            </span>
                            <span class="text-xs text-base-content/45">
                              {a.trackCount} titre{a.trackCount > 1 ? "s" : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {!tracks.length && (
                    <p class="py-16 text-center text-base text-base-content/45">
                      Aucun titre audio pour l’instant.
                    </p>
                  )}
                </div>
              )}

              {tab === "search" && (
                <div class="mx-auto w-full max-w-3xl space-y-5">
                  <h1 class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                    Recherche
                  </h1>
                  <label class="relative block">
                    <span class="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-base-content/40">
                      <Search size={20} />
                    </span>
                    <input
                      ref={searchInputRef}
                      type="search"
                      value={searchQuery}
                      placeholder="Titres, artistes…"
                      class="input input-md h-14 w-full rounded-full border-base-content/10 bg-base-300/80 pl-12 pr-12 text-base focus:border-primary/40 focus:outline-none sm:h-16 sm:text-lg"
                      onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        class="absolute right-2 top-1/2 btn btn-ghost btn-circle h-11 w-11 -translate-y-1/2 touch-manipulation"
                        aria-label="Effacer"
                        onClick={() => setSearchQuery("")}
                      >
                        <X size={18} />
                      </button>
                    )}
                  </label>

                  {!searchQuery.trim() && (
                    <p class="text-base text-base-content/45">
                      Tape un titre ou un artiste pour filtrer le catalogue.
                    </p>
                  )}

                  {searchQuery.trim() && (
                    <>
                      {filteredArtists.length > 0 && (
                        <section>
                          <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/45">
                            Artistes
                          </h2>
                          <div class="flex gap-3 overflow-x-auto pb-1">
                            {filteredArtists.map((a) => (
                              <button
                                key={a.slug}
                                type="button"
                                class="flex min-h-14 shrink-0 items-center gap-3 rounded-full bg-base-300/60 pl-2 pr-4 touch-manipulation active:bg-base-300 sm:min-h-16"
                                onClick={() => playArtist(a.slug)}
                              >
                                <CoverThumb
                                  src={a.cover}
                                  class="h-10 w-10 sm:h-12 sm:w-12"
                                  rounded="rounded-full"
                                />
                                <span class="text-sm font-semibold sm:text-base">{a.name}</span>
                              </button>
                            ))}
                          </div>
                        </section>
                      )}
                      <section>
                        <h2 class="mb-2 text-sm font-semibold uppercase tracking-wide text-base-content/45">
                          Titres
                        </h2>
                        <TrackRows list={visibleTracks} empty="Aucun résultat pour cette recherche." />
                      </section>
                    </>
                  )}
                </div>
              )}

              {tab === "library" && (
                <div class="mx-auto w-full max-w-4xl space-y-5">
                  <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h1 class="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
                        {filterArtist
                          ? artistGroups.find((a) => a.slug === filterArtist)?.name || "Artiste"
                          : "Bibliothèque"}
                      </h1>
                      <p class="mt-1 text-sm text-base-content/50 sm:text-base">
                        {visibleTracks.length} titre{visibleTracks.length > 1 ? "s" : ""}
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      {filterArtist && (
                        <button
                          type="button"
                          class="btn btn-ghost btn-md touch-manipulation sm:btn-lg sm:min-h-14"
                          onClick={clearArtistFilter}
                        >
                          Tous les titres
                        </button>
                      )}
                      <button
                        type="button"
                        class="btn btn-primary btn-md gap-2 touch-manipulation sm:btn-lg sm:min-h-14 sm:px-6"
                        disabled={!visibleTracks.length}
                        onClick={() => playList(visibleTracks)}
                      >
                        <Play size={18} fill="currentColor" /> Tout lire
                      </button>
                    </div>
                  </div>

                  {!filterArtist && artistGroups.length > 0 && (
                    <div class="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 sm:gap-4">
                      {artistGroups.map((a) => (
                        <button
                          key={a.slug}
                          type="button"
                          class="flex w-24 shrink-0 flex-col items-center gap-2 touch-manipulation sm:w-28"
                          onClick={() => setFilterArtist(a.slug)}
                        >
                          <CoverThumb
                            src={a.cover}
                            class="h-20 w-20 sm:h-24 sm:w-24"
                            rounded="rounded-full"
                          />
                          <span class="line-clamp-2 text-center text-xs font-semibold leading-tight sm:text-sm">
                            {a.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <TrackRows
                    list={visibleTracks}
                    empty="Aucun titre — génère ou importe un morceau dans le Studio."
                  />
                </div>
              )}
            </div>

            <nav
              class="play-bottom-nav shrink-0 border-t border-base-content/10 bg-base-200/95 backdrop-blur-md"
              aria-label="Navigation lecteur"
            >
              <div class="mx-auto grid min-h-16 max-w-3xl grid-cols-3 sm:min-h-[4.5rem]">
                {tabs.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      class={`flex flex-col items-center justify-center gap-1 touch-manipulation transition ${
                        active ? "text-primary" : "text-base-content/45 active:text-base-content/70"
                      }`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        if (t.id === "library") setFilterArtist("");
                        setTab(t.id);
                      }}
                    >
                      <Icon size={24} strokeWidth={active ? 2.4 : 2} />
                      <span class="text-xs font-semibold sm:text-sm">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </div>
        )}
      </div>

      {current && expanded && (
        <FadeIn
          class="play-now-overlay fixed inset-0 z-50 flex flex-col overflow-hidden bg-base-200"
          y={0}
          duration={0.35}
        >
          {cover ? (
            <div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
              <img src={cover} alt="" class="play-now-blur h-full w-full object-cover" />
              <div class="absolute inset-0 bg-base-200/85" />
              <div class="absolute inset-0 bg-gradient-to-b from-base-200/50 via-base-200/70 to-base-200" />
            </div>
          ) : null}

          <div class="relative z-[1] flex h-14 shrink-0 items-center justify-between px-2 pt-[env(safe-area-inset-top)] sm:h-16 sm:px-4">
            <button
              type="button"
              class="btn btn-ghost btn-square h-12 min-h-12 w-12 min-w-12 touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14"
              aria-label="Réduire"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={28} />
            </button>
            <p class="font-display flex items-center gap-2 text-xs font-bold tracking-[0.18em] text-base-content/55 sm:text-sm">
              EN LECTURE
              {playing ? <AudioBars playing bars={5} tall class="ml-1" /> : null}
            </p>
            <button
              type="button"
              class="btn btn-ghost btn-square h-12 min-h-12 w-12 min-w-12 touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14"
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setTab("library");
              }}
            >
              <ListMusic size={22} />
            </button>
          </div>

          <div class="relative z-[1] flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-6 sm:px-8 lg:flex-row lg:items-center lg:justify-center lg:gap-12 lg:px-12 xl:gap-16">
            <div
              class="flex w-full max-w-[min(100%,22rem)] shrink-0 touch-manipulation select-none justify-center sm:max-w-[min(100%,26rem)] lg:max-w-[min(42vw,28rem)] xl:max-w-[min(40vw,32rem)]"
              onTouchStart={onCoverTouchStart}
              onTouchEnd={onCoverTouchEnd}
            >
              <div
                class={`aspect-square w-full overflow-hidden rounded-xl shadow-2xl shadow-black/50 ring-1 ring-base-content/10 ${
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
                    decoding="async"
                  />
                ) : (
                  <div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary/40 to-base-300">
                    <Disc3 size={72} class={`opacity-30 ${playing ? "animate-pulse-soft" : ""}`} />
                  </div>
                )}
              </div>
            </div>

            <div class="flex w-full max-w-xl shrink-0 flex-col lg:max-w-lg xl:max-w-xl">
              <div class="py-2 text-center lg:py-3 lg:text-left">
                <h2 class="font-display line-clamp-2 text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                  {current.trackTitle}
                </h2>
                <p class="mt-1 truncate text-base text-base-content/60 sm:text-lg">
                  {current.artistName}
                </p>
              </div>

              {playerId && (
                <div class="mb-2 hidden flex-col items-center gap-1 sm:flex lg:items-start">
                  <div class="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        class="btn btn-ghost btn-circle btn-md touch-manipulation"
                        onClick={() => rateTrack(star)}
                        disabled={ratingBusy}
                        aria-label={`Noter ${star} étoile${star > 1 ? "s" : ""}`}
                      >
                        <Star
                          size={20}
                          fill={trackRating && star <= trackRating ? "currentColor" : "none"}
                          class={
                            trackRating && star <= trackRating
                              ? "text-warning"
                              : "text-base-content/30"
                          }
                        />
                      </button>
                    ))}
                  </div>
                  {ratingStats && ratingStats.count > 0 && (
                    <p class="text-xs text-base-content/45">
                      {ratingStats.average.toFixed(1)} / 5 · {ratingStats.count} note
                      {ratingStats.count > 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              )}

              <div>
                <div
                  ref={seekRef}
                  class="relative h-12 cursor-pointer touch-manipulation sm:h-14"
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
                  <div class="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-base-content/20 sm:h-2.5">
                    <div class="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                  <div
                    class="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-base-content shadow-md sm:h-6 sm:w-6"
                    style={{ left: `${progress}%` }}
                  />
                </div>
                <div class="flex justify-between text-sm tabular-nums text-base-content/50">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div class="mt-2 flex items-center justify-between gap-2 py-2 sm:mt-3 sm:gap-3">
                <button
                  type="button"
                  class={`btn btn-ghost btn-square h-12 min-h-12 w-12 min-w-12 touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14 ${
                    shuffle ? "text-primary" : "text-base-content/50"
                  }`}
                  aria-label="Aléatoire"
                  aria-pressed={shuffle}
                  onClick={() => setPlayShuffle(!shuffle, current)}
                >
                  <Shuffle size={24} />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle h-14 min-h-14 w-14 min-w-14 cursor-pointer touch-manipulation sm:h-16 sm:min-h-16 sm:w-16 sm:min-w-16"
                  aria-label="Précédent"
                  onClick={goPrev}
                >
                  <SkipBack size={30} fill="currentColor" />
                </button>
                <Pressable
                  type="button"
                  class="btn btn-primary btn-circle h-18 w-18 min-h-[4.5rem] min-w-[4.5rem] cursor-pointer touch-manipulation shadow-xl shadow-primary/30 sm:h-20 sm:w-20 sm:min-h-20 sm:min-w-20"
                  aria-label={playing ? "Pause" : "Lecture"}
                  onClick={() => {
                    ensurePlayAnalyser();
                    togglePlay();
                  }}
                >
                  {playing ? (
                    <Pause size={34} fill="currentColor" />
                  ) : (
                    <Play size={34} fill="currentColor" class="ml-1" />
                  )}
                </Pressable>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle h-14 min-h-14 w-14 min-w-14 cursor-pointer touch-manipulation sm:h-16 sm:min-h-16 sm:w-16 sm:min-w-16"
                  aria-label="Suivant"
                  onClick={goNext}
                >
                  <SkipForward size={30} fill="currentColor" />
                </button>
                <button
                  type="button"
                  class={`btn btn-ghost btn-square h-12 min-h-12 w-12 min-w-12 cursor-pointer touch-manipulation sm:h-14 sm:min-h-14 sm:w-14 sm:min-w-14 ${
                    repeat !== "off" ? "text-primary" : "text-base-content/50"
                  }`}
                  aria-label="Répéter"
                  onClick={() => cyclePlayRepeat()}
                >
                  {repeat === "one" ? <Repeat1 size={24} /> : <Repeat size={24} />}
                </button>
              </div>
            </div>
          </div>
        </FadeIn>
      )}
    </AppShell>
  );
}
