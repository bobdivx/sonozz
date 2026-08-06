import { isS3Configured, downloadClipBuffer } from "./s3.js";
import { listenVoiceTimbreFromBytes } from "./musicListen.js";
import { musicArrangeToSongGen, normalizeMusicArrange } from "../lib/musicArrange.js";

/**
 * Client SongGeneration Studio (Pinokio / Demeter).
 * API : POST /api/generate → poll /api/generation/:id → GET /api/audio/:id/0
 * @see https://github.com/BazedFrog/SongGeneration-Studio
 */

const DEFAULT_BASE = "http://127.0.0.1:7860";
const POLL_MS = 3000;
const MAX_POLLS = 200; // ~10 min

export function resolveSongGenBaseUrl(keys) {
  const raw = keys?.songGenBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function errText(err) {
  return String(err?.message || err || "");
}

async function songGenFetch(baseUrl, path, { method = "GET", body } = {}) {
  const url = `${baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `SongGeneration Studio injoignable (${baseUrl}). Lance l’app dans Pinokio (Start) et vérifie l’URL. ${errText(e).slice(0, 120)}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d.msg || d).join("; ")
          : data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`SongGen ${path}: ${detail}`);
  }
  return data;
}

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

/**
 * Upload un extrait vocal vers SongGen Studio → reference_audio_id.
 * ⚠️ Un a cappella en prompt_audio produit souvent une SORTIE VOIX SEULE (le modèle clone le style).
 * Réserver aux extraits de MORCEAUX MIXÉS (voix+instru), pas à la voix perso.
 */
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

/**
 * Analyse timbre de la voix perso → texte SongGen (sans prompt_audio).
 */
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

