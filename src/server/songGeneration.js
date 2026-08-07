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
/** Large sur 3090 : facilement 10–20 min */
const MAX_POLLS = 400;

/** VRAM minimale indicative (Go) — aligné SongGeneration Studio. */
const MODEL_VRAM = {
  songgeneration_large: 22,
  songgeneration_base_full: 12,
  songgeneration_base_new: 10,
  songgeneration_base: 10,
};

/** Plus le rank est haut, meilleure est la qualité. */
const MODEL_RANK = {
  songgeneration_large: 4,
  songgeneration_base_full: 3,
  songgeneration_base_new: 2,
  songgeneration_base: 1,
};

/** Params d’inférence selon le modèle réellement choisi (matériel). */
const MODEL_INFER_PARAMS = {
  songgeneration_large: {
    cfg_coef: 1.95,
    temperature: 0.7,
    top_k: 40,
    top_p: 0.0,
    extend_stride: 8,
    label: "Large · qualité max",
  },
  songgeneration_base_full: {
    cfg_coef: 1.75,
    temperature: 0.78,
    top_k: 45,
    top_p: 0.0,
    extend_stride: 6,
    label: "Base Full · durée + mix",
  },
  songgeneration_base_new: {
    cfg_coef: 1.6,
    temperature: 0.82,
    top_k: 50,
    top_p: 0.0,
    extend_stride: 5,
    label: "Base New · rapide",
  },
  songgeneration_base: {
    cfg_coef: 1.5,
    temperature: 0.85,
    top_k: 50,
    top_p: 0.0,
    extend_stride: 5,
    label: "Base · rapide",
  },
};

export function resolveSongGenBaseUrl(keys) {
  const raw = keys?.songGenBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function readyModelIds(catalog) {
  const ready = Array.isArray(catalog?.ready_models)
    ? catalog.ready_models
    : Array.isArray(catalog?.models)
      ? catalog.models.filter((m) => m?.status === "ready")
      : [];
  return ready.map((m) => String(m?.id || m || "").trim()).filter(Boolean);
}

/**
 * Meilleur modèle prêt qui tient dans la VRAM actuelle.
 * Fait confiance à Studio (`default` = get_best_ready_model), avec filet de sécurité.
 *
 * @param {{ models?: array, ready_models?: array, default?: string, recommended?: string }} catalog
 * @returns {{ modelId: string, reason: string, params: object }}
 */
/**
 * Meilleur modèle prêt qui tient dans la VRAM actuelle.
 * Fait confiance à Studio (`default`), avec overrides SONOZZ :
 * - préférence utilisateur (songGenPreferredModel)
 * - Large sur carte ≥22 Go totales / ≥18 Go libres (seuil Studio 22 trop strict sur 3090)
 *
 * @param {{ models?: array, ready_models?: array, default?: string, recommended?: string }} catalog
 * @param {{ preferredId?: string|null, freeGb?: number|null, totalGb?: number|null }} [opts]
 * @returns {{ modelId: string, reason: string, params: object, vramRequired: number|null, recommendedDownload: string|null }}
 */
export function pickSongGenModel(catalog = {}, opts = {}) {
  const readyIds = readyModelIds(catalog);
  const readySet = new Set(readyIds);
  const preferredId = String(opts?.preferredId || "").trim();
  const freeGb = Number(opts?.freeGb);
  const totalGb = Number(opts?.totalGb);
  const hasFree = Number.isFinite(freeGb);
  const hasTotal = Number.isFinite(totalGb);

  const pack = (modelId, reason) => {
    const params = MODEL_INFER_PARAMS[modelId] || MODEL_INFER_PARAMS.songgeneration_base;
    return {
      modelId,
      reason,
      params,
      vramRequired: MODEL_VRAM[modelId] || null,
      recommendedDownload: !readySet.has(catalog?.recommended)
        ? catalog?.recommended || null
        : null,
    };
  };

  if (preferredId && readySet.has(preferredId)) {
    return pack(preferredId, `forcé · ${preferredId}`);
  }

  // 3090 (24 Go) : le driver + OS mangent ~3–4 Go → free < 22 alors que Large tourne
  const largeOkSoft =
    readySet.has("songgeneration_large") &&
    ((hasFree && freeGb >= 18) || (hasTotal && totalGb >= 22));
  if (largeOkSoft) {
    return pack("songgeneration_large", "auto · Large (carte 24 Go / soft VRAM)");
  }

  // Source de vérité Studio : modèle prêt + VRAM libre
  const studioBest = String(catalog?.default || "").trim();
  if (studioBest && readySet.has(studioBest)) {
    return pack(studioBest, `auto · VRAM Studio → ${studioBest}`);
  }

  // Fallback : meilleur rank parmi les ready
  let best = null;
  let bestRank = -1;
  for (const id of readyIds) {
    const rank = MODEL_RANK[id] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = id;
    }
  }
  const modelId = best || "songgeneration_base";
  return pack(modelId, `fallback · meilleur ready ${modelId}`);
}

