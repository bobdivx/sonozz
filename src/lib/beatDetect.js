/**
 * Détection de beats approximative (énergie / onset) pour caler le montage.
 */

import { resolveAudioAsset } from "./audioResolve.js";

function downsampleMono(channelData, sampleRate, targetRate = 22050) {
  if (sampleRate === targetRate) return Float32Array.from(channelData);
  const ratio = sampleRate / targetRate;
  const len = Math.floor(channelData.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = channelData[Math.floor(i * ratio)] || 0;
  }
  return out;
}

/**
 * @param {AudioBuffer} buffer
 * @param {{ durationSec?: number, sensitivity?: number }} [opts]
 * @returns {{ beats: number[], bpmEstimate: number, energyCurve: number[] }}
 */
export function detectBeatsFromBuffer(buffer, { durationSec = 28, sensitivity = 1.35 } = {}) {
  const sampleRate = buffer.sampleRate;
  const maxSamples = Math.min(buffer.length, Math.floor(sampleRate * durationSec));
  const raw = buffer.getChannelData(0).subarray(0, maxSamples);
  const mono = downsampleMono(raw, sampleRate, 22050);
  const sr = 22050;

  const hop = 512;
  const energies = [];
  for (let i = 0; i + hop < mono.length; i += hop) {
    let sum = 0;
    for (let j = 0; j < hop; j++) {
      const s = mono[i + j];
      sum += s * s;
    }
    energies.push(Math.sqrt(sum / hop));
  }

  const window = 43; // ~1 s
  const beats = [];
  let lastBeat = -999;
  const minGap = Math.floor(0.28 * (sr / hop)); // ~280 ms

  for (let i = window; i < energies.length; i++) {
    let mean = 0;
    for (let k = i - window; k < i; k++) mean += energies[k];
    mean /= window;
    const e = energies[i];
    const prev = energies[i - 1] || 0;
    if (e > mean * sensitivity && e > prev && i - lastBeat >= minGap) {
      beats.push((i * hop) / sr);
      lastBeat = i;
    }
  }

  // BPM depuis médiane des intervalles
  const intervals = [];
  for (let i = 1; i < beats.length; i++) {
    const d = beats[i] - beats[i - 1];
    if (d > 0.28 && d < 1.2) intervals.push(d);
  }
  intervals.sort((a, b) => a - b);
  const median = intervals.length
    ? intervals[Math.floor(intervals.length / 2)]
    : 0.5;
  const bpmEstimate = Math.round(60 / median);

  return {
    beats: beats.filter((t) => t < durationSec),
    bpmEstimate: Number.isFinite(bpmEstimate) ? Math.min(180, Math.max(60, bpmEstimate)) : 100,
    energyCurve: energies,
  };
}

/**
 * Charge l’URL audio, décode, détecte les beats sur les N premières secondes.
 */
export async function detectBeatsFromUrl(audioUrl, durationSec = 28) {
  if (!audioUrl) return { beats: [], bpmEstimate: 100, energyCurve: [] };
  const asset = await resolveAudioAsset(audioUrl);
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(asset.buffer.slice(0));
    return detectBeatsFromBuffer(decoded, { durationSec });
  } catch {
    throw new Error(
      "Beats : audio illisible (lien expiré ?). Régénère ou réimporte le morceau.",
    );
  } finally {
    await ctx.close().catch(() => {});
    URL.revokeObjectURL(asset.objectUrl);
  }
}

/** Coupes utiles : beats forts espacés d’au moins `minGap` s. */
export function pickCutPoints(beats, { durationSec = 28, minGap = 2.2, maxCuts = 8 } = {}) {
  const cuts = [0];
  for (const t of beats) {
    if (t < 1.2 || t > durationSec - 1.5) continue;
    if (t - cuts[cuts.length - 1] >= minGap) cuts.push(t);
    if (cuts.length >= maxCuts) break;
  }
  return cuts;
}
