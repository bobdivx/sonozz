import { isS3Configured } from "../s3.js";
import { materializeAudioForStorage } from "../audioPersist.js";
import { normalizeArtistPhotos } from "../../lib/artistPhotos.js";
import {
  resolveStyleReference,
  resolveStyleReferences,
  resolveStyleTrackReference,
} from "../styleReference.js";

export function waveform() {
  return Array.from({ length: 40 }, () => 18 + Math.floor(Math.random() * 82));
}

/** Copie l’audio ACE-Step / Replicate sur S3 pour qu’ONCE et le hub artiste aient une URL durable. */
export async function persistGeneratedAudio(audioUrl, hint = "anon") {
  if (!audioUrl || typeof audioUrl !== "string") return { audioUrl: null };
  if (!isS3Configured()) return { audioUrl };
  try {
    const saved = await materializeAudioForStorage(audioUrl, {
      projectId: String(hint || "anon").slice(0, 60),
    });
    if (saved?.url) {
      return { audioUrl: saved.url, audioS3Key: saved.s3Key };
    }
  } catch (e) {
    console.warn("[pipeline] persist audio:", e.message);
  }
  return { audioUrl };
}

/** Gemini renvoie parfois un score 0–1 ; l'UI attend un pourcentage 0–100. */
function normalizeTrendScore(score) {
  let n = Number(score);
  if (!Number.isFinite(n)) return 0;
  if (n > 0 && n <= 1) n *= 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeRising(rising = []) {
  return rising.map((item) => ({
    ...item,
    score: normalizeTrendScore(item.score),
  }));
}

/** Retire data URLs / gros binaires avant envoi à Gemini (évite >1M tokens). */
export function forPrompt(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.startsWith("blob:")) return "[asset omitted]";
    if (value.length > 3500) return `${value.slice(0, 3500)}…`;
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => forPrompt(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth > 5) return "[truncated]";
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (
        /^(imageUrl|audioUrl|coverUrl|coverArtFileUrl|audioFileUrl|waveform|raw|svg)$/i.test(key)
      ) {
        out[key] = nested ? "[omitted]" : null;
        continue;
      }
      if (key === "sunoPrompt" && typeof nested === "string") {
        out[key] = nested.slice(0, 800);
        continue;
      }
      if (key === "text" && typeof nested === "string") {
        out[key] = nested.slice(0, 2500);
        continue;
      }
      if (key === "charts" && nested && typeof nested === "object") {
        out[key] = {
          topTracks: forPrompt(nested.topTracks?.slice?.(0, 6) || [], depth + 1),
          topArtists: forPrompt(nested.topArtists?.slice?.(0, 5) || [], depth + 1),
        };
        continue;
      }
      out[key] = forPrompt(nested, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 200);
}

export function promptJson(value) {
  return JSON.stringify(forPrompt(value));
}

export function slimCharts(charts) {
  return {
    tracks: (charts.tracks || []).slice(0, 10).map((t) => ({
      title: t.title,
      artist: t.artist,
      rank: t.rank,
    })),
    artists: (charts.artists || []).slice(0, 8).map((a) => ({
      name: a.name,
      fans: a.fans,
    })),
    albums: (charts.albums || []).slice(0, 5).map((a) => ({
      title: a.title,
      artist: a.artist,
    })),
    source: charts.source,
  };
}

export function slimArtistForTrends(artist) {
  if (!artist || typeof artist !== "object") return null;
  return {
    name: artist.name || null,
    aka: artist.aka || null,
    genre: artist.genre || null,
    mood: artist.mood || null,
    city: artist.city || null,
    bio: artist.bio || null,
    voice: artist.voice || null,
    influences: artist.influences || null,
    targetPersona: artist.targetPersona || null,
  };
}

