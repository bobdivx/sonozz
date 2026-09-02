import { useEffect, useRef, useState } from "preact/hooks";
import {
  Pause,
  Play,
  SkipForward,
  SkipBack,
  Shuffle,
  Repeat,
  Repeat1,
  Headphones,
  Music2,
  ListMusic,
} from "lucide-preact";
import {
  bindMediaSession,
  bootPlayEngine,
  cyclePlayRepeat,
  getPlayAudio,
  seekTo,
  setPlayShuffle,
  skipTrack,
  togglePlay,
} from "../lib/playEngine.js";
import {
  currentPlayTrack,
  isPlayOverlayOpen,
  readPlaySession,
  setPlayExpanded,
  subscribePlaySession,
} from "../lib/playSession.js";

const BAR_FALLBACK = "5.25rem";

function readPathname() {
  if (typeof location === "undefined") return "";
  return location.pathname || "";
}

/**
 * Mini-lecteur global — barre pleine largeur, responsive mobile / desktop.
 * Doit se re-rendre après ClientRouter (transition:persist ne remonte pas le composant).
 */
export default function NowPlayingBar() {
  const barRef = useRef(null);
  const [pathname, setPathname] = useState(readPathname);
  const [session, setSession] = useState(() =>
    typeof window === "undefined"
      ? { queue: [], playing: false, index: 0, shuffle: false, repeat: "off" }
      : readPlaySession(),
  );
  const [expandedPage, setExpandedPage] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);

  useEffect(() => {
    bootPlayEngine();
    bindMediaSession();
    const el = getPlayAudio();
    const syncAudio = () => setAudioPlaying(Boolean(el && !el.paused && !el.ended));
    if (el) {
      el.addEventListener("play", syncAudio);
      el.addEventListener("pause", syncAudio);
      el.addEventListener("ended", syncAudio);
      syncAudio();
    }
    const unsub = subscribePlaySession((next) => {
      setSession(next);
      bindMediaSession();
      syncAudio();
    });
    return () => {
      unsub();
      if (el) {
        el.removeEventListener("play", syncAudio);
        el.removeEventListener("pause", syncAudio);
        el.removeEventListener("ended", syncAudio);
      }
    };
  }, []);

  useEffect(() => {
    const syncRoute = () => {
      setPathname(readPathname());
      if (
        typeof location !== "undefined" &&
        location.pathname !== "/play" &&
        document.documentElement.dataset.playExpanded === "1"
      ) {
        setPlayExpanded(false);
      }
      setExpandedPage(isPlayOverlayOpen());
    };
    syncRoute();
    window.addEventListener("sonozz-play-expanded", syncRoute);
    document.addEventListener("astro:after-swap", syncRoute);
    document.addEventListener("astro:page-load", syncRoute);
    window.addEventListener("popstate", syncRoute);
    const mo = new MutationObserver(syncRoute);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-play-expanded", "data-sonozz-nav"],
    });
    return () => {
      window.removeEventListener("sonozz-play-expanded", syncRoute);
      document.removeEventListener("astro:after-swap", syncRoute);
      document.removeEventListener("astro:page-load", syncRoute);
      window.removeEventListener("popstate", syncRoute);
      mo.disconnect();
    };
  }, []);

  const hidden = pathname === "/login" || pathname === "/403";
  const current = currentPlayTrack(session);
  const cover = current?.coverUrl || current?.artistImage || "";
  const shuffle = Boolean(session.shuffle);
  const repeat = session.repeat || "off";
  const hasTrack = Boolean(current);

  useEffect(() => {
    const root = document.documentElement;
    if (hidden) {
      root.style.setProperty("--sonozz-now-playing", "0px");
      return undefined;
    }
    const el = barRef.current;
    if (!el) {
      root.style.setProperty("--sonozz-now-playing", BAR_FALLBACK);
      return undefined;
    }
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.style.setProperty("--sonozz-now-playing", `${Math.max(64, h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden, hasTrack]);

  if (hidden) return null;

  function onOpenPlay(e) {
    if (pathname !== "/play") return;
    e.preventDefault();
    if (!current) return;
    if (expandedPage) {
      setPlayExpanded(false);
      window.dispatchEvent(new CustomEvent("sonozz-play-close"));
    } else {
      window.dispatchEvent(new CustomEvent("sonozz-play-open"));
    }
  }

  function toggleShuffle() {
    setPlayShuffle(!shuffle, current);
  }

  return (
    <div
      ref={barRef}
      class="fixed inset-x-0 bottom-0 z-30 border-t border-base-content/10 bg-base-200/95 backdrop-blur-md safe-bottom"
      role="region"
      aria-label="Play"
    >
      {/* Progress collée en haut — ne casse pas la grille mobile */}
      <div class="absolute inset-x-0 top-0 z-10">
        {hasTrack ? <ProgressStrip seekable /> : <div class="h-0.5 bg-base-content/10" />}
      </div>

      <div class="flex min-h-14 items-center gap-1 px-2 pb-1.5 pt-2.5 sm:min-h-16 sm:gap-2 sm:px-3 sm:pb-2 sm:pt-3 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3 md:px-4">
        {/* Now playing */}
        <a
          href="/play"
          class="flex min-w-0 flex-1 items-center gap-2.5 text-left touch-manipulation active:opacity-80 md:pr-4"
          onClick={onOpenPlay}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              class="h-11 w-11 shrink-0 rounded object-cover sm:h-12 sm:w-12"
              width="48"
              height="48"
            />
          ) : (
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-base-300 sm:h-12 sm:w-12">
              {current ? (
                <Music2 size={18} class="opacity-40" />
              ) : (
                <Headphones size={18} class="opacity-50" />
              )}
            </div>
          )}
          <div class="min-w-0 flex-1">
            {current ? (
              <>
                <p class="truncate text-sm font-semibold leading-tight">{current.trackTitle}</p>
                <p class="truncate text-[11px] leading-tight text-base-content/50 sm:text-xs">
                  {current.artistName}
                </p>
              </>
            ) : (
              <>
                <p class="truncate text-sm font-semibold leading-tight">Play</p>
                <p class="truncate text-[11px] leading-tight text-base-content/50 sm:text-xs">
                  Tous les titres
                </p>
              </>
            )}
          </div>
        </a>

        {/* Contrôles — prev/play/next toujours accessibles sur mobile */}
        <div class="flex shrink-0 items-center justify-center gap-0 sm:gap-0.5 md:gap-1">
          {hasTrack ? (
            <>
              <button
                type="button"
                class={`btn btn-ghost btn-circle hidden h-9 w-9 min-h-9 min-w-9 touch-manipulation sm:inline-flex ${
                  shuffle ? "text-primary" : "text-base-content/45"
                }`}
                aria-label="Aléatoire"
                aria-pressed={shuffle}
                onClick={toggleShuffle}
              >
                <Shuffle size={16} />
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-circle h-10 w-10 min-h-10 min-w-10 touch-manipulation sm:h-9 sm:w-9 sm:min-h-9 sm:min-w-9"
                aria-label="Précédent"
                onClick={() => skipTrack(-1)}
              >
                <SkipBack size={18} fill="currentColor" />
              </button>
              <button
                type="button"
                class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
                aria-label={audioPlaying ? "Pause" : "Lecture"}
                onClick={() => togglePlay()}
              >
                {audioPlaying ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" class="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-circle h-10 w-10 min-h-10 min-w-10 touch-manipulation sm:h-9 sm:w-9 sm:min-h-9 sm:min-w-9"
                aria-label="Suivant"
                onClick={() => skipTrack(1)}
              >
                <SkipForward size={18} fill="currentColor" />
              </button>
              <button
                type="button"
                class={`btn btn-ghost btn-circle hidden h-9 w-9 min-h-9 min-w-9 touch-manipulation sm:inline-flex ${
                  repeat !== "off" ? "text-primary" : "text-base-content/45"
                }`}
                aria-label="Répéter"
                onClick={() => cyclePlayRepeat()}
              >
                {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </button>
            </>
          ) : (
            <a
              href="/play"
              class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
              aria-label="Ouvrir Play"
            >
              <Play size={20} fill="currentColor" class="ml-0.5" />
            </a>
          )}
        </div>

        {/* Extras desktop */}
        <div class="hidden items-center justify-end gap-2 md:flex">
          <a
            href="/play"
            class="btn btn-ghost btn-circle h-9 w-9 min-h-9 min-w-9 text-base-content/50"
            aria-label="File d’attente"
            onClick={onOpenPlay}
          >
            <ListMusic size={16} />
          </a>
          <ProgressStrip wide />
        </div>
      </div>
    </div>
  );
}

function ProgressStrip({ wide = false, seekable = false }) {
  const trackRef = useRef(null);
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    const el = getPlayAudio();
    if (!el) return undefined;
    const onTime = () => {
      const d = el.duration;
      setRatio(Number.isFinite(d) && d > 0 ? Math.min(1, el.currentTime / d) : 0);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onTime);
    el.addEventListener("durationchange", onTime);
    onTime();
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onTime);
      el.removeEventListener("durationchange", onTime);
    };
  }, []);

  function seekFromClientX(clientX) {
    const el = getPlayAudio();
    const track = trackRef.current;
    if (!el || !track || !Number.isFinite(el.duration) || el.duration <= 0) return;
    const rect = track.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    seekTo(t * el.duration);
    setRatio(t);
  }

  const pct = `${Math.round(ratio * 1000) / 10}%`;

  if (wide) {
    return (
      <div
        ref={trackRef}
        class="h-1 w-28 cursor-pointer overflow-hidden rounded-full bg-base-content/10 lg:w-40"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Position"
        onPointerDown={(e) => {
          seekFromClientX(e.clientX);
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return;
          seekFromClientX(e.clientX);
        }}
      >
        <div class="h-full rounded-full bg-primary" style={{ width: pct }} />
      </div>
    );
  }

  return (
    <div
      ref={trackRef}
      class={`h-1 bg-base-content/15 ${seekable ? "cursor-pointer touch-manipulation" : ""}`}
      role={seekable ? "slider" : undefined}
      aria-valuemin={seekable ? 0 : undefined}
      aria-valuemax={seekable ? 100 : undefined}
      aria-valuenow={seekable ? Math.round(ratio * 100) : undefined}
      aria-label={seekable ? "Position" : undefined}
      onPointerDown={
        seekable
          ? (e) => {
              seekFromClientX(e.clientX);
              e.currentTarget.setPointerCapture?.(e.pointerId);
            }
          : undefined
      }
      onPointerMove={
        seekable
          ? (e) => {
              if (e.buttons !== 1) return;
              seekFromClientX(e.clientX);
            }
          : undefined
      }
    >
      <div class="h-full bg-primary transition-[width] duration-100 ease-linear" style={{ width: pct }} />
    </div>
  );
}
