import { isS3Configured, downloadClipBuffer } from "../s3.js";
import { listenVoiceTimbreFromBytes } from "../musicListen.js";
import { parseGenderCode } from "../../lib/artistGender.js";
import { resolveSongGenBaseUrl } from "./models.js";
import { errText } from "./client.js";

/**
 * Charge le buffer de l’extrait vocal perso (S3 / URL).
 * @returns {Promise<{ buffer: Buffer, mimeType: string } | null>}
 */
async function loadVoiceSampleBytes(voiceSample) {
  if (!voiceSample || typeof voiceSample !== "object") return null;
  const source = voiceSample.s3Key || voiceSample.url || voiceSample.dataUrl;
  if (!source) return null;

  if (voiceSample.s3Key && isS3Configured()) {
    const dl = await downloadClipBuffer(voiceSample.s3Key);
    return { buffer: dl.buffer, mimeType: dl.mimeType || voiceSample.mimeType || "audio/wav" };
  }
  if (/^https?:\/\//i.test(String(source))) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Téléchargement extrait vocal HTTP ${res.status}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: res.headers.get("content-type") || voiceSample.mimeType || "audio/wav",
    };
  }
  if (typeof voiceSample.dataUrl === "string" && voiceSample.dataUrl.startsWith("data:")) {
    const raw = voiceSample.dataUrl.replace(/^data:[^;]+;base64,/, "");
    return {
      buffer: Buffer.from(raw, "base64"),
      mimeType: voiceSample.mimeType || "audio/wav",
    };
  }
  return null;
}

