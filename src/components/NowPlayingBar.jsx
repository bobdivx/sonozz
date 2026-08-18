import { useEffect, useRef, useState } from "preact/hooks";
import { Pause, Play, SkipForward, Headphones, Music2 } from "lucide-preact";
import {
  bindMediaSession,
  bootPlayEngine,
  getPlayAudio,
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

const BAR_HEIGHT = "5.25rem";

/**
 * Mini-lecteur global — toujours visible en pied de page.
 */
export default function NowPlayingBar() {
  const barRef = useRef(null);
  const [session, setSession] = useState(() =>
    typeof window === "undefined" ? { queue: [], playing: false, index: 0 } : readPlaySession(),
  );
  const [expandedPage, setExpandedPage] = useState(false);
  const [hasSidebar, setHasSidebar] = useState(false);

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
      setHasSidebar(document.documentElement.dataset.sonozzNav === "sidebar");
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

  const current = currentPlayTrack(session);
  const cover = current?.coverUrl || current?.artistImage || "";

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

  return (
    <div
      ref={barRef}
      class={`fixed inset-x-0 bottom-0 z-[55] border-t border-base-content/10 bg-base-200/95 backdrop-blur-md safe-bottom ${
        hasSidebar ? "md:left-64" : ""
      }`}
      role="region"
      aria-label="Play"
    >
      <div class="flex min-h-[4.25rem] items-center gap-2 px-2 py-2 sm:min-h-[4.75rem] sm:gap-3 sm:px-3">
        <a
          href="/play"
          class="flex min-w-0 flex-1 items-center gap-3 text-left touch-manipulation active:bg-base-content/5"
          onClick={onOpenPlay}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              class="h-11 w-11 shrink-0 object-cover sm:h-12 sm:w-12"
              width="48"
              height="48"
            />
          ) : (
            <div class="flex h-11 w-11 shrink-0 items-center justify-center bg-base-300 sm:h-12 sm:w-12">
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

        {current ? (
          <>
            <button
              type="button"
              class="btn btn-ghost btn-circle h-10 w-10 min-h-10 min-w-10 touch-manipulation"
              aria-label="Suivant"
              onClick={() => skipTrack(1)}
            >
              <SkipForward size={18} fill="currentColor" />
            </button>
            <button
              type="button"
              class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
              aria-label={session.playing ? "Pause" : "Lecture"}
              onClick={() => togglePlay()}
            >
              {session.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
            </button>
          </>
        ) : (
          <a
            href="/play"
            class="btn btn-primary btn-circle h-11 w-11 min-h-11 min-w-11 touch-manipulation sm:h-12 sm:w-12 sm:min-h-12 sm:min-w-12"
            aria-label="Ouvrir Play"
          >
            <Play size={20} fill="currentColor" />
          </a>
        )}
      </div>
      {current ? <ProgressStrip /> : <div class="h-0.5 bg-base-content/10 sm:h-1" />}
    </div>
  );
}

function ProgressStrip() {
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

  return (
    <div class="h-0.5 bg-base-content/10 sm:h-1">
      <div class="h-full bg-primary" style={{ width: `${Math.round(ratio * 1000) / 10}%` }} />
    </div>
  );
}