export function slimStatsForTrends(stats) {
  if (!stats || typeof stats !== "object") return null;
  return {
    tracks: stats.tracks ?? null,
    distributed: stats.distributed ?? null,
    liveOnSpotify: stats.liveOnSpotify ?? null,
    streamsNote: stats.streamsNote || null,
    streams: stats.streams
      ? {
          totalStreams: stats.streams.totalStreams ?? null,
          periodChangePct: stats.streams.periodChangePct ?? null,
          topStore: stats.streams.topStore || null,
        }
      : null,
    releases: Array.isArray(stats.releases)
      ? stats.releases.slice(0, 8).map((r) => ({
          title: r.title || null,
          status: r.status || null,
          streams: r.streams?.totalStreams ?? null,
        }))
      : null,
  };
}

export function spotifyQueryForArtist(artist, market) {
  const year = new Date().getFullYear();
  const genre = String(artist?.genre || "")
    .split(/[,/&]+/)[0]
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .slice(0, 40);
  if (genre) return `${genre} year:${year - 1}-${year}`;
  return `genre:pop year:${year - 1}-${year} market:${market || "FR"}`;
}

const LANG_PROMPT = {
  fr: "français",
  en: "anglais (English)",
  es: "espagnol",
  zh: "chinois (mandarin)",
  ja: "japonais",
  pt: "portugais",
  it: "italien",
  de: "allemand",
  ar: "arabe",
};

export function resolveLanguage(code, artist) {
  const raw = (code || artist?.language || "fr").toString().toLowerCase().slice(0, 2);
  return LANG_PROMPT[raw] ? raw : "fr";
}

export function languagePromptName(code) {
  return LANG_PROMPT[resolveLanguage(code)] || "français";
}

/** Verrou visuel sexe / présentation — évite portrait femme + bio « chanteur ». */
export function genderVisualLock(gender, age) {
  const g = String(gender || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  const ageNum = Number(age);
  const ageBit =
    Number.isFinite(ageNum) && ageNum >= 13 && ageNum <= 99
      ? `${Math.round(ageNum)}-year-old `
      : "";
  if (/^(female|woman|femme|f)$/.test(g)) {
    return {
      code: "female",
      en: `${ageBit}adult woman, female singer, clearly feminine face and presentation`.trim(),
      voiceHint: "female vocals",
    };
  }
  if (/^(nonbinary|non-binary|nonbinaire|nb|androgyne)$/.test(g)) {
    return {
      code: "nonbinary",
      en: `${ageBit}androgynous adult musician, non-binary presentation, same look in every image`.trim(),
      voiceHint: "androgynous vocals",
    };
  }
  return {
    code: "male",
    en: `${ageBit}adult man, male singer, clearly masculine face and presentation`.trim(),
    voiceHint: "male vocals",
  };
}

export function normalizeAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 13 || rounded > 99) return null;
  return rounded;
}

export function normalizeSelfPhotos(photos = []) {
  return normalizeArtistPhotos(photos);
}

/** Extrait vocal mode MOI — URL S3 / clé (pas de data URL géante en DB). */
export function normalizeVoiceSample(sample) {
  if (!sample || typeof sample !== "object") return null;
  const url = typeof sample.url === "string" ? sample.url.trim() : "";
  const s3Key = typeof sample.s3Key === "string" ? sample.s3Key.trim() : "";
  if (!url && !s3Key) return null;
  const guideMode = sample.guideMode === "reference" ? "reference" : "timbre";
  return {
    url: url || undefined,
    s3Key: s3Key || undefined,
    mimeType: String(sample.mimeType || "audio/wav").slice(0, 80),
    fileName: String(sample.fileName || "voice-sample.wav")
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 80),
    byteLength: Number(sample.byteLength) || undefined,
    durationSec: Number(sample.durationSec) || undefined,
    guideMode,
    songGenTimbre: String(sample.songGenTimbre || sample.analyzedTimbre || "")
      .trim()
      .slice(0, 80) || undefined,
    analyzedTimbre: String(sample.analyzedTimbre || sample.songGenTimbre || "")
      .trim()
      .slice(0, 120) || undefined,
    vocalRegister: sample.vocalRegister
      ? String(sample.vocalRegister).slice(0, 40)
      : undefined,
    genderFeel: sample.genderFeel ? String(sample.genderFeel).slice(0, 20) : undefined,
    timbreSource: sample.timbreSource ? String(sample.timbreSource).slice(0, 40) : undefined,
    timbreAnalyzedAt: sample.timbreAnalyzedAt || undefined,
  };
}

