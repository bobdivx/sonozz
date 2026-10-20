import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FFMPEG = process.env.SONOZZ_FFMPEG || "ffmpeg";
let ffmpegOk = null;

/** ffmpeg présent dans l'image ? (apt ffmpeg dans le Dockerfile). Mis en cache. */
export async function hasFfmpeg() {
  if (ffmpegOk !== null) return ffmpegOk;
  ffmpegOk = await new Promise((resolve) => {
    try {
      const p = spawn(FFMPEG, ["-version"], { stdio: "ignore" });
      p.on("error", () => resolve(false));
      p.on("close", (c) => resolve(c === 0));
    } catch {
      resolve(false);
    }
  });
  return ffmpegOk;
}

/** Télécharge une URL audio vers un fichier temporaire (ou renvoie le chemin local). */
export async function fetchAudioToTemp(src, { fetchImpl = fetch, maxBytes = 40 * 1024 * 1024 } = {}) {
  if (!/^https?:\/\//i.test(src)) return { file: src, cleanup: () => {} };
  const res = await fetchImpl(src, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("audio trop lourd");
  const file = path.join(os.tmpdir(), `sz-qa-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.audio`);
  fs.writeFileSync(file, buf);
  return { file, cleanup: () => fs.rm(file, { force: true }, () => {}) };
}

/**
 * Décode en PCM float32 (entrelacé si stereo). offset / duration en secondes (optionnels).
 * @returns {Promise<Float32Array>}
 */
export function decodePcm(file, { sampleRate = 44100, channels = 1, offset = 0, duration = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-v", "error", "-nostdin"];
    if (offset > 0) args.push("-ss", String(offset));
    args.push("-i", file);
    if (duration > 0) args.push("-t", String(duration));
    args.push("-ac", String(channels), "-ar", String(sampleRate), "-f", "f32le", "pipe:1");
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(0, 200)}`));
      const buf = Buffer.concat(chunks);
      const out = new Float32Array(buf.length >> 2);
      for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
      resolve(out);
    });
  });
}
