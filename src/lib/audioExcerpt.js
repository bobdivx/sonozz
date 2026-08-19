/**
 * Extrait N secondes du morceau (offset optionnel) en WAV mono.
 * Utilise resolveAudioAsset (proxy si CORS / lien mort).
 */

import { resolveAudioAsset } from "./audioResolve.js";

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function encodeWav(audioBuffer) {
  const numChannels = 1;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * @returns {Promise<{ base64: string, mimeType: string, durationSec: number, byteLength: number, offsetSec: number }>}
 */
export async function extractTrackExcerpt(audioUrl, durationSec = 28, offsetSec = 0) {
  if (!audioUrl) throw new Error("Audio du morceau requis");

  const asset = await resolveAudioAsset(audioUrl);
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(asset.buffer.slice(0));
  } catch {
    throw new Error(
      "Impossible de décoder l’audio — lien mort ou format invalide. Va à l’étape Morceaux : régénère ou réimporte le mp3.",
    );
  } finally {
    await ctx.close().catch(() => {});
    URL.revokeObjectURL(asset.objectUrl);
  }

  const start = Math.max(0, Number(offsetSec) || 0);
  const avail = Math.max(0.5, decoded.duration - start);
  const take = Math.min(durationSec, avail);
  const sampleRate = Math.min(22050, decoded.sampleRate);
  const frameCount = Math.max(1, Math.floor(sampleRate * take));
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start(0, start, take);
  const mono = await offline.startRendering();
  const wav = encodeWav(mono);
  const buf = await wav.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return {
    base64: btoa(binary),
    mimeType: "audio/wav",
    durationSec: take,
    offsetSec: start,
    byteLength: bytes.length,
  };
}