function parseGpuFromHealth(health) {
  const g = health?.gpu?.gpu || health?.gpu || null;
  if (!g || typeof g !== "object") return { freeGb: null, totalGb: null, name: null };
  const freeGb = Number(g.free_gb);
  const totalGb = Number(g.total_gb);
  return {
    freeGb: Number.isFinite(freeGb) ? freeGb : null,
    totalGb: Number.isFinite(totalGb) ? totalGb : null,
    name: g.name ? String(g.name) : null,
    usedGb:
      Number.isFinite(Number(g.used_mb)) ? Math.round((Number(g.used_mb) / 1024) * 10) / 10 : null,
  };
}

/** @deprecated préférer pickSongGenModel(catalog) */
export function resolveQualityPreset() {
  return MODEL_INFER_PARAMS.songgeneration_large;
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

/**
 * Extrait court SongGen : intro + 1er verse + 1er chorus (pas de bridge/outro/2e couplet).
 * Vrai gain GPU vs morceau complet.
 */
export function lyricsToPreviewSections(lyricsText = "") {
  const full = lyricsToSections(lyricsText);
  const out = [];
  let hasVerse = false;
  let hasChorus = false;

  for (const s of full) {
    if (s.type === "intro" && !out.some((x) => x.type === "intro")) {
      out.push(s);
      continue;
    }
    if (s.type === "verse" && !hasVerse) {
      out.push({
        ...s,
        lyrics: s.lyrics ? String(s.lyrics).slice(0, 400) : s.lyrics,
      });
      hasVerse = true;
      continue;
    }
    if (s.type === "chorus" && !hasChorus) {
      out.push({
        ...s,
        lyrics: s.lyrics ? String(s.lyrics).slice(0, 280) : s.lyrics,
      });
      hasChorus = true;
      continue;
    }
    if (hasVerse && hasChorus) break;
  }

  if (!out.length) {
    return [
      { type: "intro", lyrics: null },
      { type: "verse", lyrics: "la la la" },
      { type: "chorus", lyrics: "oh oh oh" },
    ];
  }
  if (!hasVerse) {
    out.push({ type: "verse", lyrics: "la la la" });
  }
  if (!hasChorus) {
    out.push({ type: "chorus", lyrics: "oh oh oh" });
  }
  return out;
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

function findModelEntry(catalog, modelId) {
  const list = Array.isArray(catalog?.models) ? catalog.models : [];
  return list.find((m) => String(m?.id || "").trim() === modelId) || null;
}

/** Statut / progression d’un modèle Studio (ready, downloading, not_downloaded…). */
function modelDownloadInfo(catalog, modelId) {
  const entry = findModelEntry(catalog, modelId);
  if (!entry) {
    return {
      id: modelId,
      status: "unknown",
      progress: null,
      downloadedGb: null,
      totalGb: null,
      sizeGb: null,
      etaSeconds: null,
    };
  }
  return normalizeModelRow(entry, {});
}

function normalizeModelRow(entry, { pickedId = null, recommendedId = null } = {}) {
  const id = String(entry?.id || "").trim();
  const params = MODEL_INFER_PARAMS[id];
  const progress =
    typeof entry?.progress === "number"
      ? entry.progress
      : entry?.status === "ready"
        ? 100
        : null;
  const sizeGb = typeof entry?.size_gb === "number" ? entry.size_gb : null;
  const totalGb =
    typeof entry?.total_gb === "number" ? entry.total_gb : sizeGb;
  const status = String(entry?.status || "unknown");
  return {
    id,
    name: String(entry?.name || params?.label || id),
    description: String(entry?.description || ""),
    status,
    progress,
    downloadedGb:
      typeof entry?.downloaded_gb === "number" ? entry.downloaded_gb : null,
    totalGb,
    sizeGb,
    etaSeconds: typeof entry?.eta_seconds === "number" ? entry.eta_seconds : null,
    speedMbps: typeof entry?.speed_mbps === "number" ? entry.speed_mbps : null,
    warmth: entry?.warmth || null,
    vramRequired:
      typeof entry?.vram_required === "number"
        ? entry.vram_required
        : MODEL_VRAM[id] || null,
    rank: MODEL_RANK[id] || 0,
    qualityLabel: params?.label || null,
    isPicked: Boolean(pickedId && id === pickedId),
    isRecommended: Boolean(recommendedId && id === recommendedId),
    isLoaded: String(entry?.warmth || "") === "loaded",
  };
}

/** Catalogue Studio normalisé pour l’UI SONOZZ. */
export function normalizeSongGenCatalog(catalog = {}, pick = null) {
  const pickedId = pick?.modelId || catalog?.default || null;
  const recommendedId = catalog?.recommended || null;
  const raw = Array.isArray(catalog?.models) ? catalog.models : [];
  const models = raw
    .map((m) => normalizeModelRow(m, { pickedId, recommendedId }))
    .filter((m) => m.id)
    .sort((a, b) => (b.rank || 0) - (a.rank || 0));
  return {
    models,
    pickedModelId: pickedId,
    recommendedModelId: recommendedId,
    hasReadyModel: Boolean(catalog?.has_ready_model),
  };
}

async function fetchSongGenModelsCatalog(base) {
  return songGenFetch(base, "/api/models");
}

/**
 * Déclenche le téléchargement d’un modèle sur SongGeneration Studio
 * (POST /api/models/{id}/download — fond Hugging Face ~20 Go pour Large).
 */
export async function startSongGenModelDownload(
  keys,
  modelId = "songgeneration_large",
) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "songgeneration_large").trim();
  if (!id) throw new Error("modelId manquant");

  let catalog;
  try {
    catalog = await fetchSongGenModelsCatalog(base);
  } catch {
    catalog = null;
  }
  const info = catalog ? modelDownloadInfo(catalog, id) : null;
  if (info?.status === "ready") {
    return { ok: true, alreadyReady: true, base, modelId: id, model: info };
  }
  if (info?.status === "downloading") {
    return { ok: true, alreadyDownloading: true, base, modelId: id, model: info };
  }

  let result;
  try {
    result = await songGenFetch(base, `/api/models/${encodeURIComponent(id)}/download`, {
      method: "POST",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    // Studio répond 400 si déjà en cours / déjà prêt — on renvoie un statut propre
    if (/already downloading/i.test(msg)) {
      let mid = info;
      try {
        mid = modelDownloadInfo(await fetchSongGenModelsCatalog(base), id);
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        alreadyDownloading: true,
        base,
        modelId: id,
        model: mid || { id, status: "downloading", progress: null },
      };
    }
    if (/already downloaded|already ready/i.test(msg)) {
      return {
        ok: true,
        alreadyReady: true,
        base,
        modelId: id,
        model: { id, status: "ready", progress: 100 },
      };
    }
    throw e;
  }
  let after = info;
  try {
    after = modelDownloadInfo(await fetchSongGenModelsCatalog(base), id);
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    started: true,
    base,
    modelId: id,
    model: after,
    studio: result,
  };
}

/** Annule un téléchargement en cours (DELETE /api/models/{id}/download). */
export async function cancelSongGenModelDownload(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");
  const result = await songGenFetch(
    base,
    `/api/models/${encodeURIComponent(id)}/download`,
    { method: "DELETE" },
  );
  return { ok: true, base, modelId: id, studio: result };
}

/** Supprime un modèle téléchargé du disque Studio (DELETE /api/models/{id}). */
export async function deleteSongGenModel(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");
  const result = await songGenFetch(base, `/api/models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return { ok: true, base, modelId: id, studio: result };
}

/** Décharge le modèle actuellement en VRAM. */
export async function unloadSongGenModel(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const result = await songGenFetch(base, "/api/model-server/unload", { method: "POST" });
  return { ok: true, base, studio: result };
}

/**
 * Charge un modèle en VRAM.
 * Hot-swap Studio casse souvent (« resolver eval already registered ») —
 * on tente unload → load, puis stop/start du model-server en secours.
 */
export async function loadSongGenModel(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");

  const tryLoad = async () =>
    songGenFetch(base, `/api/model-server/load/${encodeURIComponent(id)}`, {
      method: "POST",
    });

  try {
    await songGenFetch(base, "/api/model-server/unload", { method: "POST" });
  } catch {
    /* pas de modèle chargé */
  }

  try {
    const result = await tryLoad();
    return { ok: true, base, modelId: id, loaded: true, studio: result };
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/already registered|Failed to load model/i.test(msg)) throw e;

    // Restart model-server puis reload
    try {
      await songGenFetch(base, "/api/model-server/stop", { method: "POST" });
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await songGenFetch(base, "/api/model-server/start", { method: "POST" });
    } catch (startErr) {
      return {
        ok: true,
        base,
        modelId: id,
        loaded: false,
        hotSwapIssue: true,
        message:
          "Impossible de relancer le model-server Studio. Stop/Start Pinokio, puis Retester.",
        studioError: String(startErr?.message || startErr),
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await tryLoad();
      return {
        ok: true,
        base,
        modelId: id,
        loaded: true,
        restartedServer: true,
        studio: result,
      };
    } catch (e2) {
      return {
        ok: true,
        base,
        modelId: id,
        loaded: false,
        hotSwapIssue: true,
        message:
          "Studio n’a pas pu charger le modèle après restart. Stop/Start Pinokio, puis Retester.",
        studioError: String(e2?.message || e2),
      };
    }
  }
}

export async function testSongGeneration(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const health = await songGenFetch(base, "/api/health");
  const gpu = parseGpuFromHealth(health);
  let models;
  try {
    models = await fetchSongGenModelsCatalog(base);
  } catch {
    models = null;
  }
  const ready = Boolean(models?.has_ready_model);
  const preferredId = String(keys?.songGenPreferredModel || "").trim() || null;
  const pick =
    models && ready
      ? pickSongGenModel(models, {
          preferredId,
          freeGb: gpu.freeGb,
          totalGb: gpu.totalGb,
        })
      : null;
  const readyList = readyModelIds(models || {});
  const catalog = models
    ? normalizeSongGenCatalog(models, pick)
    : { models: [] };
  const large =
    catalog.models.find((m) => m.id === "songgeneration_large") ||
    (models ? modelDownloadInfo(models, "songgeneration_large") : null);
  const needDownload =
    large && large.status !== "ready" && large.status !== "unknown"
      ? "songgeneration_large"
      : models?.recommended && !readyList.includes(models.recommended)
        ? models.recommended
        : null;

  const vramBit =
    gpu.freeGb != null && gpu.totalGb != null
      ? ` · VRAM ${gpu.freeGb}/${gpu.totalGb} Go`
      : "";

  if (models && !ready) {
    return {
      base,
      health,
      gpu,
      defaultModel: models?.default || null,
      recommended: models?.recommended || null,
      pickedModel: null,
      pickReason: "aucun modèle prêt",
      vramRequired: null,
      readyModels: [],
      qualityPreset: "auto",
      hasReadyModel: false,
      hasLarge: false,
      recommendDownload: needDownload || models?.recommended || "songgeneration_large",
      largeModel: large,
      models: catalog.models,
      preferredModel: preferredId,
      message: `Studio OK${vramBit} — aucun modèle prêt. Télécharge Large (~20 Go).`,
    };
  }

  const studioDefault = models?.default || null;
  let message = `Joignable · ${pick?.reason || `auto ${pick?.modelId}`}${vramBit}`;
  if (
    large?.status === "ready" &&
    pick?.modelId !== "songgeneration_large" &&
    studioDefault !== "songgeneration_large"
  ) {
    message += " — clique Utiliser sur Large (Studio exige 22 Go libres)";
  }

  return {
    base,
    health,
    gpu,
    defaultModel: studioDefault,
    recommended: models?.recommended || null,
    pickedModel: pick?.modelId || studioDefault || null,
    pickReason: pick?.reason || null,
    vramRequired: pick?.vramRequired || null,
    readyModels: readyList,
    qualityPreset: pick?.params?.label || "auto",
    hasReadyModel: ready || models == null,
    hasLarge: readyList.includes("songgeneration_large") || large?.status === "ready",
    recommendDownload: needDownload,
    largeModel: large,
    models: catalog.models,
    preferredModel: preferredId,
    message,
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
  { prompt, lyrics, title, gender, genre, mood, bpm, artist, preview = false } = {},
) {
  const base = resolveSongGenBaseUrl(keys);
  const sections = preview ? lyricsToPreviewSections(lyrics) : lyricsToSections(lyrics);
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

  // Modèle auto selon VRAM + préférence SONOZZ (Large soft sur 3090)
  let catalog = null;
  let gpu = { freeGb: null, totalGb: null };
  try {
    catalog = await songGenFetch(base, "/api/models");
  } catch (e) {
    console.warn("[songgen] /api/models:", e.message);
  }
  try {
    const health = await songGenFetch(base, "/api/health");
    gpu = parseGpuFromHealth(health);
  } catch {
    /* ignore */
  }
  const pick = pickSongGenModel(catalog || {}, {
    preferredId: String(keys?.songGenPreferredModel || "").trim() || null,
    freeGb: gpu.freeGb,
    totalGb: gpu.totalGb,
  });
  const modelId = pick.modelId;
  const infer = pick.params || MODEL_INFER_PARAMS.songgeneration_base;

  const body = {
    title: String(
      preview ? `${title || "SONOZZ"} · extrait` : title || "SONOZZ Track",
    ).slice(0, 120),
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
    model: modelId,
    cfg_coef: infer.cfg_coef,
    temperature: infer.temperature,
    top_k: infer.top_k,
    top_p: infer.top_p,
    extend_stride: infer.extend_stride,
  };

  console.info(
    "[songgen] start…",
    base,
    body.title,
    sections.length,
    "sections",
    preview ? "PREVIEW" : "FULL",
    `model=${body.model}`,
    `pick=${pick.reason}`,
    `vram≥${pick.vramRequired || "?"}Go`,
    `cfg=${body.cfg_coef}`,
    `temp=${body.temperature}`,
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
    model: modelId,
    quality: infer.label,
    pickReason: pick.reason,
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
    const raw = String(status?.message || `Génération SongGen ${st}`);
    let hint = raw;
    if (/resolver ['"]eval['"] is already registered/i.test(raw)) {
      hint =
        "SongGen n’a pas pu charger Large (bug hot-swap Studio). Dans Pinokio : Stop puis Start sur SongGeneration Studio, puis Retester et relance.";
    } else if (/out of memory|CUDA|VRAM/i.test(raw)) {
      hint = `VRAM insuffisante pour Large — ${raw}`;
    }
    throw new Error(hint);
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

  throw new Error(
    "Timeout SongGeneration Studio (~20 min) — modèle Large = plus long. Vérifie GPU / Pinokio.",
  );
}

export function isSongGenMusicProvider(keys) {
  return String(keys?.musicProvider || "").trim() === "songgen";
}