export async function uploadSongGenReference(keys, buffer, fileName = "voice-sample.wav") {
  const base = resolveSongGenBaseUrl(keys);
  const safeName = String(fileName || "voice-sample.wav")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/\.(webm|m4a|mp4|aac)$/i, ".wav");
  const finalName = /\.(wav|mp3|flac|ogg)$/i.test(safeName)
    ? safeName
    : `${safeName}.wav`;

  const form = new FormData();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const file =
    typeof File !== "undefined"
      ? new File([bytes], finalName, { type: "audio/wav" })
      : new Blob([bytes], { type: "audio/wav" });
  form.append("file", file, finalName);

  let res;
  try {
    res = await fetch(`${base}/api/upload-reference`, {
      method: "POST",
      body: form,
    });
  } catch (e) {
    throw new Error(
      `Upload voix → SongGen injoignable (${base}). ${errText(e).slice(0, 120)}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`SongGen upload-reference: ${detail}`);
  }
  const id = data?.id;
  if (!id) throw new Error("SongGen n’a pas renvoyé d’id de référence vocale");
  return { id: String(id), filename: data.filename || finalName };
}

/**
 * Charge un voiceSample (S3/URL) dans SongGen et renvoie reference_audio_id.
 * À n’utiliser que pour une référence de STYLE mixé — pas pour la voix a cappella perso.
 */
export async function ensureSongGenVoiceReference(keys, voiceSample) {
  const loaded = await loadVoiceSampleBytes(voiceSample);
  if (!loaded?.buffer?.length) return null;

  const mimeType = loaded.mimeType || "audio/wav";
  const ext =
    /\.wav$/i.test(voiceSample.fileName || "") || /wav/i.test(mimeType)
      ? "wav"
      : /\.mp3$/i.test(voiceSample.fileName || "") || /mpeg|mp3/i.test(mimeType)
        ? "mp3"
        : /\.flac$/i.test(voiceSample.fileName || "") || /flac/i.test(mimeType)
          ? "flac"
          : /\.ogg$/i.test(voiceSample.fileName || "") || /ogg/i.test(mimeType)
            ? "ogg"
            : "wav";

  const uploaded = await uploadSongGenReference(
    keys,
    loaded.buffer,
    voiceSample.fileName || `voice-sample.${ext}`,
  );
  return uploaded.id;
}

async function resolvePersonalVoiceTimbre(keys, artist) {
  const sample = artist?.voiceSample;
  if (!sample) return "";
  const cached = String(sample.songGenTimbre || sample.analyzedTimbre || "").trim();
  if (cached) return cached.slice(0, 80);

  if (!keys?.geminiApiKey?.trim()) return "";
  try {
    const loaded = await loadVoiceSampleBytes(sample);
    if (!loaded?.buffer?.length) return "";
    const dna = await listenVoiceTimbreFromBytes(keys.geminiApiKey, {
      buffer: loaded.buffer,
      mimeType: loaded.mimeType,
      artistName: artist?.name || artist?.aka,
    });
    return String(dna?.songGenTimbre || dna?.timbre || "").trim().slice(0, 80);
  } catch (e) {
    console.warn("[songgen] analyse voix perso:", e.message);
    return "";
  }
}

function mapGender(gender) {
  const code = parseGenderCode(gender);
  if (code === "female" || code === "nonbinary") {
    // SongGen n’a que male|female — non-binaire → female, prompt androgyne ailleurs
    return "female";
  }
  return "male";
}

const FEMALE_VOICE_RE =
  /\bfemale\b|\bfemme\b|\bwoman\b|\bwomen\b|\bgirl\b|\bsoprano\b|\bmezzo\b|\balto\b|\bfeminine\b|\blady\b|\bbreathy\b|\bairy\b|\bsweet\b|\bdelicate\b|\bsoft high\b|\bhigh pitch\b|\blight vocal\b/i;
/** Timbre « féminisant » même sans le mot female (souvent venant du styleLock). */
const FEMININE_TIMBRE_RE =
  /\b(bright|soft|airy|sweet|breathy|delicate|whisper|light|sparkly|girlish|angelic)\b/i;
const MASCULINE_TIMBRE_RE =
  /\b(deep|warm|low|baritone|tenor|rich|raspy|gritty|powerful|masculine)\b/i;
const MALE_VOICE_RE =
  /\bmale\b|\bhomme\b|\bman\b|\bmen\b|\bboy\b|\bbaritone\b|\btenor\b|\bbass vocal\b|\bmasculine\b|\bguy\b/i;

/** Retire les indices de voix du sexe opposé (styleLock / réf. artiste). */
function stripOppositeGender(text, genderCode) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (genderCode === "female" && MALE_VOICE_RE.test(raw) && !FEMALE_VOICE_RE.test(raw)) {
    return "";
  }
  if (genderCode === "male" && FEMALE_VOICE_RE.test(raw) && !MALE_VOICE_RE.test(raw)) {
    return "";
  }
  if (genderCode === "female") {
    return raw
      .replace(/\b(male|man|men|boy|baritone|tenor|masculine|guy)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return raw
    .replace(/\b(female|woman|women|girl|soprano|mezzo|alto|feminine|lady)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function conflictsGenderText(text, genderCode) {
  const raw = String(text || "");
  if (!raw) return false;
  if (genderCode === "male") return FEMALE_VOICE_RE.test(raw) && !MALE_VOICE_RE.test(raw);
  if (genderCode === "female") return MALE_VOICE_RE.test(raw) && !FEMALE_VOICE_RE.test(raw);
  return false;
}

/** Empêche un styleLock / voice LLM d’écraser le sexe choisi (ex. artiste favori femme → voix femme). */
export function resolveVocalGender(artist) {
  const code = mapGender(
    artist?.gender || artist?.visualIdentity?.genderLock || artist?.visualIdentity?.gender,
  );
  const rawVoice = String(artist?.voice || artist?.styleLock?.vocalStyle || "").trim();
  const safeVoice = stripOppositeGender(rawVoice, code);
  const conflicts = conflictsGenderText(rawVoice, code);

  const voiceHint =
    code === "female" ? "female vocals, woman singer" : "male vocals, man singer";

  return {
    code,
    voiceHint,
    voiceForPrompt: conflicts || !safeVoice ? voiceHint : safeVoice,
  };
}

function shortTimbre(raw = "") {
  const t = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // Garder 2–5 mots max
  return t.split(/[;,]/)[0].trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 48);
}

/** Timbre aligné sur le sexe — hard-lock (le styleLock / auto_prompt fuit souvent vers une voix femme). */
function timbreForGender(genderCode, voiceSample, lock, _voiceDesc = "", { metal = false, extreme = false } = {}) {
  if (metal) {
    const fromLock = shortTimbre(lock?.timbre || lock?.vocalStyle || "");
    if (fromLock && /growl|scream|harsh|guttural|rasp|death|shout/.test(fromLock)) {
      return stripOppositeGender(fromLock, genderCode) || fromLock;
    }
    if (extreme) {
      return genderCode === "female" ? "harsh screamed vocals" : "guttural death growl";
    }
    return genderCode === "female" ? "aggressive metal vocals" : "aggressive raspy metal";
  }

  // Défauts forts : ne pas faire confiance au styleLock (réf. souvent femme).
  if (genderCode === "female") {
    const personal = shortTimbre(
      voiceSample?.songGenTimbre || voiceSample?.analyzedTimbre || "",
    );
    if (personal && !conflictsGenderText(personal, "female") && !/\b(vocoder|autotune)\b/i.test(personal)) {
      return stripOppositeGender(personal, "female") || "natural female";
    }
    return "natural female";
  }

  const personal = shortTimbre(
    voiceSample?.songGenTimbre || voiceSample?.analyzedTimbre || "",
  );
  if (
    personal &&
    !conflictsGenderText(personal, "male") &&
    !FEMININE_TIMBRE_RE.test(personal) &&
    (MASCULINE_TIMBRE_RE.test(personal) || MALE_VOICE_RE.test(personal)) &&
    !/\b(vocoder|autotune)\b/i.test(personal)
  ) {
    return stripOppositeGender(personal, "male") || "natural male";
  }

  // « grave / autotune » du profil LLM → vocoder chez LeVo. On reste dry.
  return "natural male";
}

export {
  FEMININE_TIMBRE_RE,
  MASCULINE_TIMBRE_RE,
  MALE_VOICE_RE,
  stripOppositeGender,
  conflictsGenderText,
  timbreForGender,
};
