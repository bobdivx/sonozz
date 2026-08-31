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
  ChevronRight,
  Disc3,
  Star,
  Heart,
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

const RECENT_KEY = "sonozz-play-recent";

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

function CoverThumb({ src, class: cls = "", rounded = "rounded" }) {
  if (src) {
    return <img src={src} alt="" class={`object-cover ${rounded} ${cls}`} />;
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

  const [tracks, setTracks] = useState([]);
  const [artists, setArtists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("home"); // home | titres | artistes | file
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
    const q = readQuery();
    if (q.artist) {
      setFilterArtist(q.artist);
      setView("titres");
    }
    if (q.q) {
      setSearchQuery(q.q);
      setView("titres");
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
    if (!current?.id || !playerId) {
      setTrackRating(null);
      setRatingStats(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `/api/ratings?trackId=${encodeURIComponent(current.id)}&playerId=${encodeURIComponent(playerId)}`,
        );
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

  function playArtist(slug) {
    const list = tracks.filter((t) => t.slug === slug);
    setFilterArtist(slug);
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

  function clearSearch() {
    setSearchQuery("");
    setFilterArtist("");
    setView("home");
    const url = new URL(location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("artist");
    history.replaceState({}, "", url.pathname + url.search);
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
      onClick: () => playList(tracks),
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
  const quickCards = quickAccess.slice(0, 8);

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
      onClick: () => playList(shuffleCopy(tracks)),
    });
  }
  const mixes = dailyMixes.slice(0, 3);

  function TrackList({ list, empty }) {
    return (
      <ul class="min-h-0 flex-1 divide-y divide-base-content/8 overflow-y-auto overscroll-contain rounded-xl bg-base-300/25">
        {list.map((t, i) => {
          const isCurrent = current?.id === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                class={`flex w-full min-h-14 items-center gap-3 px-3 py-2.5 text-left touch-manipulation transition hover:bg-base-content/5 sm:min-h-16 sm:gap-4 sm:px-4 ${
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
                <CoverThumb src={t.coverUrl || t.artistImage} class="h-12 w-12 shrink-0" rounded="rounded" />
                <div class="min-w-0 flex-1">
                  <p class={`truncate text-sm font-semibold sm:text-base ${isCurrent ? "text-primary" : ""}`}>
                    {t.trackTitle}
                  </p>
                  <p class="truncate text-xs text-base-content/50">{t.artistName}</p>
                </div>
                <span class="flex h-10 w-10 shrink-0 items-center justify-center text-base-content/60">
                  {isCurrent && playing ? <Pause size={20} /> : <Play size={20} />}
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

  return (
    <AppShell active="play" fillViewport>
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
            <div class="mb-5 flex items-center justify-between gap-3">
              <h1 class="font-display text-2xl font-extrabold tracking-tight sm:text-3xl md:text-4xl">
                {greeting()}
              </h1>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-sm text-base-content/45"
                  aria-label="Accueil"
                  onClick={() => setView("home")}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-sm text-base-content/45"
                  aria-label="Tous les titres"
                  onClick={() => setView("titres")}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* Accès rapide — cartes horizontales */}
            {quickCards.length > 0 && (
              <section class="mb-8">
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {quickCards.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      class="group flex items-center gap-0 overflow-hidden rounded-md bg-base-300/70 text-left transition hover:bg-base-300"
                      onClick={card.onClick}
                    >
                      <CoverThumb
                        src={card.cover}
                        class="h-14 w-14 shrink-0 sm:h-16 sm:w-16"
                        rounded="rounded-none"
                      />
                      <span class="min-w-0 flex-1 px-3 py-2">
                        <span class="block truncate text-sm font-bold sm:text-base">{card.title}</span>
                        <span class="block truncate text-xs text-base-content/50">{card.subtitle}</span>
                      </span>
                      <span class="mr-3 hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content opacity-0 shadow-lg transition group-hover:flex group-hover:opacity-100">
                        <Play size={18} fill="currentColor" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Récemment écoutés */}
            <section class="mb-8">
              <div class="mb-3 flex items-end justify-between gap-3">
                <h2 class="font-display text-xl font-bold sm:text-2xl">Récemment écoutés</h2>
                <button
                  type="button"
                  class="text-sm font-medium text-primary hover:underline"
                  onClick={() => setView("titres")}
                >
                  Voir tout
                </button>
              </div>
              <div class="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                {recentTracks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    class="group w-32 shrink-0 text-left sm:w-36"
                    onClick={() => playTrack(t, recentTracks)}
                  >
                    <div class="relative aspect-square overflow-hidden rounded-md bg-base-300 shadow-md shadow-black/25">
                      <CoverThumb
                        src={t.coverUrl || t.artistImage}
                        class="h-full w-full transition duration-300 group-hover:scale-[1.03]"
                        rounded="rounded-none"
                      />
                      <span class="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-content opacity-0 shadow-lg transition group-hover:opacity-100">
                        <Play size={18} fill="currentColor" />
                      </span>
                    </div>
                    <p class="mt-2 truncate text-sm font-semibold">{t.trackTitle}</p>
                    <p class="truncate text-xs text-base-content/50">{t.artistName}</p>
                  </button>
                ))}
                {!recentTracks.length && (
                  <p class="py-6 text-sm text-base-content/45">Aucun titre audio pour l’instant.</p>
                )}
              </div>
            </section>

            {/* Fait pour toi */}
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
                    class={`relative flex min-h-[7.5rem] items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${mix.gradient} p-4 text-center shadow-md shadow-black/20 transition hover:brightness-110 sm:min-h-[8.5rem]`}
                    onClick={mix.onClick}
                  >
                    {mix.cover ? (
                      <img
                        src={mix.cover}
                        alt=""
                        class="absolute inset-0 h-full w-full object-cover opacity-35"
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
          </div>
        )}

        {/* Listes (recherche / voir tout / file / artistes) */}
        {!loading && !showHome && (
          <div class="flex min-h-0 flex-1 flex-col">
            <div class="mb-3 flex shrink-0 flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn btn-ghost btn-sm gap-1 rounded-full"
                onClick={clearSearch}
              >
                <ChevronLeft size={16} /> Accueil
              </button>
              <h2 class="font-display text-lg font-bold sm:text-xl">
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
                    ((searchQuery || filterArtist) && t.id === "titres" && view !== "artistes" && view !== "file");
                  return (
                    <button
                      key={t.id}
                      type="button"
                      class={`btn btn-ghost btn-sm btn-square rounded-full ${active ? "text-primary" : "text-base-content/45"}`}
                      aria-label={t.label}
                      onClick={() => {
                        setFilterArtist("");
                        setView(t.id);
                      }}
                    >
                      <Icon size={16} />
                    </button>
                  );
                })}
              </div>
            </div>

            {(view === "titres" || searchQuery || filterArtist) && view !== "artistes" && view !== "file" && (
              <>
                <div class="mb-3 flex shrink-0 gap-2">
                  <button
                    type="button"
                    class="btn btn-primary btn-sm gap-2 rounded-full"
                    disabled={!visibleTracks.length}
                    onClick={() => playList(visibleTracks)}
                  >
                    <Play size={16} fill="currentColor" /> Tout lire
                  </button>
                  {filterArtist && (
                    <button type="button" class="btn btn-ghost btn-sm rounded-full" onClick={() => setFilterArtist("")}>
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
              <div class="-mx-1 flex min-h-0 flex-1 gap-4 overflow-x-auto px-1 pb-2 sm:grid sm:grid-cols-3 sm:overflow-y-auto md:grid-cols-4 lg:grid-cols-5">
                {artistGroups.map((a) => (
                  <button
                    key={a.slug}
                    type="button"
                    class="group w-36 shrink-0 text-left sm:w-auto"
                    onClick={() => playArtist(a.slug)}
                  >
                    <div class="relative aspect-square overflow-hidden rounded-full bg-base-300 shadow-md">
                      <CoverThumb src={a.cover} class="h-full w-full" rounded="rounded-none" />
                    </div>
                    <p class="mt-2 truncate text-center text-sm font-semibold">{a.name}</p>
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

      {/* Now playing plein écran */}
      {current && expanded && (
        <div class="fixed inset-x-0 top-0 bottom-[var(--sonozz-now-playing,5.5rem)] z-40 flex flex-col overflow-hidden bg-base-200/98 backdrop-blur-xl animate-rise">
          <div class="flex h-12 shrink-0 items-center justify-between px-1 pt-[env(safe-area-inset-top)] sm:h-14 sm:px-3">
            <button
              type="button"
              class="btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation"
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
              class="btn btn-ghost btn-square h-11 min-h-11 w-11 min-w-11 touch-manipulation"
              aria-label="File d’attente"
              onClick={() => {
                setExpanded(false);
                setView("file");
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
                  />
                ) : (
                  <div class="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary/40 to-base-300">
                    <Disc3 size={64} class={`opacity-30 ${playing ? "animate-pulse-soft" : ""}`} />
                  </div>
                )}
              </div>
            </div>

            <div class="mx-auto flex w-full max-w-lg shrink-0 items-start justify-between gap-3 py-2 sm:py-3">
              <div class="min-w-0 text-left">
                <h2 class="font-display line-clamp-1 text-xl font-extrabold tracking-tight sm:text-2xl md:text-3xl">
                  {current.trackTitle}
                </h2>
                <p class="mt-0.5 truncate text-sm text-base-content/55 sm:text-base">{current.artistName}</p>
              </div>
              <button type="button" class="btn btn-ghost btn-circle btn-sm text-base-content/40" aria-label="Favori">
                <Heart size={18} />
              </button>
            </div>

            {playerId && (
              <div class="mx-auto mb-2 flex w-full max-w-lg shrink-0 flex-col items-center gap-1">
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
                        class={trackRating && star <= trackRating ? "text-warning" : "text-base-content/30"}
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
                  <div class="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
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

            <div class="mx-auto flex w-full max-w-lg shrink-0 items-center justify-between gap-1 py-1 sm:py-2">
              <button
                type="button"
                class={`btn btn-ghost btn-square h-10 min-h-10 w-10 min-w-10 touch-manipulation ${
                  shuffle ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Aléatoire"
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Shuffle size={20} />
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 touch-manipulation"
                aria-label="Précédent"
                onClick={goPrev}
              >
                <SkipBack size={24} fill="currentColor" />
              </button>
              <button
                type="button"
                class="btn btn-primary btn-circle h-14 w-14 min-h-14 min-w-14 touch-manipulation shadow-lg shadow-primary/25"
                aria-label={playing ? "Pause" : "Lecture"}
                onClick={() => togglePlay()}
              >
                {playing ? (
                  <Pause size={28} fill="currentColor" />
                ) : (
                  <Play size={28} fill="currentColor" class="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-circle h-11 min-h-11 w-11 min-w-11 touch-manipulation"
                aria-label="Suivant"
                onClick={goNext}
              >
                <SkipForward size={24} fill="currentColor" />
              </button>
              <button
                type="button"
                class={`btn btn-ghost btn-square h-10 min-h-10 w-10 min-w-10 touch-manipulation ${
                  repeat !== "off" ? "text-primary" : "text-base-content/50"
                }`}
                aria-label="Répéter"
                onClick={cycleRepeat}
              >
                {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