/** MiniMax-style [Verse] / [Chorus] → sections SongGeneration Studio. */
export function lyricsToSections(lyricsText = "") {
  const text = String(lyricsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[prechorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .trim();

  if (!text) {
    return [
      { type: "intro", lyrics: null },
      { type: "verse", lyrics: "la la la" },
      { type: "chorus", lyrics: "oh oh oh" },
      { type: "outro", lyrics: null },
    ];
  }

  const tagRe = /\[([^\]]+)\]/g;
  const tags = [...text.matchAll(tagRe)];
  if (!tags.length) {
    return [
      { type: "intro", lyrics: null },
      { type: "verse", lyrics: text.slice(0, 800) },
      { type: "chorus", lyrics: text.slice(0, 400) },
      { type: "outro", lyrics: null },
    ];
  }

  const sections = [];
  for (let i = 0; i < tags.length; i++) {
    const rawType = String(tags[i][1] || "verse").trim().toLowerCase();
    const start = tags[i].index + tags[i][0].length;
    const end = i + 1 < tags.length ? tags[i + 1].index : text.length;
    const body = text.slice(start, end).trim();

    let type = "verse";
    if (/^intro/.test(rawType)) type = "intro";
    else if (/^outro/.test(rawType)) type = "outro";
    else if (/^chorus|refrain/.test(rawType)) type = "chorus";
    else if (/^bridge|pont/.test(rawType)) type = "bridge";
    else if (/^pre\s*chorus|prechorus/.test(rawType)) type = "prechorus";
    else if (/^instrumental|inst|solo/.test(rawType)) type = "instrumental";
    else if (/^verse|couplet/.test(rawType)) type = "verse";

    const vocal = ["verse", "chorus", "bridge", "prechorus"].includes(type);
    sections.push({
      type,
      lyrics: vocal && body ? body : null,
    });
  }

  return sections.length ? sections : [{ type: "verse", lyrics: text.slice(0, 800) }];
}

function mapGender(gender) {
  const g = String(gender || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (/^(female|woman|femme|f|fille)$/.test(g) || /\bfemale\b|\bfemme\b|\bwoman\b/.test(g)) {
    return "female";
  }
  if (
    /^(nonbinary|non-binary|nonbinaire|nb|androgyne)$/.test(g) ||
    /\bnon-?binary\b|\bnonbinaire\b/.test(g)
  ) {
    // SongGen n’a que male|female — on garde female comme avant, mais le prompt force androgyne
    return "female";
  }
  if (/^(male|man|homme|m|garcon|garçon|masculin)$/.test(g) || /\bmale\b|\bhomme\b|\bman\b/.test(g)) {
    return "male";
  }
  // Défaut sûr pour « mode moi » : mieux vaut explicite côté appelant
  return "male";
}

/** Empêche un styleLock / voice LLM d’écraser le sexe choisi (ex. artiste favori femme → voix femme). */
export function resolveVocalGender(artist) {
  const code = mapGender(artist?.gender || artist?.visualIdentity?.genderLock);
  const rawVoice = String(artist?.voice || artist?.styleLock?.vocalStyle || "").trim();
  const conflictsFemale =
    code === "male" && /\bfemale\b|\bfemme\b|\bwoman\b|\bsoprano\b|\bgirl\b/i.test(rawVoice);
  const conflictsMale =
    code === "female" &&
    /\bmale\b|\bhomme\b|\bman\b|\bbaritone\b|\btenor\b|\bbass\b/i.test(rawVoice) &&
    !/\bfemale\b|\bfemme\b|\bwoman\b/i.test(rawVoice);

  const voiceHint =
    code === "female" ? "female vocals, woman singer" : "male vocals, man singer";

  return {
    code,
    voiceHint,
    voiceForPrompt: conflictsFemale || conflictsMale || !rawVoice ? voiceHint : rawVoice,
  };
}

function mapGenre(genre = "") {
  // Prendre le 1er segment (évite « Indie Pop × Rock » → match rock trop agressif)
  const first = String(genre || "")
    .split(/\s*[×xX|,/]\s*/)[0]
    .trim()
    .toLowerCase();
  const g = first || String(genre || "").toLowerCase();
  if (/hip[\s-]?hop|rap|trap|drill/.test(g)) return "Hip-Hop";
  if (/r&?b|soul|neo-?soul/.test(g)) return "R&B";
  if (/metal/.test(g)) return "Metal";
  if (/rock|indie rock|punk|garage/.test(g)) return "Rock";
  if (/jazz/.test(g)) return "Jazz";
  if (/folk|acoustic|chanson/.test(g)) return "Folk";
  if (/electro|edm|dance|house|techno|hyperpop|synth/.test(g)) return "Electronic";
  if (/reggae|dancehall|afro/.test(g)) return "Reggae";
  if (/pop/.test(g)) return "Pop";
  return String(genre || "Pop").split(/[,/|×]/)[0].trim().slice(0, 40) || "Pop";
}

export async function testSongGeneration(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const health = await songGenFetch(base, "/api/health");
  let models;
  try {
    models = await songGenFetch(base, "/api/models");
  } catch {
    models = null;
  }
  const ready = Boolean(models?.has_ready_model);
  if (models && !ready) {
    throw new Error(
      `Studio OK (${base}) mais aucun modèle prêt — laisse Pinokio finir le download (~15 Go).`,
    );
  }
  return {
    base,
    health,
    defaultModel: models?.default || null,
    hasReadyModel: ready || models == null,
  };
}

/**
 * Lance une génération SongGen (réponse rapide — le client poll ensuite).
 * @returns {Promise<{ generationId: string, provider: string, base: string }>}
 */
export async function startSongGeneration(
  keys,
  { prompt, lyrics, title, gender, genre, mood, bpm, artist } = {},
) {
  const base = resolveSongGenBaseUrl(keys);
  const sections = lyricsToSections(lyrics);
  const vocal = resolveVocalGender({
    gender: gender || artist?.gender,
    voice: artist?.voice,
    styleLock: artist?.styleLock,
    visualIdentity: artist?.visualIdentity,
  });
  const stylePrefix = `${vocal.code} vocals, ${vocal.voiceHint}`;
  const lock = artist?.styleLock;
  const voiceSample = artist?.voiceSample;
  const guideMode =
    voiceSample && (voiceSample.s3Key || voiceSample.url || voiceSample.dataUrl)
      ? voiceSample.guideMode === "reference"
        ? "reference"
        : "timbre"
      : null;

  let referenceAudioId = null;
  let personalTimbre = "";

  if (guideMode === "reference") {
    try {
      referenceAudioId = await ensureSongGenVoiceReference(keys, voiceSample);
      console.info("[songgen] voice reference (UX):", referenceAudioId);
    } catch (e) {
      console.warn("[songgen] reference KO — fallback timbre:", e.message);
    }
  }

  if (guideMode === "timbre" || (guideMode === "reference" && !referenceAudioId)) {
    personalTimbre = await resolvePersonalVoiceTimbre(keys, artist);
  }

  const timbre = String(
    referenceAudioId ? "" : personalTimbre || lock?.timbre || "",
  )
    .trim()
    .slice(0, 120);

  const arrange = normalizeMusicArrange(artist?.musicArrange);
  const fromArrange = musicArrangeToSongGen(arrange, {
    styleLockInstruments: lock?.instruments,
  });

  const instruments = referenceAudioId
    ? ""
    : fromArrange.instruments ||
      (Array.isArray(lock?.instruments)
        ? lock.instruments.filter(Boolean).slice(0, 6).join(", ").slice(0, 160)
        : "") ||
      "drums, bass, guitar, synths";

  const grooveBits = [lock?.rhythmFeel, lock?.tempoFeel].filter(Boolean).join("; ");

  // En mode reference, Studio ignore souvent les descriptions — on allège.
  // En mode timbre (défaut), on force mix complet + instru + arrangement UX.
  const custom = referenceAudioId
    ? [stylePrefix, String(prompt || "").trim()].filter(Boolean).join(", ").slice(0, 500)
    : [
        stylePrefix,
        personalTimbre ? `personal voice timbre ${personalTimbre}` : "",
        timbre && !personalTimbre ? `timbre ${timbre}` : "",
        grooveBits ? `groove ${grooveBits}` : "",
        ...fromArrange.customFragments,
        String(prompt || "").trim(),
      ]
        .filter(Boolean)
        .join(", ")
        .slice(0, 500);

  const lockBpm = Number(fromArrange.bpm ?? lock?.bpm ?? bpm);
  const body = {
    title: String(title || "SONOZZ Track").slice(0, 120),
    sections,
    gender: vocal.code,
    timbre: referenceAudioId ? "" : timbre || "",
    genre: mapGenre(genre || lock?.genreSummary || lock?.genres?.[0]),
    emotion: String(mood || lock?.mood || "").slice(0, 80),
    instruments,
    custom_style: custom || stylePrefix,
    bpm: Math.min(
      200,
      Math.max(60, Number.isFinite(lockBpm) && lockBpm >= 60 ? Math.round(lockBpm) : 110),
    ),
    output_mode: "mixed",
    memory_mode: "auto",
    ...(referenceAudioId ? { reference_audio_id: referenceAudioId } : {}),
  };

  console.info(
    "[songgen] start…",
    base,
    body.title,
    sections.length,
    "sections",
    `gender=${body.gender}`,
    `genre=${body.genre}`,
    `bpm=${body.bpm}`,
    `guide=${guideMode || "none"}`,
    fromArrange.summary ? `arrange=${fromArrange.summary.slice(0, 60)}` : "arrange=∅",
    referenceAudioId
      ? `ref=${referenceAudioId}`
      : personalTimbre
        ? `voiceTimbre=${personalTimbre.slice(0, 40)}`
        : timbre
          ? `timbre=${timbre.slice(0, 40)}`
          : "timbre=∅",
  );
  const created = await songGenFetch(base, "/api/generate", { method: "POST", body });
  const genId = created?.generation_id;
  if (!genId) throw new Error("SongGen n’a pas renvoyé de generation_id");
  return {
    generationId: genId,
    provider: "songgeneration-studio",
    base,
    gender: body.gender,
    referenceAudioId: referenceAudioId || null,
    personalTimbre: personalTimbre || null,
    guideMode: guideMode || null,
  };
}

/**
 * Un tick de poll SongGen (requête courte — évite timeout proxy Cloudflare 524).
 * @returns {Promise<{ done: boolean, status: string, url?: string, durationLabel?: string, hasVocals?: boolean, generationId?: string, progress?: unknown, message?: string }>}
 */
export async function pollSongGeneration(keys, generationId) {
  const base = resolveSongGenBaseUrl(keys);
  const genId = String(generationId || "").trim();
  if (!genId) throw new Error("generationId SongGen manquant");

  const status = await songGenFetch(base, `/api/generation/${genId}`);
  const st = String(status?.status || "");
  if (st === "completed") {
    const url = `${base}/api/audio/${genId}/0`;
    const secs = Number(status?.duration);
    const durationLabel =
      Number.isFinite(secs) && secs > 0
        ? `~${Math.round(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`
        : "~2–4 min";
    console.info("[songgen] OK", genId, url);
    // Vérifie que le fichier audio répond (évite URL fantôme côté UI)
    try {
      const probe = await fetch(url, { method: "HEAD" });
      if (!probe.ok) {
        const get = await fetch(url, { headers: { Range: "bytes=0-64" } });
        if (!get.ok) {
          throw new Error(`Audio SongGen HTTP ${get.status} — fichier pas encore prêt ?`);
        }
      }
    } catch (e) {
      if (/Audio SongGen/i.test(String(e?.message || ""))) throw e;
      console.warn("[songgen] probe audio:", e?.message || e);
    }
    return {
      done: true,
      status: st,
      url,
      provider: "songgeneration-studio",
      durationLabel,
      hasVocals: true,
      generationId: genId,
    };
  }
  if (st === "failed" || st === "stopped") {
    throw new Error(status?.message || `Génération SongGen ${st}`);
  }
  return {
    done: false,
    status: st || "processing",
    progress: status?.progress,
    message: status?.message || "",
    stage: status?.stage || null,
    elapsedSeconds: Number(status?.elapsed_seconds) || 0,
    estimatedSeconds: Number(status?.estimated_seconds) || 0,
    generationId: genId,
  };
}

/**
 * Sync (pipeline A→Z) — préfère start+poll côté client pour /api/track.
 * @returns {Promise<{ url: string, provider: string, durationLabel: string, hasVocals: boolean, generationId: string }>}
 */
export async function generateMusicWithSongGeneration(
  keys,
  { prompt, lyrics, title, gender, genre, mood, bpm, artist } = {},
) {
  const started = await startSongGeneration(keys, {
    prompt,
    lyrics,
    title,
    gender,
    genre,
    mood,
    bpm,
    artist,
  });

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const tick = await pollSongGeneration(keys, started.generationId);
    if (tick.done) {
      return {
        url: tick.url,
        provider: tick.provider,
        durationLabel: tick.durationLabel || "~2–4 min",
        hasVocals: Boolean(tick.hasVocals),
        generationId: started.generationId,
      };
    }
    if (i % 10 === 0) {
      console.info(
        "[songgen] poll",
        started.generationId,
        tick.status,
        tick.progress ?? "?",
        tick.message || "",
      );
    }
  }

  throw new Error("Timeout SongGeneration Studio (~10 min) — vérifie GPU / Pinokio sur Demeter.");
}

export function isSongGenMusicProvider(keys) {
  return String(keys?.musicProvider || "").trim() === "songgen";
}
