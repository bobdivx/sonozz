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
  Users,
  Music2,
  ChevronDown,
  ChevronLeft,
  Disc3,
  Star,
  Heart,
  Car,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
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

const RECENT_KEY = "sonozz-play-recent";
const LIBRARY_CACHE_KEY = "sonozz-play-library-v1";
const CAR_MODE_KEY = "sonozz-play-car";
const CACHE_TTL_MS = 10 * 60 * 1000;

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
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

function readLibraryCache() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.tracks)) return null;
    if (Date.now() - (data.ts || 0) > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeLibraryCache(tracks, artists) {
  try {
    localStorage.setItem(
      LIBRARY_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), tracks, artists }),
    );
  } catch {
    /* quota */
  }
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

function bootstrapLibrary(initialTracks, initialArtists) {
  if (Array.isArray(initialTracks) && initialTracks.length) {
    return {
      tracks: initialTracks,
      artists: Array.isArray(initialArtists) ? initialArtists : [],
      loading: false,
    };
  }
  if (typeof window !== "undefined") {
    const cached = readLibraryCache();
    if (cached) {
      return {
        tracks: cached.tracks,
        artists: cached.artists || [],
        loading: false,
      };
    }
  }
  return { tracks: [], artists: [], loading: true };
}

export default function PlayerPage({ initialTracks = [], initialArtists = [] }) {
  const seekRef = useRef(null);
  const touchRef = useRef({ x: 0, y: 0 });
  const boot = bootstrapLibrary(initialTracks, initialArtists);

  const [tracks, setTracks] = useState(boot.tracks);
  const [artists, setArtists] = useState(boot.artists);
  const [loading, setLoading] = useState(boot.loading);
  const [error, setError] = useState("");
  const [view, setView] = useState("home");
  const [filterArtist, setFilterArtist] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentIds, setRecentIds] = useState([]);
  const [carMode, setCarMode] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(CAR_MODE_KEY) === "1";
  });
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
    if (fromRecent.length >= 6) return fromRecent.slice(0, 12);
    const rest = tracks.filter((t) => !fromRecent.some((r) => r.id === t.id));
    return [...fromRecent, ...rest].slice(0, 12);
  }, [tracks, recentIds]);

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
    localStorage.setItem(CAR_MODE_KEY, carMode ? "1" : "0");
    document.documentElement.dataset.playCar = carMode ? "1" : "";
    return () => {
      document.documentElement.dataset.playCar = "";
    };
  }, [carMode]);

  useEffect(() => {
    const q = readQuery();
    if (q.artist) {
      setFilterArtist(q.artist);
      setView("titres");
    }
    if (q.q) {
      setSearchQuery(q.q);
      setView("titres");
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
      writeLibraryCache(boot.tracks, boot.artists);
      applyDeepLink(boot.tracks);
      setLoading(false);
      // Refresh en arrière-plan sans bloquer l’UI
      fetch("/api/library")
        .then((res) => res.json().then((data) => ({ res, data })))
        .then(({ res, data }) => {
          if (!res.ok) return;
          const list = data.tracks || [];
          setTracks(list);
          setArtists(data.artists || []);
          writeLibraryCache(list, data.artists || []);
        })
        .catch(() => {});
      return;
    }

    (async () => {
      try {
        const res = await fetch("/api/library");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Impossible de charger la bibliothèque");
        const list = data.tracks || [];
        setTracks(list);
        setArtists(data.artists || []);
        writeLibraryCache(list, data.artists || []);
        applyDeepLink(list);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
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
    if (carMode || !current?.id || !playerId) {
      setTrackRating(null);
      setRatingStats(null);
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
  }, [current?.id, playerId, carMode]);

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
    if (expand || carMode) setExpanded(true);
  }

  function playArtist(slug) {
    const list = tracks.filter((t) => t.slug === slug);
    setFilterArtist(slug);
    playList(list, null, { expand: carMode });
  }

  function playTrack(track, fromList = null) {
    const list = fromList || visibleTracks;
    const base = list.some((t) => t.id === track.id) ? list : [track, ...list];
    playList(base, track.id, { expand: carMode });
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
    const minSwipe = carMode ? 40 : 56;
    if (Math.abs(dx) < minSwipe || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0) goNext();
    else goPrev();
  }

  function cycleRepeat() {
    cyclePlayRepeat();
  }

  function toggleShuffle() {
    setPlayShuffle(!shuffle, current);
  }

  function clearSearch() {
    setSearchQuery("");
    setFilterArtist("");
    setView("home");
    const url = new URL(location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("artist");
    history.replaceState({}, "", url.pathname + url.search);
  }

  function toggleCarMode() {
    setCarMode((v) => {
      const next = !v;
      if (next && current) setExpanded(true);
      return next;
    });
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const cover = current?.coverUrl || current?.artistImage || null;
  const showHome = view === "home" && !searchQuery && !filterArtist;

  const quickAccess = [];
  if (tracks.length) {
    quickAccess.push({
      id: "all",
      title: "Tous les titres",
      subtitle: `${tracks.length} morceau${tracks.length > 1 ? "x" : ""}`,
      cover: tracks[0]?.coverUrl || tracks[0]?.artistImage || "",
      onClick: () => playList(tracks, null, { expand: true }),
    });
  }
  if (tracks.length) {
    quickAccess.push({
      id: "shuffle-all",
      title: "Lecture aléatoire",
      subtitle: "Tout le catalogue",
      cover: recentTracks[0]?.coverUrl || tracks[0]?.coverUrl || "",
      onClick: () => {
        const wasShuffle = shuffle;
        if (!wasShuffle) setPlayShuffle(true, current);
        playList(shuffleCopy(tracks), null, { expand: true });
      },
    });
  }
  if (queue.length) {
    quickAccess.push({
      id: "queue",
      title: "File d’attente",
      subtitle: `${queue.length} en file`,
      cover: queue[0]?.coverUrl || queue[0]?.artistImage || "",
      onClick: () => setView("file"),
    });
  }
  for (const a of artistGroups.slice(0, 6)) {
    quickAccess.push({
      id: `artist-${a.slug}`,
      title: a.name,
      subtitle: `${a.trackCount} titre${a.trackCount > 1 ? "s" : ""}`,
      cover: a.cover,
      onClick: () => playArtist(a.slug),
    });
  }
  const quickCards = quickAccess.slice(0, carMode ? 6 : 8);

  const dailyMixes = artistGroups.slice(0, 3).map((a, i) => ({
    id: `mix-${a.slug}`,
    title: `Mix ${i + 1}`,
    subtitle: a.name,
    cover: a.cover,
    gradient: [
      "from-primary/50 via-base-300 to-secondary/40",
      "from-secondary/50 via-base-300 to-accent/35",
      "from-accent/45 via-base-300 to-primary/40",
    ][i % 3],
    onClick: () => playArtist(a.slug),
  }));
  if (dailyMixes.length < 3 && tracks.length) {
    dailyMixes.push({
      id: "mix-all",
      title: `Mix ${dailyMixes.length + 1}`,
      subtitle: "Tout le catalogue",
      cover: tracks[0]?.coverUrl || "",
      gradient: "from-primary/40 via-base-300 to-base-100",
      onClick: () => playList(shuffleCopy(tracks), null, { expand: true }),
    });
  }
  const mixes = dailyMixes.slice(0, 3);

  const rowMin = carMode ? "min-h-[4.5rem]" : "min-h-14 sm:min-h-16";
  const coverSize = carMode ? "h-14 w-14" : "h-12 w-12";

  function TrackList({ list, empty }) {
    return (
      <ul class="min-h-0 flex-1 divide-y divide-base-content/8 overflow-y-auto overscroll-contain rounded-xl bg-base-300/25">
        {list.map((t, i) => {
          const isCurrent = current?.id === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                class={`flex w-full ${rowMin} items-center gap-3 px-3 py-2.5 text-left touch-manipulation transition hover:bg-base-content/5 active:bg-base-content/10 sm:gap-4 sm:px-4 ${
                  isCurrent ? "bg-primary/10" : ""
                }`}
                onClick={() => playTrack(t, list)}
              >
                <span class="w-6 shrink-0 text-center text-xs text-base-content/40">
                  {isCurrent && playing ? (
                    <span class="inline-block h-2.5 w-2.5 animate-pulse-soft rounded-full bg-primary" />
                  ) : (
                    i + 1
                  )}
                </span>
                <CoverThumb
                  src={t.coverUrl || t.artistImage}
                  class={`${coverSize} shrink-0`}
                  rounded="rounded"
                />
                <div class="min-w-0 flex-1">
                  <p
                    class={`truncate font-semibold ${carMode ? "text-base" : "text-sm sm:text-base"} ${
                      isCurrent ? "text-primary" : ""
                    }`}
                  >
                    {t.trackTitle}
                  </p>
                  <p class={`truncate text-base-content/50 ${carMode ? "text-sm" : "text-xs"}`}>
                    {t.artistName}
                  </p>
                </div>
                <span
                  class={`flex shrink-0 items-center justify-center text-base-content/60 ${
                    carMode ? "h-12 w-12" : "h-10 w-10"
                  }`}
                >
                  {isCurrent && playing ? <Pause size={carMode ? 24 : 20} /> : <Play size={carMode ? 24 : 20} />}
                </span>
              </button>
            </li>
          );
        })}
        {!list.length && (
          <li class="px-4 py-10 text-center text-sm text-base-content/50">{empty}</li>
        )}
      </ul>
    );
  }

  const carToggle = (
    <button
      type="button"
      class={`btn gap-2 touch-manipulation ${
        carMode
          ? "btn-primary btn-sm sm:btn-md"
          : "btn-ghost btn-sm border border-base-content/15"
      }`}
      aria-pressed={carMode}
      aria-label={carMode ? "Quitter le mode voiture" : "Mode voiture"}
      onClick={toggleCarMode}
    >
      <Car size={18} />
      <span class="hidden sm:inline">{carMode ? "Voiture" : "Mode voiture"}</span>
    </button>
  );

  return (
    <AppShell
      active="play"
      fillViewport
      playFocused={carMode}
      hideSearch={carMode}
      actions={carToggle}
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {loading && (
          <div class="flex min-h-0 flex-1 items-center justify-center">
            <span class="loading loading-spinner loading-lg text-primary" />
          </div>
        )}
        {error && <p class="mb-2 shrink-0 text-error">{error}</p>}
        {audioError && <p class="mb-2 shrink-0 text-sm text-warning">{audioError}</p>}

        {!loading && showHome && (
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4 animate-rise">
            <div class="mb-4 flex items-center justify-between gap-3 sm:mb-5">
              <h1
                class={`font-display font-extrabold tracking-tight ${
                  carMode ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl md:text-4xl"
                }`}
              >
                {greeting()}
              </h1>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class={`btn btn-ghost touch-manipulation ${carMode ? "btn-lg btn-square" : "btn-circle btn-sm"} text-base-content/55`}
                  aria-label="Tous les titres"
                  onClick={() => setView("titres")}
                >
                  <Music2 size={carMode ? 22 : 18} />
                </button>
                <button
                  type="button"
                  class={`btn btn-ghost touch-manipulation ${carMode ? "btn-lg btn-square" : "btn-circle btn-sm"} text-base-content/55`}
                  aria-label="Artistes"
                  onClick={() => setView("artistes")}
                >
                  <Users size={carMode ? 22 : 18} />
                </button>
              </div>
            </div>

            {carMode && tracks.length > 0 && (
              <section class="mb-6">
                <button
                  type="button"
                  class="flex w-full min-h-[5.5rem] items-center gap-4 rounded-2xl bg-primary px-5 py-4 text-left text-primary-content shadow-lg shadow-primary/30 touch-manipulation active:scale-[0.99]"
                  onClick={() => playList(shuffleCopy(tracks), null, { expand: true })}
                >
                  <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-content/20">
                    <Shuffle size={28} />
                  </span>
                  <span class="min-w-0">
                    <span class="block font-display text-xl font-extrabold">Lecture aléatoire</span>
                    <span class="block text-sm opacity-80">{tracks.length} titres · un tap</span>
                  </span>
                  <Play size={32} fill="currentColor" class="ml-auto shrink-0" />
                </button>
              </section>
            )}

            {quickCards.length > 0 && (
              <section class="mb-8">
                <div
                  class={`grid gap-2 ${
                    carMode
                      ? "grid-cols-1 sm:grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
                  }`}
                >
                  {quickCards.map((card, idx) => (
                    <button
                      key={card.id}
                      type="button"
                      class={`group flex items-center gap-0 overflow-hidden rounded-md bg-base-300/70 text-left transition hover:bg-base-300 active:bg-base-300 touch-manipulation ${
                        carMode ? "min-h-[4.75rem]" : ""
                      }`}
                      onClick={card.onClick}
                    >
                      <CoverThumb
                        src={card.cover}
                        class={carMode ? "h-16 w-16 shrink-0 sm:h-[4.75rem] sm:w-[4.75rem]" : "h-14 w-14 shrink-0 sm:h-16 sm:w-16"}
                        rounded="rounded-none"
                        eager={idx < 4}
                      />
                      <span class={`min-w-0 flex-1 px-3 ${carMode ? "py-3" : "py-2"}`}>
                        <span
                          class={`block truncate font-bold ${carMode ? "text-base sm:text-lg" : "text-sm sm:text-base"}`}
                        >
                          {card.title}
                        </span>
                        <span class={`block truncate text-base-content/50 ${carMode ? "text-sm" : "text-xs"}`}>
                          {card.subtitle}
                        </span>
                      </span>
                      <span
                        class={`mr-3 flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-content shadow-lg ${
                          carMode
                            ? "h-12 w-12 opacity-100"
                            : "h-10 w-10 opacity-0 transition group-hover:opacity-100"
                        }`}
                      >
                        <Play size={carMode ? 20 : 18} fill="currentColor" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section class="mb-8">
              <div class="mb-3 flex items-end justify-between gap-3">
                <h2 class={`font-display font-bold ${carMode ? "text-2xl" : "text-xl sm:text-2xl"}`}>
                  Récemment écoutés
                </h2>
                <button
                  type="button"
                  class="text-sm font-medium text-primary touch-manipulation hover:underline"
                  onClick={() => setView("titres")}
                >
                  Voir tout
                </button>
              </div>
              <div class={`-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 ${carMode ? "gap-4" : "sm:gap-4"}`}>
                {recentTracks.map((t, idx) => (
                  <button
                    key={t.id}
                    type="button"
                    class={`group shrink-0 text-left touch-manipulation ${carMode ? "w-40 sm:w-44" : "w-32 sm:w-36"}`}
                    onClick={() => playTrack(t, recentTracks)}
                  >
                    <div class="relative aspect-square overflow-hidden rounded-md bg-base-300 shadow-md shadow-black/25">
                      <CoverThumb
                        src={t.coverUrl || t.artistImage}
                        class="h-full w-full transition duration-300 group-hover:scale-[1.03]"
                        rounded="rounded-none"
                        eager={idx < 3}
                      />
                      <span
                        class={`absolute bottom-2 right-2 flex items-center justify-center rounded-full bg-primary text-primary-content shadow-lg ${
                          carMode
                            ? "h-12 w-12 opacity-100"
                            : "h-10 w-10 opacity-0 transition group-hover:opacity-100"
                        }`}
                      >
                        <Play size={carMode ? 20 : 18} fill="currentColor" />
                      </span>
                    </div>
                    <p class={`mt-2 truncate font-semibold ${carMode ? "text-base" : "text-sm"}`}>
                      {t.trackTitle}
                    </p>
                    <p class={`truncate text-base-content/50 ${carMode ? "text-sm" : "text-xs"}`}>
                      {t.artistName}
                    </p>
                  </button>
                ))}
                {!recentTracks.length && (
                  <p class="py-6 text-sm text-base-content/45">Aucun titre audio pour l’instant.</p>
                )}
              </div>
            </section>

            {!carMode && (
              <section class="mb-4">
                <div class="mb-3 flex items-end justify-between gap-3">
                  <h2 class="font-display text-xl font-bold sm:text-2xl">Fait pour toi</h2>
                  <button
                    type="button"
                    class="text-sm font-medium text-primary hover:underline"
                    onClick={() => setView("artistes")}
                  >
                    Voir tout
                  </button>
                </div>
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mixes.map((mix) => (
                    <button
                      key={mix.id}
                      type="button"
                      class={`relative flex min-h-[7.5rem] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${mix.gradient} p-4 text-center shadow-md shadow-black/20 transition hover:brightness-110 touch-manipulation sm:min-h-[8.5rem]`}
                      onClick={mix.onClick}
                    >
                      {mix.cover ? (
                        <img
                          src={mix.cover}
                          alt=""
                          class="absolute inset-0 h-full w-full object-cover opacity-35"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      <span class="relative z-[1]">
                        <span class="font-display block text-lg font-extrabold tracking-tight sm:text-xl">
                          {mix.title}
                        </span>
                        <span class="mt-1 block text-xs text-base-content/70 sm:text-sm">{mix.subtitle}</span>
                      </span>
                    </button>
                  ))}
                  {!mixes.length && (
                    <p class="text-sm text-base-content/45 sm:col-span-3">
                      Crée un artiste et un morceau dans le Studio pour remplir cette section.
                    </p>
                  )}
                </div>
              </section>
            )}

            {carMode && (
              <section class="mb-4">
                <h2 class="mb-3 font-display text-2xl font-bold">Artistes</h2>
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {artistGroups.map((a) => (
                    <button
                      key={a.slug}
                      type="button"
                      class="flex min-h-[5.5rem] flex-col items-center justify-center gap-2 rounded-2xl bg-base-300/60 p-4 text-center touch-manipulation active:bg-base-300"
                      onClick={() => playArtist(a.slug)}
                    >
                      <CoverThumb src={a.cover} class="h-16 w-16" rounded="rounded-full" />
                      <span class="line-clamp-2 text-sm font-bold leading-tight">{a.name}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {!loading && !showHome && (
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="mb-3 flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                class={`btn btn-ghost gap-1 rounded-full touch-manipulation ${carMode ? "btn-md min-h-12" : "btn-sm"}`}
                onClick={clearSearch}
              >
                <ChevronLeft size={16} /> Accueil
              </button>
              <h2 class={`font-display font-bold ${carMode ? "text-xl" : "text-lg sm:text-xl"}`}>
                {searchQuery
                  ? `Résultats « ${searchQuery} »`
                  : filterArtist
                    ? artistGroups.find((a) => a.slug === filterArtist)?.name || "Artiste"
                    : view === "artistes"
                      ? "Artistes"
                      : view === "file"
                        ? "File d’attente"
                        : "Tous les titres"}
              </h2>
              <div class="ml-auto flex gap-1">
                {[
                  { id: "titres", icon: Music2, label: "Titres" },
                  { id: "artistes", icon: Users, label: "Artistes" },
                  { id: "file", icon: ListMusic, label: "File" },
                ].map((t) => {
                  const Icon = t.icon;
                  const active =
                    view === t.id ||
                    ((searchQuery || filterArtist) &&
                      t.id === "titres" &&
                      view !== "artistes" &&
                      view !== "file");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      class={`btn btn-ghost rounded-full touch-manipulation ${
                        carMode ? "btn-md btn-square min-h-12 min-w-12" : "btn-sm btn-square"
                      } ${active ? "text-primary" : "text-base-content/45"}`}
                      aria-label={t.label}
                      onClick={() => {
                        setFilterArtist("");
                        setView(t.id);
                      }}
                    >
                      <Icon size={carMode ? 20 : 16} />
                    </button>
                  );
                })}
              </div>
            </div>

            {(view === "titres" || searchQuery || filterArtist) &&
              view !== "artistes" &&
              view !== "file" && (
                <>
                  <div class="mb-3 flex shrink-0 gap-2">
                    <button
                      type="button"
                      class={`btn btn-primary gap-2 rounded-full touch-manipulation ${
                        carMode ? "btn-md min-h-12 px-5" : "btn-sm"
                      }`}
                      disabled={!visibleTracks.length}
                      onClick={() => playList(visibleTracks, null, { expand: true })}
                    >
                      <Play size={16} fill="currentColor" /> Tout lire
                    </button>
                    {filterArtist && (
                      <button
                        type="button"
                        class={`btn btn-ghost rounded-full touch-manipulation ${carMode ? "btn-md" : "btn-sm"}`}
                        onClick={() => setFilterArtist("")}
                      >
                        Effacer filtre
                      </button>
                    )}
                  </div>
                  <TrackList
                    list={visibleTracks}
                    empty="Aucun titre — génère ou importe un morceau dans le Studio."
                  />
                </>
              )}

            {view === "artistes" && (
              <div
                class={`-mx-1 min-h-0 flex-1 gap-4 overflow-y-auto px-1 pb-2 ${
                  carMode
                    ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4"
                    : "flex overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-y-auto md:grid-cols-4 lg:grid-cols-5"
                }`}
              >
                {artistGroups.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    class={`group text-left touch-manipulation ${
                      carMode ? "flex flex-col items-center p-2" : "w-36 shrink-0 sm:w-auto"
                    }`}
                    onClick={() => playArtist(a.slug)}
                  >
                    <div
                      class={`relative aspect-square overflow-hidden rounded-full bg-base-300 shadow-md ${
                        carMode ? "w-full max-w-[8rem]" : ""
                      }`}
                    >
                      <CoverThumb src={a.cover} class="h-full w-full" rounded="rounded-none" />
                    </div>
                    <p class={`mt-2 truncate text-center font-semibold ${carMode ? "text-base" : "text-sm"}`}>
                      {a.name}
                    </p>
                    <p class="truncate text-center text-xs text-base-content/50">
                      {a.trackCount} titre{a.trackCount > 1 ? "s" : ""}
                    </p>
                  </button>
                ))}
                {!artistGroups.length && (
                  <p class="py-10 text-sm text-base-content/50">Aucun artiste avec audio.</p>
                )}
              </div>
            )}

            {view === "file" && (
              <TrackList list={queue} empty="La file est vide — lance un titre depuis l’accueil." />
            )}
          </div>
        )}
      </div>

      {current && expanded && (
        <div
          class={`fixed inset-x-0 top-0 bottom-[var(--sonozz-now-playing,5.5rem)] z-40 flex flex-col overflow-hidden bg-base-200/98 backdrop-blur-xl animate-rise ${
            carMode ? "landscape:flex-row landscape:items-stretch" : ""
          }`}
        >
          <div
            class={`flex h-12 shrink-0 items-center justify-between px-1 pt-[env(safe-area-inset-top)] sm:h-14 sm:px-3 ${
              carMode ? "landscape:absolute landscape:inset-x-0 landscape:top-0 landscape:z-10" : ""
            }`}
          >
            <button
              type="button"
              class={`btn btn-ghost btn-square touch-manipulation ${
                carMode ? "h-14 min-h-14 w-14 min-w-14" : "h-11 min-h-11 w-11 min-w-11"
              }`}
              aria-label="Réduire"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown size={carMode ? 30 : 26} />
            </button>
            <p class="font-display text-xs font-semibold tracking-wide text-base-content/60 sm:text-sm">
              EN LECTURE
            </p>
            <button
              type="button"
              class={`btn btn-ghost btn-square touch-manipulation ${
                carMode ? "h-14 min-h-14 w-14 min-w-14" : "h-11 min-h-11 w-11 min-w-11"
              }`}
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setView("file");
              }}
            >
              <ListMusic size={carMode ? 26 : 22} />
            </button>
          </div>

          <div
            class={`flex min-h-0 flex-1 flex-col px-4 pb-2 sm:px-6 md:px-16 ${
              carMode
                ? "landscape:flex-row landscape:items-center landscape:gap-8 landscape:px-8 landscape:pt-12"
                : ""
            }`}
          >
            <div
              class={`flex min-h-0 flex-1 items-center justify-center touch-manipulation select-none ${
                carMode ? "landscape:max-w-[48%]" : ""
              }`}
              style={{ containerType: "size" }}
              onTouchStart={onCoverTouchStart}
              onTouchEnd={onCoverTouchEnd}
            >
              <div
                class={`overflow-hidden rounded-md shadow-2xl shadow-black/40 ring-1 ring-base-content/10 ${
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
                    decoding="async"
                  />
                ) : (
                  <div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary/40 to-base-300">
                    <Disc3 size={64} class={`opacity-30 ${playing ? "animate-pulse-soft" : ""}`} />
                  </div>
                )}
              </div>
            </div>

            <div
              class={`mx-auto flex w-full max-w-lg shrink-0 flex-col ${
                carMode ? "landscape:mx-0 landscape:max-w-none landscape:flex-1 landscape:justify-center" : ""
              }`}
            >
              <div class="flex items-start justify-between gap-3 py-2 sm:py-3">
                <div class="min-w-0 text-left">
                  <h2
                    class={`font-display line-clamp-1 font-extrabold tracking-tight ${
                      carMode ? "text-2xl sm:text-3xl md:text-4xl" : "text-xl sm:text-2xl md:text-3xl"
                    }`}
                  >
                    {current.trackTitle}
                  </h2>
                  <p
                    class={`mt-0.5 truncate text-base-content/55 ${
                      carMode ? "text-base sm:text-lg" : "text-sm sm:text-base"
                    }`}
                  >
                    {current.artistName}
                  </p>
                </div>
                {!carMode && (
                  <button
                    type="button"
                    class="btn btn-ghost btn-circle btn-sm text-base-content/40"
                    aria-label="Favori"
                  >
                    <Heart size={18} />
                  </button>
                )}
              </div>

              {!carMode && playerId && (
                <div class="mb-2 flex flex-col items-center gap-1">
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
                          size={18}
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
                  class={`relative cursor-pointer touch-manipulation ${carMode ? "h-12" : "h-9 sm:h-11"}`}
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
                  <div
                    class={`absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-base-content/15 ${
                      carMode ? "h-2.5" : "h-1.5 sm:h-2"
                    }`}
                  >
                    <div class="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                  </div>
                  <div
                    class={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md ${
                      carMode ? "h-6 w-6" : "h-4 w-4 sm:h-5 sm:w-5"
                    }`}
                    style={{ left: `${progress}%` }}
                  />
                </div>
                <div class="flex justify-between text-[11px] tabular-nums text-base-content/45 sm:text-xs">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              <div
                class={`flex items-center justify-between gap-1 py-1 sm:py-2 ${
                  carMode ? "mt-2 gap-2" : ""
                }`}
              >
                <button
                  type="button"
                  class={`btn btn-ghost btn-square touch-manipulation ${
                    carMode ? "h-14 min-h-14 w-14 min-w-14" : "h-10 min-h-10 w-10 min-w-10"
                  } ${shuffle ? "text-primary" : "text-base-content/50"}`}
                  aria-label="Aléatoire"
                  aria-pressed={shuffle}
                  onClick={toggleShuffle}
                >
                  <Shuffle size={carMode ? 26 : 20} />
                </button>
                <button
                  type="button"
                  class={`btn btn-ghost btn-circle touch-manipulation ${
                    carMode ? "h-16 min-h-16 w-16 min-w-16" : "h-11 min-h-11 w-11 min-w-11"
                  }`}
                  aria-label="Précédent"
                  onClick={goPrev}
                >
                  <SkipBack size={carMode ? 32 : 24} fill="currentColor" />
                </button>
                <button
                  type="button"
                  class={`btn btn-primary btn-circle touch-manipulation shadow-lg shadow-primary/25 ${
                    carMode ? "h-20 w-20 min-h-20 min-w-20" : "h-14 w-14 min-h-14 min-w-14"
                  }`}
                  aria-label={playing ? "Pause" : "Lecture"}
                  onClick={() => togglePlay()}
                >
                  {playing ? (
                    <Pause size={carMode ? 36 : 28} fill="currentColor" />
                  ) : (
                    <Play size={carMode ? 36 : 28} fill="currentColor" class="ml-0.5" />
                  )}
                </button>
                <button
                  type="button"
                  class={`btn btn-ghost btn-circle touch-manipulation ${
                    carMode ? "h-16 min-h-16 w-16 min-w-16" : "h-11 min-h-11 w-11 min-w-11"
                  }`}
                  aria-label="Suivant"
                  onClick={goNext}
                >
                  <SkipForward size={carMode ? 32 : 24} fill="currentColor" />
                </button>
                <button
                  type="button"
                  class={`btn btn-ghost btn-square touch-manipulation ${
                    carMode ? "h-14 min-h-14 w-14 min-w-14" : "h-10 min-h-10 w-10 min-w-10"
                  } ${repeat !== "off" ? "text-primary" : "text-base-content/50"}`}
                  aria-label="Répéter"
                  onClick={cycleRepeat}
                >
                  {repeat === "one" ? (
                    <Repeat1 size={carMode ? 26 : 20} />
                  ) : (
                    <Repeat size={carMode ? 26 : 20} />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
