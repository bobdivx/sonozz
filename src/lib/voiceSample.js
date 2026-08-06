/** Types acceptés directement par SongGeneration Studio. */
export const VOICE_SAMPLE_ACCEPT =
  "audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/flac,audio/ogg,.wav,.mp3,.flac,.ogg";

/**
 * Comment SongGen utilise l’extrait vocal perso.
 * - timbre (défaut) : analyse Gemini → descriptions texte + mix complet
 * - reference : prompt_audio SongGen (clone le style de l’extrait — a cappella → souvent voix seule)
 */
export const VOICE_GUIDE_MODES = [
  {
    id: "timbre",
    label: "Timbre (recommandé)",
    short: "Mix complet",
    hint: "Analyse ta voix et génère un morceau mixé (voix + instruments).",
  },
  {
    id: "reference",
    label: "Référence audio",
    short: "Clone audio",
    hint: "Envoie l’extrait brut à SongGen. Idéal si c’est un bout de chanson mixée — a cappella = souvent voix seule.",
  },
];

export const DEFAULT_VOICE_GUIDE_MODE = "timbre";

export function resolveVoiceGuideMode(sampleOrMode) {
  const raw =
    typeof sampleOrMode === "string"
      ? sampleOrMode
      : sampleOrMode?.guideMode || sampleOrMode?.mode;
  return raw === "reference" ? "reference" : DEFAULT_VOICE_GUIDE_MODE;
}

const ALLOWED_EXT = new Set(["wav", "mp3", "flac", "ogg"]);
const MAX_BYTES = 8_000_000;
/** SongGen n’utilise que ~10 s — on coupe côté client. */
export const VOICE_SAMPLE_MAX_SEC = 10;

export function voiceSampleExt(fileName = "", mimeType = "") {
  const fromName = String(fileName || "")
    .split(".")
    .pop()
    ?.toLowerCase();
  if (fromName && ALLOWED_EXT.has(fromName)) return fromName;
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("flac")) return "flac";
  if (m.includes("ogg")) return "ogg";
  return "wav";
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Encode un AudioBuffer en WAV PCM 16-bit mono (max `maxSec`). */
export function audioBufferToWavBlob(audioBuffer, maxSec = VOICE_SAMPLE_MAX_SEC) {
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.min(
    audioBuffer.length,
    Math.floor(Math.max(1, maxSec) * sampleRate),
  );
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = maxSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  let offset = 44;
  for (let i = 0; i < maxSamples; i++) {
    let sample = left[i] || 0;
    if (right) sample = (sample + (right[i] || 0)) / 2;
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Décode un blob audio (webm/mp3/…) et renvoie un WAV ≤ 10 s pour SongGen.
 */
export async function normalizeVoiceBlobToWav(blob, maxSec = VOICE_SAMPLE_MAX_SEC) {
  if (!blob?.size) throw new Error("Fichier audio vide");
  if (blob.size > MAX_BYTES) throw new Error("Fichier trop lourd (max ~8 Mo)");

  const name = String(blob.name || "").toLowerCase();
  const type = String(blob.type || "").toLowerCase();
  const ext = voiceSampleExt(name, type);

  // Déjà un format Studio + court → on garde (évite re-encode)
  if (ALLOWED_EXT.has(ext) && (type.includes("wav") || name.endsWith(".wav"))) {
    // Toujours re-décoder pour tronquer à 10 s
  }

  const ctx = new AudioContext();
  try {
    const ab = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    const wav = audioBufferToWavBlob(decoded, maxSec);
    if (wav.size < 1000) throw new Error("Extrait trop court — chante ou parle ~5–10 s");
    return {
      blob: wav,
      mimeType: "audio/wav",
      fileName: "voice-sample.wav",
      durationSec: Math.min(maxSec, decoded.duration),
    };
  } finally {
    await ctx.close().catch(() => {});
  }
}

export function validateVoiceFile(file) {
  if (!file) throw new Error("Fichier manquant");
  if (file.size > MAX_BYTES) throw new Error("Fichier trop lourd (max ~8 Mo)");
  const ext = voiceSampleExt(file.name, file.type);
  const okMime =
    /audio\//i.test(file.type || "") ||
    ALLOWED_EXT.has(ext) ||
    /\.(webm|m4a|mp4|aac)$/i.test(file.name || "");
  if (!okMime) {
    throw new Error("Formats : WAV, MP3, FLAC, OGG (ou enregistrement micro)");
  }
  return true;
}
