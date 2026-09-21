/**
 * Analyseur audio partagé pour les barres « live » (Now Playing / overlay).
 * Un seul MediaElementSource par élément <audio> — attaché une fois.
 */

import { getPlayAudio } from "./playEngine.js";

/** @type {AudioContext | null} */
let ctx = null;
/** @type {AnalyserNode | null} */
let analyser = null;
let wired = false;

export function ensurePlayAnalyser() {
  if (typeof window === "undefined") return null;
  const el = getPlayAudio();
  if (!el) return null;

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;

  if (!ctx) {
    ctx = new AC();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
  }

  if (!wired) {
    try {
      const src = ctx.createMediaElementSource(el);
      src.connect(analyser);
      analyser.connect(ctx.destination);
      wired = true;
    } catch {
      /* déjà câblé (HMR / double mount) */
      wired = true;
    }
  }

  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  return analyser;
}

/** Niveaux 0–1 pour `count` barres (basses → aigus). */
export function samplePlayLevels(count = 5) {
  if (!analyser) {
    return Array.from({ length: count }, () => 0.12);
  }
  const bins = analyser.frequencyBinCount;
  const data = new Uint8Array(bins);
  analyser.getByteFrequencyData(data);
  const out = [];
  const usable = Math.max(8, Math.floor(bins * 0.55));
  for (let i = 0; i < count; i++) {
    const start = Math.floor((i / count) * usable);
    const end = Math.floor(((i + 1) / count) * usable);
    let sum = 0;
    const n = Math.max(1, end - start);
    for (let j = start; j < end; j++) sum += data[j] || 0;
    const v = sum / n / 255;
    out.push(Math.min(1, 0.08 + v * 1.15));
  }
  return out;
}