export function serializeStyleLock(styleLock) {
  if (!styleLock) return undefined;
  return {
    query: styleLock.query,
    matchedName: styleLock.matchedName,
    source: styleLock.source,
    sourceId: styleLock.sourceId,
    confidence: styleLock.confidence,
    url: styleLock.url,
    image: styleLock.image,
    genres: styleLock.genres,
    genreSummary: styleLock.genreSummary,
    mood: styleLock.mood,
    energy: styleLock.energy,
    tempoFeel: styleLock.tempoFeel,
    bpm: styleLock.bpm,
    production: styleLock.production,
    vocalStyle: styleLock.vocalStyle,
    vocalRegister: styleLock.vocalRegister,
    timbre: styleLock.timbre,
    rhythmFeel: styleLock.rhythmFeel,
    instruments: styleLock.instruments,
    sonicKeywords: styleLock.sonicKeywords,
    writingStyle: styleLock.writingStyle,
    visualVibe: styleLock.visualVibe,
    doNot: styleLock.doNot,
    musicPrompt: styleLock.musicPrompt,
    topTracks: styleLock.topTracks,
    audioListened: Boolean(styleLock.audioListened),
    previewUrl: styleLock.previewUrl || styleLock.seedTrack?.previewUrl || undefined,
    seedTrack: styleLock.seedTrack
      ? {
          title: styleLock.seedTrack.title,
          artistName: styleLock.seedTrack.artistName,
          source: styleLock.seedTrack.source,
          sourceId: styleLock.seedTrack.sourceId,
          album: styleLock.seedTrack.album,
          url: styleLock.seedTrack.url,
          image: styleLock.seedTrack.image,
          previewUrl: styleLock.seedTrack.previewUrl || undefined,
        }
      : undefined,
    refs: Array.isArray(styleLock.refs)
      ? styleLock.refs.map((r) => ({
          matchedName: r.matchedName,
          source: r.source,
          sourceId: r.sourceId,
          image: r.image,
          genres: r.genres,
          timbre: r.timbre,
          rhythmFeel: r.rhythmFeel,
          bpm: r.bpm,
          audioListened: Boolean(r.audioListened),
        }))
      : undefined,
  };
}

export async function resolveArtistStyleLock({
  keys,
  styleArtist,
  styleArtistPick,
  styleArtistPicks,
  styleTrackPick,
}) {
  if (styleTrackPick?.source && styleTrackPick?.id) {
    return resolveStyleTrackReference(keys, styleTrackPick);
  }
  const picks = Array.isArray(styleArtistPicks)
    ? styleArtistPicks.filter((p) => p?.source && p?.id).slice(0, 5)
    : [];
  if (picks.length > 1) {
    return resolveStyleReferences(keys, picks);
  }
  if (picks.length === 1) {
    return resolveStyleReference(keys, picks[0]);
  }
  if (styleArtistPick?.source && styleArtistPick?.id) {
    return resolveStyleReference(keys, styleArtistPick);
  }
  const styleArtistHint = String(styleArtist || "").trim().slice(0, 120);
  if (styleArtistHint) {
    throw new Error(
      "Valide d'abord un artiste de référence dans les résultats de recherche (Spotify / Deezer).",
    );
  }
  return null;
}

export function withGenderInPrompt(prompt, genderEn) {
  const base = String(prompt || "").trim();
  if (!genderEn) return base;
  if (new RegExp(genderEn.split(",")[0], "i").test(base)) {
    return base;
  }
  return `${genderEn}. ${base}`.trim();
}
