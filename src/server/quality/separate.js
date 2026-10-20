/**
 * Séparation de la VOIX dans le process Node (onnxruntime-node + modèle MDX-Net « Kim_Vocal_2 »,
 * modèle public UVR). Aucun service externe : le modèle est copié dans l'image Docker
 * (/app/models) ou, à défaut, téléchargé une fois dans un cache local.
 *
 * Paramètres du modèle (UVR model_data) : n_fft 7680, hop 1024, dim_f 3072, dim_t 256,
 * entrée [1, 4, 3072, 256] = (L.re, L.im, R.re, R.im). Bloc = 261 120 échantillons (5,92 s à 44,1 kHz).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stft, istft, hann } from "./fft.js";

export const MDX = { nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, sampleRate: 44100 };
export const MDX_CHUNK = MDX.hop * (MDX.dimT - 1); // 261120
export const VOCAL_MODEL_URL =
  "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx";

let sessionPromise = null;
let ortMod = null;
const WIN = hann(MDX.nFft);

function modelCandidates() {
  return [
    process.env.SONOZZ_VOCAL_MODEL,
    "/app/models/Kim_Vocal_2.onnx",
    path.join(process.cwd(), "models", "Kim_Vocal_2.onnx"),
    path.join(os.tmpdir(), "sonozz-models", "Kim_Vocal_2.onnx"),
  ].filter(Boolean);
}

async function ensureModelFile({ fetchImpl = fetch } = {}) {
  for (const p of modelCandidates()) if (fs.existsSync(p) && fs.statSync(p).size > 1e7) return p;
  // Dernier recours (dev / image sans modèle) : téléchargement unique dans le cache tmp.
  const dest = path.join(os.tmpdir(), "sonozz-models", "Kim_Vocal_2.onnx");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetchImpl(VOCAL_MODEL_URL, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`modèle voix HTTP ${res.status}`);
  fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${dest}.part`, dest);
  return dest;
}

export async function loadOrt() {
  if (ortMod) return ortMod;
  ortMod = await import("onnxruntime-node");
  return ortMod.default || ortMod;
}

export async function getVocalSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadOrt();
      const file = await ensureModelFile();
      return ort.InferenceSession.create(file, {
        intraOpNumThreads: Math.max(1, Math.min(4, Number(process.env.SONOZZ_QA_THREADS) || 2)),
        graphOptimizationLevel: "all",
      });
    })().catch((e) => {
      sessionPromise = null;
      throw e;
    });
  }
  return sessionPromise;
}

/**
 * Isole la voix d'un bloc stéréo (L, R : Float32Array de longueur MDX_CHUNK, 44,1 kHz).
 * @returns {Promise<Float32Array>} voix mono (moyenne L/R), même longueur.
 */
export async function separateVocalsChunk(L, R) {
  const ort = await loadOrt();
  const session = await getVocalSession();
  const { nFft, hop, dimF, dimT } = MDX;
  const SL = stft(L, { nFft, hop, window: WIN, keepBins: dimF });
  const SR = stft(R, { nFft, hop, window: WIN, keepBins: dimF });
  const plane = dimF * dimT;
  const input = new Float32Array(4 * plane);
  // tensor [1,4,F,T] ; nos STFT sont [T][F]
  for (let t = 0; t < dimT; t++) {
    for (let f = 0; f < dimF; f++) {
      const s = t * dimF + f;
      const d = f * dimT + t;
      input[d] = SL.re[s];
      input[plane + d] = SL.im[s];
      input[2 * plane + d] = SR.re[s];
      input[3 * plane + d] = SR.im[s];
    }
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 4, dimF, dimT]) });
  const o = out[session.outputNames[0]].data;
  // voix mono = moyenne des spectres L/R (linéaire)
  const re = new Float32Array(plane);
  const im = new Float32Array(plane);
  for (let t = 0; t < dimT; t++) {
    for (let f = 0; f < dimF; f++) {
      const d = f * dimT + t;
      re[t * dimF + f] = 0.5 * (o[d] + o[2 * plane + d]);
      im[t * dimF + f] = 0.5 * (o[plane + d] + o[3 * plane + d]);
    }
  }
  return istft(re, im, { nFft, hop, frames: dimT, bins: dimF, length: L.length, window: WIN });
}
