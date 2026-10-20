/**
 * Analyse complète d'une prise : blocs (voix séparée MDX) + style + défauts.
 */
import { decodePcm, fetchAudioToTemp, hasFfmpeg } from "./decode.js";
import { separateVocalsChunk, MDX_CHUNK } from "./separate.js";
import { styleFeatures, defectFeatures, voiceFeatures, decimate } from "./features.js";

export const QA_SR = 44100;
const CHUNK_SEC = MDX_CHUNK / QA_SR; // 5.92 s
/** Sondes de fin (secondes avant la fin) et part d'énergie vocale minimale pour « voix présente ». */
export const TAIL_PROBES_SEC = [38, 20];
export const TAIL_VOCAL_MIN_SHARE = 0.04;

/** Positions des blocs analysés : répartis sur le corps du morceau (évite intro / fin). */
export function blockOffsets(durationSec, nBlocks = 3) {
  const d = Number(durationSec) || 0;
  if (d <= CHUNK_SEC + 0.5) return [0];
  if (d < 45) {
    // extrait court (aperçu 30 s) : blocs régulièrement espacés
    const n = Math.min(nBlocks, Math.max(1, Math.floor(d / CHUNK_SEC)));
    const span = d - CHUNK_SEC - 0.2;
    return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (span * i) / (n - 1)));
  }
  const fr = nBlocks === 1 ? [0.45] : Array.from({ length: nBlocks }, (_, i) => 0.22 + (0.56 * i) / (nBlocks - 1));
  return fr.map((f) => Math.max(0, Math.min(d - CHUNK_SEC - 0.2, f * d)));
}

/**
 * @param {string} src URL https ou chemin local
 * @param {{duo?: boolean, requestedSec?: number, nBlocks?: number, fetchImpl?: Function}} opts
 */
export async function analyzeTake(src, { duo = false, requestedSec = null, nBlocks = 3, fetchImpl = fetch } = {}) {
  if (!(await hasFfmpeg())) return { ok: false, reason: "ffmpeg absent" };
  const t0 = Date.now();
  const { file, cleanup } = await fetchAudioToTemp(src, { fetchImpl });
  try {
    const full = await decodePcm(file, { sampleRate: 11025, channels: 1 });
    const defects = defectFeatures(full, 11025, { requestedSec });
    const offs = blockOffsets(defects.durationSec, nBlocks);
    const blocks = [];
    const vocParts = [];
    for (const off of offs) {
      const st = await decodePcm(file, { sampleRate: QA_SR, channels: 2, offset: off, duration: CHUNK_SEC + 0.05 });
      const L = new Float32Array(MDX_CHUNK);
      const R = new Float32Array(MDX_CHUNK);
      const n = Math.min(MDX_CHUNK, st.length >> 1);
      for (let i = 0; i < n; i++) { L[i] = st[2 * i]; R[i] = st[2 * i + 1]; }
      const vocal = await separateVocalsChunk(L, R);
      const mix = new Float32Array(MDX_CHUNK);
      for (let i = 0; i < MDX_CHUNK; i++) mix[i] = 0.5 * (L[i] + R[i]);
      blocks.push({ mix, vocal });
      vocParts.push(decimate(vocal, 4));
    }
    // Fin de morceau : 2 sondes (≈ fin−38 s et fin−20 s). Sans voix dans les deux → longue fin vide
    // (prod 20/10 : ~40 s d'instrumental creux en fin de titre). ≈ +4 s d'analyse, morceaux ≥ 90 s.
    if (defects.durationSec >= 90) {
      const shares = [];
      for (const back of TAIL_PROBES_SEC) {
        const off = Math.max(0, defects.durationSec - back);
        const st = await decodePcm(file, { sampleRate: QA_SR, channels: 2, offset: off, duration: CHUNK_SEC + 0.05 });
        const L = new Float32Array(MDX_CHUNK);
        const R = new Float32Array(MDX_CHUNK);
        const n = Math.min(MDX_CHUNK, st.length >> 1);
        for (let i = 0; i < n; i++) { L[i] = st[2 * i]; R[i] = st[2 * i + 1]; }
        const vocal = await separateVocalsChunk(L, R);
        let ve = 0, me = 0;
        for (let i = 0; i < MDX_CHUNK; i++) { const m = 0.5 * (L[i] + R[i]); me += m * m; ve += vocal[i] * vocal[i]; }
        shares.push(me > 0 ? Math.round((ve / me) * 1000) / 1000 : 0);
      }
      defects.tailVocalShares = shares;
      defects.tailNoVocals = shares.every((x) => x < TAIL_VOCAL_MIN_SHARE);
    }
    const vlen = vocParts.reduce((s, v) => s + v.length, 0);
    const voc = new Float32Array(vlen);
    let o = 0;
    for (const v of vocParts) { voc.set(v, o); o += v.length; }
    const style = styleFeatures(blocks, QA_SR);
    const voice = voiceFeatures(voc, QA_SR / 4, { blockLen: vocParts[0]?.length || voc.length });
    voice.duo = Boolean(duo);
    return { ok: true, defects, style, voice, blocks: offs.length, ms: Date.now() - t0 };
  } finally {
    cleanup();
  }
}

/** Style seul, sans séparation de voix (≈1–2 s) — pour comparer des aperçus candidats. */
export async function analyzeStyleQuick(src, { fetchImpl = fetch, nBlocks = 3 } = {}) {
  if (!(await hasFfmpeg())) return null;
  const { file, cleanup } = await fetchAudioToTemp(src, { fetchImpl });
  try {
    const full = await decodePcm(file, { sampleRate: 11025, channels: 1 });
    const dur = full.length / 11025;
    const blocks = [];
    for (const off of blockOffsets(dur, nBlocks)) {
      const mono = await decodePcm(file, { sampleRate: QA_SR, channels: 1, offset: off, duration: CHUNK_SEC + 0.05 });
      const mix = new Float32Array(MDX_CHUNK);
      mix.set(mono.subarray(0, Math.min(MDX_CHUNK, mono.length)));
      blocks.push({ mix, vocal: null });
    }
    return styleFeatures(blocks, QA_SR);
  } finally {
    cleanup();
  }
}
