import { isStudioEnabled } from "../../lib/keys.js";
import {
  defaultBpmForGenre,
  isExtremeMetalLane,
  isMetalLane,
  mapGenreForStudio,
  styleLockGenreBlob,
  withKnownArtistLane,
} from "../../lib/musicLane.js";
import {
  normalizeFeatArtist,
  duoSongGenStyleTags,
  duoVocalPromptBits,
} from "../../lib/featArtist.js";
import {
  musicArrangeToSongGen,
  normalizeMusicArrange,
  musicArrangeFromStyleLock,
  isDefaultMusicArrange,
} from "../../lib/musicArrange.js";
import {
  resolveSongGenBaseUrl,
  pickSongGenModel,
  MODEL_INFER_PARAMS,
} from "./models.js";
import { songGenFetch, parseGpuFromHealth } from "./client.js";
import { lyricsToSections, lyricsToPreviewSections } from "./lyrics.js";
import { resolveVocalGender, timbreForGender, FEMININE_TIMBRE_RE } from "./voice.js";
import {
  mapEmotionForStudio,
  genreFlavorTags,
  buildSongGenStyleTags,
  buildSongGenInstruments,
} from "./style.js";

const POLL_MS = 3000;
/** Large sur 3090 : facilement 10–20 min */
const MAX_POLLS = 400;

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
  const lock = withKnownArtistLane(artist?.styleLock);
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

  // Arrangement : si vide → déduire du styleLock (titre / artiste de référence)
  let arrange = normalizeMusicArrange(artist?.musicArrange);
  if (isDefaultMusicArrange(arrange) && lock) {
    arrange = musicArrangeFromStyleLock(lock);
  }
  const fromArrange = musicArrangeToSongGen(arrange, {
    styleLockInstruments: lock?.instruments,
    styleLock: lock,
  });
  const gospel = Boolean(fromArrange.gospel);
  const wantsChoir = Boolean(fromArrange.wantsChoir);

  // Joindre TOUS les genres : iTunes « Rock » + « Death Metal » doit matcher Metal, pas Rock.
  const genreHint = gospel
    ? "gospel soul R&B"
    : styleLockGenreBlob(lock, [genre, artist?.genre]);
  const studioGenre = mapGenreForStudio(genreHint);
  const metal = isMetalLane(genreHint);
  const extreme = isExtremeMetalLane(genreHint);

  const cachedTimbre = timbreForGender(vocal.code, voiceSample, lock, artist?.voice, {
    metal,
    extreme,
  });

  const instruments = buildSongGenInstruments(lock, fromArrange, { gospel, studioGenre });

  const styleTags = buildSongGenStyleTags(lock, fromArrange, vocal.code, {
    language: artist?.language || lyrics?.language,
    metal,
    extreme,
  });
  for (const flavor of genreFlavorTags(genreHint)) {
    if (!styleTags.some((t) => t.toLowerCase() === flavor.toLowerCase())) {
      styleTags.push(flavor);
    }
  }

  // Duo : tags séparés (voix feat) — sans stripOppositeGender du lead
  const feat = normalizeFeatArtist(artist?.featArtist);
  if (feat) {
    for (const t of duoSongGenStyleTags(artist, feat)) {
      if (!styleTags.some((x) => x.toLowerCase() === String(t).toLowerCase())) {
        styleTags.push(t);
      }
    }
    // Remplacer le monologue « natural male/female vocals » par le duo nommé
    const duoBits = duoVocalPromptBits(artist, feat);
    for (const bit of duoBits.slice(0, 3)) {
      const short = String(bit).slice(0, 48);
      if (short && !styleTags.some((x) => x.toLowerCase() === short.toLowerCase())) {
        styleTags.push(short);
      }
    }
  }

  // PAS d’instruments ici : déjà dans le champ dédié. Les dupliquer sature LeVo
  // (voix robotique + mix brouillon).
  const custom = styleTags
    .filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i)
    .slice(0, preview ? (feat ? 12 : 10) : feat ? 16 : 14)
    .join(", ")
    .slice(0, preview ? 260 : 420);

  const lockBpm = Number(fromArrange.bpm ?? lock?.bpm ?? bpm);
  const genreBpm = defaultBpmForGenre(genreHint);

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
  const infer = { ...(pick.params || MODEL_INFER_PARAMS.songgeneration_base) };
  // Preview : stride court (Large=8 allonge le drone) + CFG un cran plus bas (moins de saturation)
  if (preview) {
    infer.extend_stride = Math.min(Number(infer.extend_stride) || 5, 4);
    infer.cfg_coef = Math.min(Number(infer.cfg_coef) || 1.7, 1.7);
  } else {
    // Full : plafond anti-saturation (évite les presets >1.9 hérités)
    infer.cfg_coef = Math.min(Number(infer.cfg_coef) || 1.8, 1.85);
  }

  let emotionRaw = mapEmotionForStudio(mood || lock?.mood || "", {
    gospel,
    wantsChoir,
    genreHint,
  });
  if (vocal.code === "male" && FEMININE_TIMBRE_RE.test(emotionRaw)) {
    emotionRaw = "energetic";
  }

  const body = {
    title: String(
      preview ? `${title || "SONOZZ"} · extrait` : title || "SONOZZ Track",
    ).slice(0, 120),
    sections,
    gender: vocal.code,
    timbre: cachedTimbre,
    genre: studioGenre,
    emotion: emotionRaw.slice(0, 40),
    instruments,
    custom_style: custom,
    bpm: Math.min(
      200,
      Math.max(
        60,
        Number.isFinite(lockBpm) && lockBpm >= 60 ? Math.round(lockBpm) : genreBpm,
      ),
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
    `emotion=${body.emotion}`,
    `choir=${fromArrange.choir || "none"}`,
    `bpm=${body.bpm}`,
    `instruments=${body.instruments.slice(0, 80)}`,
    `timbre=${body.timbre}`,
    `feat=${feat?.name || "no"}`,
    `style=${body.custom_style.slice(0, 120)}`,
    `lock=${lock ? "yes" : "NO"}`,
    `lyric0=${String(sections[0]?.lyrics || "").slice(0, 60).replace(/\n/g, " / ")}`,
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
  return String(keys?.musicProvider || "").trim() === "songgen" && isStudioEnabled(keys, "songgen");
}
