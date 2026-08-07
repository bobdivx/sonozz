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

/**
 * Genre pour SongGeneration Studio.
 * Doit matcher GENRE_TO_AUTO_PROMPT (clés lowercased) pour activer auto_prompt_audio
 * = extrait musical de la librairie → instruments. Sinon "Auto".
 * @see BazedFrog/SongGeneration-Studio generation.py
 */
function mapGenreForStudio(genre = "") {
  const g = String(genre || "")
    .split(/\s*[×xX|,/]\s*/)[0]
    .trim()
    .toLowerCase();
  if (/gospel|inspirational|choir|spiritual|worship/.test(g)) return "R&B";
  if (/hip[\s-]?hop|rap|trap|drill|boom\s*bap/.test(g)) return "Pop"; // Studio n’a pas Hip-Hop dans sa map → Pop + instru
  if (/r&?b|soul|neo-?soul/.test(g)) return "R&B";
  if (/metal/.test(g)) return "Metal";
  if (/rock|punk|garage|indie rock/.test(g)) return "Rock";
  if (/jazz/.test(g)) return "Jazz";
  if (/folk|acoustic|chanson|country/.test(g)) return "Folk";
  if (/electro|edm|dance|house|techno|hyperpop|synth|electronic/.test(g)) return "Electronic";
  if (/reggae|dancehall|afro/.test(g)) return "Reggae";
  if (/latin|reggaeton|salsa/.test(g)) return "Pop";
  if (/pop/.test(g)) return "Pop";
  return "Pop";
}

/** Timbre court pour le champ Studio (évite les pavés Gemini qui dégradent). */
function shortTimbre(raw = "") {
  const t = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  // Garder 2–5 mots max
  return t.split(/[;,]/)[0].trim().split(/\s+/).slice(0, 5).join(" ").slice(0, 48);
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
 *
 * Règle d’or : JAMAIS d’extrait a cappella en reference_audio_id.
 * Studio clone alors le style → sortie voix seule. On force auto_prompt + instruments.
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
  const lock = artist?.styleLock;
  const voiceSample = artist?.voiceSample;
  const wantsReference =
    voiceSample?.guideMode === "reference" &&
    (voiceSample.s3Key || voiceSample.url || voiceSample.dataUrl);

  // Référence audio perso désactivée côté génération (casse le mix).
  // On log si l’UX demandait encore "reference".
  if (wantsReference) {
    console.warn(
      "[songgen] guideMode=reference ignoré — un a cappella en prompt_audio sort voix seule. Mix forcé.",
    );
  }

  // Timbre : court, optionnel. Pas d’analyse Gemini à chaque gen (voix souvent pire).
  const cachedTimbre = shortTimbre(
    voiceSample?.songGenTimbre || voiceSample?.analyzedTimbre || lock?.timbre || "",
  );

  const arrange = normalizeMusicArrange(artist?.musicArrange);
  const fromArrange = musicArrangeToSongGen(arrange, {
    styleLockInstruments: lock?.instruments,
  });
  const gospel = Boolean(fromArrange.gospel);
  const wantsChoir = Boolean(fromArrange.wantsChoir);

  // Défaut bande complète — JAMAIS un seul instrument (style-lock pauvre → mix nul)
  const defaultInstru = gospel
    ? "gospel choir, church organ, piano, bass, drums"
    : "bass, piano, electric guitar, drums, synths, pads";
  let instruments = (fromArrange.instruments || "").trim();
  if (!instruments) {
    instruments = (
      (Array.isArray(lock?.instruments)
        ? lock.instruments.filter(Boolean).slice(0, 4).join(", ")
        : "") || defaultInstru
    );
  }
  // Si style-lock / arrange n’a renvoyé qu’1–2 tags, compléter
  const instruCount = instruments.split(",").map((s) => s.trim()).filter(Boolean).length;
  if (instruCount < 4) {
    const merged = [
      ...instruments.split(",").map((s) => s.trim()).filter(Boolean),
      ...defaultInstru.split(",").map((s) => s.trim()),
    ];
    const seen = new Set();
    instruments = merged
      .filter((t) => {
        const k = t.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8)
      .join(", ");
  }
  instruments = instruments.slice(0, 160);

  // Gospel / chœur → ancrer R&B pour auto_prompt Studio (pas de genre Gospel natif)
  const genreHint = gospel
    ? "gospel soul R&B"
    : genre || lock?.genreSummary || lock?.genres?.[0] || artist?.genre;
  const studioGenre = mapGenreForStudio(genreHint);

  // Fragments arrangement d’abord (chœur), puis garde-fous mix — filtre a cappella corrigé
  const arrangeFrags = (fromArrange.customFragments || []).filter((f) => {
    const s = String(f || "");
    if (/\bnot\s+a\s*cappella\b|\bnot\s+vocals\s+only\b/i.test(s)) return true;
    if (/\ba\s*cappella\b|\bvocals\s+only\b/i.test(s)) return false;
    return true;
  });

  const mixGuard = gospel
    ? [
        "full mixed song with lead vocal, gospel choir and band",
        "choir and organ clearly audible",
        "balanced drums supporting the choir, never drums-only",
        "rich multi-instrument arrangement",
      ]
    : wantsChoir
      ? [
          "full band mix with rich instrumental accompaniment",
          "backing vocals clearly present",
          "bass, keys or guitar, and drums all audible",
          "never a single-instrument loop",
        ]
      : [
          "full band radio-ready mix",
          "lead vocal over complete arrangement",
          "bass, harmony instruments, and drums all present",
          "never a cappella, never vocals-only, never drums-only, never single-instrument",
        ];

  const custom = [
    ...arrangeFrags,
    ...mixGuard,
    lock?.rhythmFeel ? `groove ${lock.rhythmFeel}` : "",
    cachedTimbre ? `vocal timbre ${cachedTimbre}` : "",
    String(prompt || "")
      .replace(/\bexactly in the style of\b[^,]*/gi, "")
      .slice(0, 140),
  ]
    .filter(Boolean)
    .join(", ")
    .slice(0, 480);

  const lockBpm = Number(fromArrange.bpm ?? lock?.bpm ?? bpm);
  const body = {
    title: String(title || "SONOZZ Track").slice(0, 120),
    sections,
    gender: vocal.code,
    timbre: cachedTimbre || (vocal.code === "female" ? "bright" : "warm"),
    genre: studioGenre,
    emotion: String(mood || lock?.mood || (gospel ? "uplifting" : "energetic"))
      .split(/[,/|]/)[0]
      .trim()
      .slice(0, 40),
    instruments,
    custom_style: custom,
    bpm: Math.min(
      200,
      Math.max(60, Number.isFinite(lockBpm) && lockBpm >= 60 ? Math.round(lockBpm) : 110),
    ),
    output_mode: "mixed",
    memory_mode: "auto",
  };

  console.info(
    "[songgen] start…",
    base,
    body.title,
    sections.length,
    "sections",
    `gender=${body.gender}`,
    `genre=${body.genre}`,
    `choir=${fromArrange.choir || "none"}`,
    `bpm=${body.bpm}`,
    `instruments=${body.instruments.slice(0, 80)}`,
    `timbre=${body.timbre}`,
    "ref=OFF mix=forced",
  );
  const created = await songGenFetch(base, "/api/generate", { method: "POST", body });
  const genId = created?.generation_id;
  if (!genId) throw new Error("SongGen n’a pas renvoyé de generation_id");
  return {
    generationId: genId,
    provider: "songgeneration-studio",
    base,
    gender: body.gender,
    referenceAudioId: null,
    personalTimbre: cachedTimbre || null,
    guideMode: "timbre",
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
