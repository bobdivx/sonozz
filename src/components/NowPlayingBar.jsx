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

const BAR_HEIGHT = "5.5rem";

/**
 * Mini-lecteur global — barre pleine largeur style streaming.
 */
export default function NowPlayingBar() {
  const barRef = useRef(null);
  const [session, setSession] = useState(() =>
    typeof window === "undefined"
      ? { queue: [], playing: false, index: 0, shuffle: false, repeat: "off" }
      : readPlaySession(),
  );
  const [expandedPage, setExpandedPage] = useState(false);

  useEffect(() => {
    bootPlayEngine();
    bindMediaSession();
    return subscribePlaySession((next) => {
      setSession(next);
      bindMediaSession();
    });
  }, []);

  useEffect(() => {
    const sync = () => {
      if (
        typeof location !== "undefined" &&
        location.pathname !== "/play" &&
        document.documentElement.dataset.playExpanded === "1"
      ) {
        setPlayExpanded(false);
      }
      setExpandedPage(isPlayOverlayOpen());
    };
    sync();
    window.addEventListener("sonozz-play-expanded", sync);
    document.addEventListener("astro:after-swap", sync);
    document.addEventListener("astro:page-load", sync);
    window.addEventListener("popstate", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-play-expanded", "data-sonozz-nav"],
    });
    return () => {
      window.removeEventListener("sonozz-play-expanded", sync);
      document.removeEventListener("astro:after-swap", sync);
      document.removeEventListener("astro:page-load", sync);
      window.removeEventListener("popstate", sync);
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const el = barRef.current;
    if (!el) {
      root.style.setProperty("--sonozz-now-playing", BAR_HEIGHT);
      return undefined;
    }
    const apply = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      root.style.setProperty("--sonozz-now-playing", `${Math.max(72, h)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (typeof location !== "undefined" && location.pathname === "/login") {
    return null;
  }

  const current = currentPlayTrack(session);
  const cover = current?.coverUrl || current?.artistImage || "";
  const shuffle = Boolean(session.shuffle);
  const repeat = session.repeat || "off";

  function onOpenPlay(e) {
    if (typeof location === "undefined" || location.pathname !== "/play") return;
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
      <div class="grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 sm:min-h-[5rem] sm:gap-3 sm:px-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* Now playing */}
        <a
          href="/play"
          class="flex min-w-0 items-center gap-3 text-left touch-manipulation active:bg-base-content/5 md:pr-4"
          onClick={onOpenPlay}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              class="h-12 w-12 shrink-0 rounded object-cover sm:h-14 sm:w-14"
              width="56"
              height="56"
            />
          ) : (
            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-base-300 sm:h-14 sm:w-14">
              {current ? <Music2 size={18} class="opacity-40" /> : <Headphones size={18} class="opacity-50" />}
            </div>
          )}
          <div class="min-w-0 flex-1">
            {current ? (
              <>
                <p class="truncate text-sm font-semibold sm:text-base">{current.trackTitle}</p>
                <p class="truncate text-[11px] text-base-content/50 sm:text-xs">{current.artistName}</p>
              </>
            ) : (
              <>
                <p class="truncate text-sm font-semibold sm:text-base">Play</p>
                <p class="truncate text-[11px] text-base-content/50 sm:text-xs">Tous les titres</p>
              </>
            )}
          </div>
        </a>

        {/* Controls — centrés desktop */}
        <div class="flex items-center justify-center gap-0.5 sm:gap-1">
          <button
            type="button"
            class={`btn btn-ghost btn-circle hidden h-9 w-9 min-h-9 min-w-9 touch-manipulation sm:inline-flex ${
              shuffle ? "text-primary" : "text-base-content/45"
            }`}
            aria-label="Aléatoire"
            aria-pressed={shuffle}
            disabled={!current}
            onClick={toggleShuffle}
          >
            <Shuffle size={16} />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-circle hidden h-9 w-9 min-h-9 min-w-9 touch-manipulation sm:inline-flex"
            aria-label="Précédent"
            disabled={!current}
            onClick={() => skipTrack(-1)}
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          {current ? (
            <button
              type="button"
              class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
              aria-label={session.playing ? "Pause" : "Lecture"}
              onClick={() => togglePlay()}
            >
              {session.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
            </button>
          ) : (
            <a
              href="/play"
              class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
              aria-label="Ouvrir Play"
            >
              <Play size={20} fill="currentColor" />
            </a>
          )}
          <button
            type="button"
            class="btn btn-ghost btn-circle h-10 w-10 min-h-10 min-w-10 touch-manipulation sm:h-9 sm:w-9 sm:min-h-9 sm:min-w-9"
            aria-label="Suivant"
            disabled={!current}
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
            disabled={!current}
            onClick={() => cyclePlayRepeat()}
          >
            {repeat === "one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
          </button>
        </div>

        {/* Extras droite */}
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
      <div class="md:hidden">
        {current ? <ProgressStrip /> : <div class="h-0.5 bg-base-content/10" />}
      </div>
    </div>
  );
}

function ProgressStrip({ wide = false }) {
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    const el = getPlayAudio();
    if (!el) return undefined;
    const onTime = () => {
      const d = el.duration;
      setRatio(Number.isFinite(d) && d > 0 ? Math.min(1, el.currentTime / d) : 0);
    };
    el.addEventListener("timeupdate", onTime);
    onTime();
    return () => el.removeEventListener("timeupdate", onTime);
  }, []);

  if (wide) {
    return (
      <div class="h-1 w-28 overflow-hidden rounded-full bg-base-content/10 lg:w-40">
        <div class="h-full rounded-full bg-primary" style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
      </div>
    );
  }

  return (
    <div class="h-0.5 bg-base-content/10 sm:h-1">
      <div class="h-full bg-primary" style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
    </div>
  );
}
