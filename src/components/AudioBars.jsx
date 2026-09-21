import { useEffect, useRef, useState } from "preact/hooks";
import { ensurePlayAnalyser, samplePlayLevels } from "../lib/playAnalyser.js";
import { prefersReducedMotion } from "../lib/motionPrefs.js";

/**
 * Barres égaliseur live branchées sur le moteur Play.
 * @param {{ playing?: boolean, bars?: number, class?: string, tall?: boolean }} props
 */
export default function AudioBars({
  playing = false,
  bars = 5,
  class: className = "",
  tall = false,
}) {
  const [levels, setLevels] = useState(() => Array.from({ length: bars }, () => 0.18));
  const raf = useRef(0);
  const reduce = useRef(true);

  useEffect(() => {
    reduce.current = prefersReducedMotion();
  }, []);

  useEffect(() => {
    if (!playing || reduce.current) {
      setLevels(Array.from({ length: bars }, () => 0.14));
      return undefined;
    }

    ensurePlayAnalyser();
    const tick = () => {
      setLevels(samplePlayLevels(bars));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, bars]);

  const hMax = tall ? 28 : 14;

  return (
    <div
      class={`flex items-end justify-center gap-0.5 ${className}`}
      aria-hidden="true"
      style={{ height: tall ? 32 : 16 }}
    >
      {levels.map((lv, i) => (
        <span
          key={i}
          class="w-[3px] rounded-full bg-primary transition-[height] duration-75 ease-out sm:w-1"
          style={{
            height: `${Math.max(3, Math.round(lv * hMax))}px`,
            opacity: playing ? 0.55 + lv * 0.45 : 0.35,
          }}
        />
      ))}
    </div>
  );
}
