import { useEffect, useRef, useState } from "preact/hooks";
import { Pause, Play, Music2 } from "lucide-preact";
import { playableAudioSrc } from "../lib/audioResolve.js";

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Mini-lecteur studio — écoute du morceau (header, entre portrait et pipeline).
 */
export default function ClipTrackPlayer({ track, artist, cover, compact = false }) {
  const audioRef = useRef(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioUrl = track?.audioUrl;
  const title = track?.title || track?.trackTitle || "Morceau";
  const artistName = artist?.name || track?.artistName || "";
  const art =
    (cover?.imageUrl && !/^data:image\/svg/i.test(cover.imageUrl) && cover.imageUrl) ||
    (artist?.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl) && artist.imageUrl) ||
    "";

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const src = playableAudioSrc(audioUrl, track?.audioS3Key);
    if (audio.dataset.src !== src) {
      audio.dataset.src = src;
      audio.src = src;
      audio.load();
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      if (!seekingRef.current) setCurrentTime(audio.currentTime || 0);
    };
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (playing) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  function onSeekInput(e) {
    const audio = audioRef.current;
    const next = Number(e.currentTarget.value);
    seekingRef.current = true;
    setCurrentTime(next);
    if (audio) audio.currentTime = next;
  }

  function onSeekEnd() {
    seekingRef.current = false;
  }

  if (!audioUrl) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const showThumb = !compact;

  return (
    <div
      class={`clip-track-player relative overflow-hidden border border-base-content/10 bg-gradient-to-br from-base-300/80 via-base-200/90 to-base-300/60 ${
        compact ? "rounded-xl" : ""
      }`}
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={
          art
            ? {
                backgroundImage: `url(${art})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(28px) saturate(1.2)",
                transform: "scale(1.2)",
              }
            : undefined
        }
      />
      <div
        class={`relative flex items-center gap-3 ${
          compact ? "p-2.5 sm:gap-3 sm:p-3" : "p-3 sm:gap-4 sm:p-3.5"
        }`}
      >
        {showThumb ? (
          <div
            class={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-base-300 shadow-md shadow-black/40 sm:h-16 sm:w-16 ${
              playing ? "ring-2 ring-primary/50" : "ring-1 ring-base-content/10"
            }`}
          >
            {art ? (
              <img
                src={art}
                alt=""
                class={`h-full w-full object-cover transition-transform duration-700 ${
                  playing ? "scale-105" : "scale-100"
                }`}
                width="64"
                height="64"
              />
            ) : (
              <div class="flex h-full w-full items-center justify-center text-base-content/35">
                <Music2 size={22} />
              </div>
            )}
            {playing && (
              <span class="absolute inset-x-0 bottom-0 flex h-1.5 items-end justify-center gap-0.5 bg-gradient-to-t from-black/55 to-transparent pb-0.5">
                <span class="h-1.5 w-0.5 animate-pulse-soft rounded-full bg-primary" />
                <span class="h-2.5 w-0.5 animate-pulse-soft rounded-full bg-primary [animation-delay:150ms]" />
                <span class="h-1 w-0.5 animate-pulse-soft rounded-full bg-primary [animation-delay:300ms]" />
              </span>
            )}
          </div>
        ) : null}

        <div class="min-w-0 flex-1 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-display text-sm font-semibold tracking-tight sm:text-base">
                {title}
              </p>
              {artistName ? (
                <p class="truncate text-xs text-base-content/55">{artistName}</p>
              ) : (
                <p class="text-xs text-base-content/45">Écoute le morceau</p>
              )}
            </div>
            <button
              type="button"
              class={`btn btn-primary btn-circle shrink-0 touch-manipulation ${
                compact
                  ? "h-11 w-11 min-h-11"
                  : "h-10 w-10 min-h-10 sm:h-11 sm:w-11 sm:min-h-11"
              }`}
              aria-label={playing ? "Pause" : "Lecture"}
              onClick={togglePlay}
            >
              {playing ? (
                <Pause size={compact ? 20 : 18} />
              ) : (
                <Play size={compact ? 20 : 18} fill="currentColor" />
              )}
            </button>
          </div>

          <div class="flex items-center gap-2">
            <span class="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-base-content/45 sm:text-xs">
              {formatTime(currentTime)}
            </span>
            <div class="relative h-1.5 flex-1 overflow-hidden rounded-full bg-base-content/10">
              <div
                class="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-100"
                style={{ width: `${progress}%` }}
              />
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(currentTime, duration || 0)}
                class="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
                aria-label="Position"
                onInput={onSeekInput}
                onChange={onSeekEnd}
                onPointerUp={onSeekEnd}
              />
            </div>
            <span class="w-9 shrink-0 font-mono text-[10px] tabular-nums text-base-content/45 sm:text-xs">
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      <audio ref={audioRef} preload="metadata" class="hidden" />
    </div>
  );
}
