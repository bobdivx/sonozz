import { generateVisual } from "./images.js";
import { fetchDeezerCharts } from "./deezer.js";
import { prepareSpotifyRelease, getSpotifyAccess, spotifySearchContext } from "./spotify.js";
import {
  checkArtistNameAvailability,
  resolveStyleReference,
  resolveStyleReferences,
  resolveStyleTrackReference,
} from "./styleReference.js";
import { submitOnceRelease } from "./once.js";
import {
  generateMusicWithReplicate,
  startMinimaxMusic,
  pollMinimaxMusic,
  cancelMinimaxMusic,
} from "./replicate.js";
import {
  generateMusicWithSongGeneration,
  startSongGeneration,
  pollSongGeneration,
  isSongGenMusicProvider,
  resolveVocalGender,
} from "./songGeneration.js";
import {
  generateMusicWithAceStep,
  startAceStep,
  pollAceStep,
  cancelAceStep,
  isAceStepMusicProvider,
  resolveAceVocalLanguage,
} from "./aceStep.js";
import { isLanguageOkForProvider, songGenLanguageHint } from "../lib/studio.js";
import {
  artefactGuardsFromLock,
  buildLyricsCraftBrief,
  coalesceGenres,
  defaultBpmForGenre,
  detectLyricsForm,
  isMetalLane,
  metalFlavorTags,
  metalVoiceHint,
  styleLockGenreBlob,
  withKnownArtistLane,
} from "../lib/musicLane.js";
import { normalizeAndValidateLyrics } from "../lib/lyricsStructure.js";
import { normalizeArtistPhotos } from "../lib/artistPhotos.js";
import { isStudioEnabled } from "../lib/keys.js";
import { isUsableRasterImage, materializeImageForStorage } from "./imagePersist.js";
import { materializeAudioForStorage } from "./audioPersist.js";
import { isS3Configured } from "./s3.js";
import { slugify, getArtistBySlug, resolveArtistProfileForRelease } from "./artists.js";
import {
  normalizeFeatArtist,
  duoVocalPromptBits,
  duoStylePromptBits,
  duoCoverPromptBits,
  duoLyricsInstruction,
  displayArtistCredit,
  vocalLockForArtist,
} from "../lib/featArtist.js";
import { llmJson, requireTextLlm } from "./llm.js";
import {
  musicArrangeToSongGen,
  normalizeMusicArrange,
  musicArrangeFromStyleLock,
  isDefaultMusicArrange,
} from "../lib/musicArrange.js";
import { buildSunoPrompt } from "../lib/sunoPrompt.js";
import { resolveArtistGender, withResolvedArtistGender } from "../lib/artistGender.js";
import {
  FREE_NAME_PER_ROUND,
  formatNameCollisions,
  resolveFreeGeneratedStageName,
} from "./artistName.js";

function waveform() {
  return Array.from({ length: 40 }, () => 18 + Math.floor(Math.random() * 82));
}

/** Copie l’audio ACE-Step / Replicate sur S3 pour qu’ONCE et le hub artiste aient une URL durable. */
async function persistGeneratedAudio(audioUrl, hint = "anon") {
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

function normalizeRising(rising = []) {
  return rising.map((item) => ({
    ...item,
    score: normalizeTrendScore(item.score),
  }));
}

/** Retire data URLs / gros binaires avant envoi à Gemini (évite >1M tokens). */
function forPrompt(value, depth = 0) {
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

function promptJson(value) {
  return JSON.stringify(forPrompt(value));
}

function slimCharts(charts) {
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

function slimArtistForTrends(artist) {
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

function slimStatsForTrends(stats) {
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

function spotifyQueryForArtist(artist, market) {
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

export async function runTrends({ keys, market = "FR", artist = null, stats = null, artistSlug = null }) {
  requireTextLlm(keys);
  const charts = await fetchDeezerCharts();

  let resolvedArtist = slimArtistForTrends(artist);
  let resolvedStats = slimStatsForTrends(stats);

  const slug = artistSlug || artist?.slug;
  if (slug && (!resolvedArtist?.name || !resolvedStats)) {
    try {
      const row = await getArtistBySlug(slug);
      if (row) {
        if (!resolvedArtist?.name) {
          resolvedArtist = slimArtistForTrends({ ...row.profile, name: row.name, slug: row.slug });
        }
        if (!resolvedStats) resolvedStats = slimStatsForTrends(row.stats);
      }
    } catch {
      /* optional */
    }
  }

  const forExistingArtist = Boolean(resolvedArtist?.name);

  let spotifyHints = [];
  try {
    const access = await getSpotifyAccess(keys);
    if (access) {
      const query = forExistingArtist
        ? spotifyQueryForArtist(resolvedArtist, market)
        : `genre:pop year:2024-${new Date().getFullYear()}`;
      const search = await spotifySearchContext(access.token, query);
      spotifyHints = (search?.tracks?.items || []).slice(0, 5).map((t) => `${t.name} — ${t.artists?.[0]?.name}`);
    }
  } catch {
    /* optional */
  }

  const baseJsonShape = `{
  "rising": [{"tag": string, "score": number, "note": string}],
  "audience": {"age": string, "platforms": string[], "listening": string},
  "opportunity": string,
  "mood": string,
  "genre": string,
  "hooks": string[]
}`;

  const risingRules = `Règles pour "rising":
- 3 à 5 tendances concrètes (genres / sons / formats / angles de single).
- "score" = force relative de l'opportunité sur une échelle ENTIÈRE de 0 à 100 (jamais une fraction 0–1).
- Les scores doivent refléter la conviction A&R : clairement soutenu ≥ 60, intéressant 40–59, faible < 40.
- Au moins une tendance doit avoir un score ≥ 65 si les charts le permettent.`;

  const prompt = forExistingArtist
    ? `Tu es un A&R musical expert marché ${market}.
L'artiste ci-dessous EXISTE déjà. Ne propose PAS un nouvel artiste fictionnel.
Analyse les charts Deezer et indices Spotify pour positionner CET artiste : quelles tendances du marché il peut rider, quels angles de prochain single, comment ses stats catalogue éclairent l'opportunité.

ARTISTE:
${promptJson(resolvedArtist)}

STATS CATALOGUE (streams ONCE / livraisons, si dispo):
${promptJson(resolvedStats || {})}

CHARTS DEEZER:
${promptJson(slimCharts(charts))}

SPOTIFY HINTS (proche du genre de l'artiste):
${promptJson(spotifyHints)}

Réponds en JSON strict:
${baseJsonShape}

"opportunity" = 1–3 phrases : positionnement de cet artiste face au marché actuel (pas une invention d'artiste).
"genre" et "mood" = affinage pour le prochain release de CET artiste (reste cohérent avec son identité).
"hooks" = angles / accroches de single adaptés à cet artiste + aux charts.
"rising" = tendances du marché que CET artiste peut exploiter (cite le lien avec son genre / ses stats dans "note").
${risingRules}`
    : `Tu es un A&R musical expert marché ${market}.
Analyse ces charts Deezer et indices Spotify pour proposer une opportunité d'artiste fictionnel réaliste.

CHARTS DEEZER:
${promptJson(slimCharts(charts))}

SPOTIFY HINTS:
${promptJson(spotifyHints)}

Réponds en JSON strict:
${baseJsonShape}

${risingRules}`;

  const analysis = await llmJson(keys, prompt);

  return {
    analyzedAt: new Date().toISOString(),
    source: {
      deezer: true,
      spotify: spotifyHints.length > 0,
      artist: forExistingArtist,
    },
    forArtist: forExistingArtist
      ? { name: resolvedArtist.name, slug: slug || null }
      : null,
    charts: {
      topTracks: charts.tracks.slice(0, 6),
      topArtists: charts.artists.slice(0, 5),
    },
    ...analysis,
    rising: normalizeRising(analysis?.rising),
  };
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

function resolveLanguage(code, artist) {
  const raw = (code || artist?.language || "fr").toString().toLowerCase().slice(0, 2);
  return LANG_PROMPT[raw] ? raw : "fr";
}

function languagePromptName(code) {
  return LANG_PROMPT[resolveLanguage(code)] || "français";
}

/** Verrou visuel sexe / présentation — évite portrait femme + bio « chanteur ». */
function genderVisualLock(gender, age) {
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

function normalizeAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 13 || rounded > 99) return null;
  return rounded;
}

function normalizeSelfPhotos(photos = []) {
  return normalizeArtistPhotos(photos);
}

/** Extrait vocal mode MOI — URL S3 / clé (pas de data URL géante en DB). */
function normalizeVoiceSample(sample) {
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

function serializeStyleLock(styleLock) {
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

async function resolveArtistStyleLock({
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

function withGenderInPrompt(prompt, genderEn) {
  const base = String(prompt || "").trim();
  if (!genderEn) return base;
  if (new RegExp(genderEn.split(",")[0], "i").test(base)) {
    return base;
  }
  return `${genderEn}. ${base}`.trim();
}

export async function runArtist({
  keys,
  name,
  bioHint,
  trends,
  genre,
  genres,
  language,
  styleArtist,
  styleArtistPick,
  styleArtistPicks,
  styleTrackPick,
  allowTakenName = false,
  mode = "fiction",
  age,
  gender: forcedGender,
  photos = [],
  city,
  legalName,
  voiceSample = null,
  onStatus,
}) {
  requireTextLlm(keys);
  const isSelf = String(mode || "").toLowerCase() === "self";
  const lang = resolveLanguage(language);
  const langName = languagePromptName(lang);
  const userStyles = Array.isArray(genres)
    ? genres.map((g) => String(g || "").trim()).filter(Boolean)
    : String(genre || "")
        .split(/\s*[×xX|/]\s*|\s*,\s*/)
        .map((x) => x.trim())
        .filter(Boolean);
  const forcedName = String(name || "")
    .trim()
    .slice(0, 80);
  const forceTaken = Boolean(allowTakenName);
  const selfAge = normalizeAge(age);
  const selfPhotos = normalizeSelfPhotos(photos);
  const selfVoiceSample = normalizeVoiceSample(voiceSample);

  if (isSelf) {
    if (!forcedName) {
      throw new Error("Indique ton nom de scène.");
    }
    if (!forcedGender) {
      throw new Error("Indique ton sexe / présentation (homme ou femme).");
    }
    if (selfAge == null) {
      throw new Error("Indique un âge valide (13–99).");
    }
    if (!selfPhotos.length) {
      throw new Error("Ajoute au moins une photo de toi.");
    }
  }

  if (forcedName && !forceTaken) {
    const availability = await checkArtistNameAvailability(keys, forcedName);
    if (!availability.available) {
      throw new Error(
        `Le nom « ${forcedName} » est déjà pris sur les plateformes de streaming : ${formatNameCollisions(availability.collisions)}. Choisis un autre nom de scène.`,
      );
    }
  }

  /** @type {Awaited<ReturnType<typeof resolveStyleReference>> | null} */
  let styleLock = await resolveArtistStyleLock({
    keys,
    styleArtist,
    styleArtistPick,
    styleArtistPicks,
    styleTrackPick,
  });

  if (isSelf && !styleLock) {
    throw new Error(
      "Choisis et valide au moins un artiste que tu aimes — le son des morceaux sera calé dessus.",
    );
  }

  const styleArtistHint = String(
    styleArtist ||
      styleArtistPick?.name ||
      (Array.isArray(styleArtistPicks) && styleArtistPicks[0]?.name) ||
      "",
  )
    .trim()
    .slice(0, 120);

  // Mix : DNA de référence (lock) ∪ styles ajoutés par l'utilisateur (jamais un remplacement)
  const lockGenres = Array.isArray(styleLock?.genres) ? styleLock.genres : [];
  const finalGenres = styleLock
    ? coalesceGenres([...lockGenres, ...userStyles])
    : coalesceGenres(userStyles);
  const extrasOnly = userStyles.filter(
    (g) => !lockGenres.some((lg) => String(lg).toLowerCase() === String(g).toLowerCase()),
  );
  const extraStyleNote =
    styleLock && extrasOnly.length
      ? `
STYLES AJOUTÉS PAR L'UTILISATEUR (supplément — à MÉLANGER à la DNA ci-dessus, JAMAIS un remplacement) :
${JSON.stringify(extrasOnly)}
Le mix final = DNA de référence ∪ ces ajouts.`
      : "";
  const finalGenre = styleLock
    ? extrasOnly.length
      ? `${styleLock.genreSummary || lockGenres.join(" × ") || finalGenres.join(" × ")} + ${extrasOnly.join(" + ")}`
      : styleLock.genreSummary || finalGenres.join(" × ")
    : finalGenres.join(" × ");
  const stylePrompt = finalGenres.length
    ? finalGenres.length === 1
      ? finalGenres[0]
      : `fusion cohérente de: ${finalGenres.join(" + ")}`
    : "";

  const selfGenderLock = isSelf ? genderVisualLock(forcedGender, selfAge) : null;
  const favoriteNames = Array.isArray(styleLock?.refs)
    ? styleLock.refs.map((r) => r.matchedName).filter(Boolean)
    : styleLock?.matchedName
      ? [styleLock.matchedName]
      : [];

  const data = await llmJson(
    keys,
    isSelf
      ? `Tu construis le profil artiste d'une PERSONNE RÉELLE qui se recrée comme artiste sur SONOZZ.
Ce n'est PAS un personnage fictionnel inventé : respecte l'identité fournie.

NOM DE SCÈNE OBLIGATOIRE (copie exacte) : "${forcedName}"
"name" et "aka" = exactement "${forcedName}".
${legalName?.trim() ? `Nom légal fourni: "${String(legalName).trim().slice(0, 120)}"` : `legalName = prénom + nom réalistes cohérents avec le sexe (pour la distribution).`}
Âge OBLIGATOIRE: ${selfAge} ans — mentionne-le dans bio / look si pertinent.
Sexe / présentation OBLIGATOIRE: "${selfGenderLock.code}" — voice, look, wardrobe et bio DOIVENT coller.
${city?.trim() ? `Ville / base: "${String(city).trim().slice(0, 80)}"` : "Ville: propose une ville crédible si absente."}

═══ ARTISTES AIMÉS (LOCK STYLE — les morceaux doivent SONNER comme ça) ═══
Favoris: ${favoriteNames.join(" · ") || styleLock?.matchedName}
${
  styleLock
    ? `Match: "${styleLock.matchedName}" (${styleLock.source})
PARAMÈTRES VERROUILLÉS :
- genreSummary: ${styleLock.genreSummary}
- genres: ${JSON.stringify(styleLock.genres)}
- mood: ${styleLock.mood}
- energy: ${styleLock.energy}
- tempoFeel: ${styleLock.tempoFeel || ""}
- bpm: ${styleLock.bpm || "n/a"}
- timbre: ${styleLock.timbre || ""}
- rhythmFeel: ${styleLock.rhythmFeel || ""}
- instruments: ${JSON.stringify(styleLock.instruments || [])}
- production: ${styleLock.production}
- vocalStyle: ${styleLock.vocalStyle}
- vocalRegister: ${styleLock.vocalRegister || ""}
- sonicKeywords: ${JSON.stringify(styleLock.sonicKeywords)}
- writingStyle: ${styleLock.writingStyle}
- influences: ${JSON.stringify(styleLock.influences)}
- INTERDIT: ${JSON.stringify(styleLock.doNot)}
${styleLock.audioListened ? "- DNA audio: extrait preview réellement écouté" : ""}`
    : ""
}${extraStyleNote}
═══════════════════════════════════════════════════════════════════════════

Langue des chansons: ${langName} (code ${lang}).
Indices perso / univers: ${bioHint || "aucun"}
Tendances (secondaires): ${promptJson({})}

Le profil doit parler d'ELLE/LUI à la 3e personne, comme un dossier presse réaliste.
Ne change PAS le sexe ni l'âge. Ne invente PAS un autre visage.

JSON strict:
{
  "name": "${forcedName}",
  "aka": "${forcedName}",
  "legalName": string,
  "gender": "${selfGenderLock.code}",
  "age": ${selfAge},
  "genre": string,
  "genres": [string],
  "language": "${lang}",
  "mood": string,
  "city": string,
  "bio": string,
  "voice": string,
  "palette": ["#hex","#hex","#hex","#hex"],
  "influences": [string, string, string],
  "targetPersona": string,
  "visualIdentity": {
    "look": string,
    "wardrobe": string,
    "photographyStyle": string,
    "logoConcept": string,
    "portraitPrompt": string
  }
}
"genre" DOIT être: "${finalGenre}". "genres" DOIT être: ${JSON.stringify(finalGenres)}.
"mood" proche de: "${styleLock?.mood || ""}". "voice" colle à: "${styleLock?.vocalStyle || selfGenderLock.voiceHint}".
portraitPrompt = anglais, décrit la personne réelle (~${selfAge} ans, ${selfGenderLock.en}), pour retouche éventuelle — square photo, no text.`
      : `Crée un profil d'artiste musical fictionnel mais ultra-réaliste,
avec une identité visuelle cohérente (look, style photo, wardrobe).

${
  forcedName
    ? `NOM DE SCÈNE OBLIGATOIRE (copie exacte) : "${forcedName}"
"name" et "aka" = exactement "${forcedName}".`
    : `Nom de scène : génère un nom crédible, ORIGINAL et rare sur les stores, adapté au marché et au style ci-dessous (PAS le nom de la référence). Évite les prénoms seuls et les mots trop courants : compose un nom inventé / un mononyme distinctif.`
}

${
  styleLock
    ? `═══ LOCK STYLE — ARTISTE RÉEL TROUVÉ (${styleLock.source}, confiance ${styleLock.confidence}) ═══
Requête: "${styleLock.query}"
Match catalogue: "${styleLock.matchedName}"
${styleLock.url ? `URL: ${styleLock.url}` : ""}
${
  styleLock.seedTrack?.title
    ? `MORCEAU SEED (priorité DNA): "${styleLock.seedTrack.title}"${styleLock.seedTrack.artistName ? ` — ${styleLock.seedTrack.artistName}` : ""}`
    : `Titres phares: ${(styleLock.topTracks || []).join(" · ") || "n/a"}`
}
Albums: ${(styleLock.albums || []).join(" · ") || "n/a"}
Related: ${(styleLock.related || []).slice(0, 5).join(", ") || "n/a"}

PARAMÈTRES VERROUILLÉS (copie / respecte STRICTEMENT) :
- genreSummary: ${styleLock.genreSummary}
- genres: ${JSON.stringify(styleLock.genres)}
- mood: ${styleLock.mood}
- energy: ${styleLock.energy}
- tempoFeel: ${styleLock.tempoFeel}
- bpm: ${styleLock.bpm || "n/a"}
- timbre: ${styleLock.timbre || ""}
- rhythmFeel: ${styleLock.rhythmFeel || ""}
- instruments: ${JSON.stringify(styleLock.instruments || [])}
- production: ${styleLock.production}
- vocalStyle: ${styleLock.vocalStyle}
- vocalRegister: ${styleLock.vocalRegister || ""}
- sonicKeywords: ${JSON.stringify(styleLock.sonicKeywords)}
- writingStyle: ${styleLock.writingStyle}
- visualVibe: ${styleLock.visualVibe}
- influences OBLIGATOIRES (dans cet ordre): ${JSON.stringify(styleLock.influences)}
- INTERDIT (doNot): ${JSON.stringify(styleLock.doNot)}
${styleLock.audioListened ? "- Un extrait preview a été ÉCOUTÉ — colle au timbre/groove/BPM ci-dessus." : ""}
${extraStyleNote}

Le nouvel artiste doit sonner comme s'il était dans la MÊME famille que "${styleLock.matchedName}" :
même groove, même énergie, même type de prod, même approche d'écriture.
Identité fictionnelle DISTINCTE (nom, visage, bio) — PAS un clone légal / PAS une parody.
Les tendances charts ci-dessous sont IGNORÉES si elles contredisent ce lock.
═══════════════════════════════════════════════════════════════════════════════`
    : `Style(s) musical(aux) imposé(s): ${stylePrompt || "choisis un style cohérent avec les tendances (explicite et précis)"}`
}

Langue des chansons imposée: ${langName} (code ${lang}) — le catalogue et les paroles seront dans cette langue.
Indices personnalité / univers (PAS le style musical): ${bioHint || "aucun"}
Tendances (contexte marché${styleLock ? " — SECONDARY, ne pas écraser le lock" : ""}): ${promptJson(styleLock ? {} : trends || {})}

IMPORTANT — SEXE / PRÉSENTATION (à ne PAS confondre avec le style musical « genre ») :
- Choisis UN seul gender: "male" | "female" | "nonbinary"${forcedGender ? ` — FORCÉ: "${genderVisualLock(forcedGender, selfAge).code}"` : ""}.
- Tout le profil DOIT coller : name / legalName / aka / bio / voice / look / wardrobe / portraitPrompt.
- Si gender=male → chanteur homme, voix masculine, portrait d'un homme adulte.
- Si gender=female → chanteuse femme, voix féminine, portrait d'une femme adulte.
- Interdit : bio au masculin + portrait féminin (et l'inverse).

JSON strict:
{
  "name": string,
  "aka": string,
  "legalName": string,
  "gender": "male" | "female" | "nonbinary",
  "genre": string,
  "genres": [string],
  "language": "${lang}",
  "mood": string,
  "city": string,
  "bio": string,
  "voice": string,
  "palette": ["#hex","#hex","#hex","#hex"],
  "influences": [string, string, string],
  "targetPersona": string,
  "visualIdentity": {
    "look": string,
    "wardrobe": string,
    "photographyStyle": string,
    "logoConcept": string,
    "portraitPrompt": string
  }
}
${
  styleLock
    ? `"genre" DOIT être: "${finalGenre}". "genres" DOIT être: ${JSON.stringify(finalGenres)}. "mood" DOIT être proche de: "${styleLock.mood}". "voice" DOIT coller à: "${styleLock.vocalStyle}".`
    : finalGenre
      ? `Le champ "genre" DOIT résumer le STYLE MUSICAL: "${finalGenre}". "genres" = ${JSON.stringify(finalGenres)}. Ce n'est PAS le sexe.`
      : ""
}
"language" doit être exactement "${lang}".
legalName = prénom + nom de famille réalistes cohérents avec gender (obligatoire pour la distribution).
portraitPrompt = anglais, DOIT commencer par le sexe explicite ("adult man..." ou "adult woman..." ou androgyne), puis âge, traits, coiffure, tenue, lumière, décor${styleLock?.visualVibe ? ` ; vibe visuelle: ${styleLock.visualVibe}` : ""} ; square photo ; no text in image.`,
  );

  const lock = genderVisualLock(
    isSelf ? forcedGender || data.gender : forcedGender || data.gender,
    isSelf ? selfAge : normalizeAge(data.age) || selfAge,
  );
  const resolvedAge = isSelf ? selfAge : normalizeAge(data.age) || selfAge;

  if (forcedName) {
    data.name = forcedName;
    data.aka = forcedName;
  } else if (data.name && !forceTaken) {
    const styleHint = String(finalGenre || styleLock?.matchedName || "")
      .trim()
      .slice(0, 80);
    const picked = await resolveFreeGeneratedStageName({
      initialName: data.name,
      checkAvailability: (query) => checkArtistNameAvailability(keys, query),
      onStatus,
      proposeNames: ({ blocked, lastName, lastCollisions }) => {
        const taken = formatNameCollisions(lastCollisions);
        const forbidden = blocked.map((n) => `"${n}"`).join(", ");
        return llmJson(
          keys,
          `Le nom de scène "${lastName}" est DÉJÀ PRIS sur Spotify / Apple Music / Deezer${taken ? ` (${taken})` : ""}.
Propose ${FREE_NAME_PER_ROUND} autres noms de scène FICTIONNELS, crédibles${
            styleHint ? `, adaptés au style « ${styleHint} »` : ""
          }, clairement DISTINCTS les uns des autres.
Noms déjà refusés (INTERDITS, y compris variantes orthographiques proches) : ${forbidden}.
Privilégie des noms inventés / composés rares (pas un prénom seul, pas un mot trop courant).
JSON strict: { "names": [string, string, string, string], "name": string, "aka": string }
"name" = le meilleur candidat. "names" = ${FREE_NAME_PER_ROUND} options distinctes. "aka" = le même que "name".`,
        );
      },
    });
    data.name = picked.name;
    data.aka = picked.name;
  }

  if (legalName?.trim()) {
    data.legalName = String(legalName).trim().slice(0, 120);
  }
  if (city?.trim()) {
    data.city = String(city).trim().slice(0, 80);
  }

  // Force paramètres depuis le style lock (la vérité catalogue+LLM)
  const lockedMood = styleLock?.mood || data.mood;
  const lockedVoice = styleLock?.vocalStyle || data.voice || lock.voiceHint;
  const lockedInfluences = styleLock?.influences?.length
    ? styleLock.influences
    : Array.isArray(data.influences)
      ? data.influences.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

  const resolvedGenres = finalGenres.length
    ? finalGenres
    : Array.isArray(data.genres) && data.genres.length
      ? data.genres.map((g) => String(g).trim()).filter(Boolean)
      : [data.genre || "Pop"].filter(Boolean);
  const resolvedGenre = finalGenre || resolvedGenres.join(" × ") || data.genre || "Pop";

  const rawPortrait =
    data.visualIdentity?.portraitPrompt ||
    `Cinematic portrait of music artist ${data.name}, ${resolvedGenre} vibe, ${lockedMood} mood, wardrobe ${data.visualIdentity?.wardrobe || "contemporary streetwear"}, ${data.visualIdentity?.photographyStyle || "film grain night portrait"}, square composition, photorealistic`;
  const portraitPrompt = withGenderInPrompt(rawPortrait, lock.en);

  /** @type {{ imageUrl: string, warning?: string, provider: string }} */
  let portrait;
  /** @type {string[]} */
  let persistedPhotos = [];

  if (isSelf && selfPhotos.length) {
    persistedPhotos = [];
    for (const photo of selfPhotos) {
      try {
        const persisted = await materializeImageForStorage(photo);
        if (persisted && isUsableRasterImage(persisted)) {
          persistedPhotos.push(persisted);
        }
      } catch {
        /* skip bad photo */
      }
    }
    if (!persistedPhotos.length) {
      throw new Error("Impossible de lire tes photos — réessaie avec des JPEG/PNG plus légers.");
    }
    portrait = {
      imageUrl: persistedPhotos[0],
      provider: "user-upload",
      warning: undefined,
    };
  } else {
    portrait = await generateVisual({
      keys,
      prompt: portraitPrompt,
      kind: "portrait",
    });
  }

  const styleArtistNames = favoriteNames.length
    ? favoriteNames
    : styleLock?.matchedName
      ? [styleLock.matchedName]
      : styleArtistHint
        ? [styleArtistHint]
        : [];

  let profile = {
    ...data,
    name: forcedName || data.name,
    aka: forcedName || data.aka,
    gender: lock.code,
    age: resolvedAge || undefined,
    mode: isSelf ? "self" : "fiction",
    genre: resolvedGenre,
    genres: resolvedGenres,
    mood: lockedMood,
    language: lang,
    styleArtist: styleArtistNames[0] || undefined,
    styleArtists: styleArtistNames.length ? styleArtistNames : undefined,
    styleLock: serializeStyleLock(styleLock),
    styleTrack: styleLock?.seedTrack
      ? `${styleLock.seedTrack.title}${styleLock.seedTrack.artistName ? ` — ${styleLock.seedTrack.artistName}` : ""}`
      : undefined,
    influences: lockedInfluences,
    voice: lockedVoice,
    slug: slugify((forcedName || data.aka || data.name) || "artiste"),
    imageUrl: portrait.imageUrl,
    photos: persistedPhotos.length ? persistedPhotos : undefined,
    voiceSample: isSelf && selfVoiceSample ? selfVoiceSample : undefined,
    imageFallback: false,
    imageWarning: portrait.warning,
    imageProvider: portrait.provider,
    localAsset: false,
    portraitPrompt,
    // Label imprint : réglage global, sinon (mode moi) le nom de scène
    recordLabel:
      keys?.distrokidLabel?.trim() ||
      (isSelf ? forcedName || data.name : undefined) ||
      undefined,
    visualIdentity: {
      ...(data.visualIdentity || {}),
      genderLock: lock.en,
      ...(styleLock?.visualVibe ? { vibeFromRef: styleLock.visualVibe } : {}),
      ...(isSelf ? { fromUserPhotos: true } : {}),
    },
  };

  // Timbre figé dès la création IA — sans obliger l’utilisateur à enregistrer sa voix.
  try {
    const { lockSynthesizedTimbre, ensureArtistTimbre } = await import("./artistTimbre.js");
    if (isSelf && selfVoiceSample && keys?.geminiApiKey) {
      const analyzed = await ensureArtistTimbre(keys, profile, { force: true });
      if (analyzed?.artist) profile = analyzed.artist;
    } else {
      profile = lockSynthesizedTimbre(profile);
    }
  } catch (e) {
    console.warn("[timbre] lock à la création:", e.message);
  }

  return profile;
}

function buildLyricsPrompt({ lang, langName, theme, artist, trends, lock, feat, form, duoBlock, repairNote = "" }) {
  return `Écris des paroles de chanson originales en ${langName} pour cet artiste.
Artiste LEAD: ${promptJson({
  name: artist?.name,
  mode: artist?.mode,
  age: artist?.age,
  gender: artist?.gender,
  genre: artist?.genre,
  genres: artist?.genres,
  mood: artist?.mood,
  voice: artist?.voice,
  bio: artist?.bio,
  influences: artist?.influences,
  styleArtist: artist?.styleArtist,
  styleArtists: artist?.styleArtists,
})}
${
  feat
    ? `Artiste FEAT (identité séparée — ne pas fusionner avec le lead): ${promptJson({
        name: feat.name,
        gender: feat.gender,
        genre: feat.genre,
        genres: feat.genres,
        mood: feat.mood,
        voice: feat.voice,
        vocalStyle: feat.styleLock?.vocalStyle,
        timbre: feat.styleLock?.timbre,
        writingStyle: feat.styleLock?.writingStyle,
      })}`
    : ""
}
Style musical VERROUILLÉ (lane production du LEAD): ${artist?.genre || "pop contemporain"}
${
  lock
    ? `Lock référence lead "${lock.matchedName}"${Array.isArray(artist?.styleArtists) && artist.styleArtists.length > 1 ? ` (blend: ${artist.styleArtists.join(" × ")})` : ""}:
- production: ${lock.production}
- writingStyle: ${lock.writingStyle}
- mood/energy: ${lock.mood} / ${lock.energy}
- groove/rythme: ${lock.rhythmFeel || lock.tempoFeel || ""}
- timbre: ${lock.timbre || ""}
- bpm cible: ${lock.bpm || "n/a"}
- instruments: ${(lock.instruments || []).join(", ")}
- sonicKeywords: ${(lock.sonicKeywords || []).join(", ")}
- doNot (styles/écritures interdits): ${(lock.doNot || []).join(", ")}
Écris dans EXACTEMENT cette lane pour le lead (hooks, rythme des phrases, vibe) — sans pasticher les paroles de "${lock.matchedName}".`
    : artist?.styleArtists?.length
      ? `Boussole style lead (sans pastiche) : ${artist.styleArtists.join(" · ")}`
      : artist?.styleArtist
        ? `Boussole style lead (sans pastiche) : ${artist.styleArtist}`
        : ""
}
${duoBlock}
${buildLyricsCraftBrief(form)}
Langue obligatoire des paroles: ${langName} (code ${lang}) — aucune autre langue dans le chant.
Thème/titre: ${theme || "inspire-toi des tendances"}
Tendances: ${promptJson(lock ? {} : trends || {})}
${repairNote ? `\nCORRECTION OBLIGATOIRE (précédente version invalide): ${repairNote}\n` : ""}
JSON strict RFC 8259:
{
  "title": string,
  "theme": string,
  "language": "${lang}",
  "structure": string[],
  "text": string
}
Le champ text doit contenir les tags MiniMax/ACE en anglais selon l'arc « ${form.id} »: ${form.tagsArc} avec de vraies paroles en ${langName} sous chaque tag.
"structure" doit lister dans l'ordre les tags réellement présents dans "text".
Dans "text", apostrophes brutes (don't) — jamais \\'. Sauts de ligne = \\n uniquement.
"language" doit être exactement "${lang}".`;
}

export async function runLyrics({ keys, theme, artist, trends, language }) {
  requireTextLlm(keys);
  const lang = resolveLanguage(language, artist);
  const langName = languagePromptName(lang);
  const lock = artist?.styleLock;
  const form = detectLyricsForm(lock, artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const duoBlock = feat ? duoLyricsInstruction(artist, feat, form) : "";

  const promptArgs = { lang, langName, theme, artist, trends, lock, feat, form, duoBlock };
  let data = await llmJson(keys, buildLyricsPrompt(promptArgs));
  let normalized = normalizeAndValidateLyrics(data, form);

  if (!normalized._validation?.ok) {
    const repairNote = (normalized._validation?.errors || []).join("; ") || "structure invalide";
    data = await llmJson(keys, buildLyricsPrompt({ ...promptArgs, repairNote }));
    normalized = normalizeAndValidateLyrics(data, form);
  }

  const { _validation, ...lyrics } = normalized;
  return { ...lyrics, language: lang, lyricsForm: form.id };
}

function buildTrackMusicPrompt({ lyrics, artist }) {
  const lang = resolveLanguage(lyrics?.language, artist);
  const langName = languagePromptName(lang);
  const genderLock = genderVisualLock(artist?.gender, artist?.age);
  const styleLock = withKnownArtistLane(artist?.styleLock);
  const vocal = resolveVocalGender(artist);
  const feat = normalizeFeatArtist(artist?.featArtist);
  const duoVocalBits = feat ? duoVocalPromptBits(artist, feat) : [];
  const duoStyleBits = feat ? duoStylePromptBits(artist, feat) : [];
  let arrange = normalizeMusicArrange(artist?.musicArrange);
  if (isDefaultMusicArrange(arrange) && styleLock) {
    arrange = musicArrangeFromStyleLock(styleLock);
  }
  const packed = musicArrangeToSongGen(arrange, {
    styleLockInstruments: styleLock?.instruments,
    styleLock,
  });
  const arrangeBits = packed.customFragments || [];
  const genreBlob = styleLockGenreBlob(styleLock, [artist?.genre, lyrics?.title, lyrics?.theme]);
  const metal = isMetalLane(genreBlob);
  // Arrangement (chœur…) EN TÊTE pour MiniMax aussi + qualité production
  const qualityBits = packed.gospel
    ? [
        "commercial contemporary gospel-soul production",
        "full band with choir, organ, piano, bass and drums",
        "radio-ready streaming quality",
      ]
    : metal
      ? [...metalFlavorTags(styleLock), ...artefactGuardsFromLock(styleLock)]
      : [
          "commercial radio-ready full-band production",
          "polished multi-instrument arrangement like a Billboard hit",
          "rich bass, harmony instruments, drums and pads — never thin or single-instrument",
        ];

  // Scrub fuites de sexe opposé depuis la référence lead.
  // En duo : NE PAS scrubber — le feat peut être du sexe opposé et doit rester audible.
  const scrubVoiceLeak = (text) => {
    const raw = String(text || "");
    if (feat) return raw;
    if (vocal.code === "male") {
      return raw
        .replace(/\b(female|woman|women|girl|soprano|mezzo|alto|feminine)\b/gi, "male")
        .replace(/\bfemale vocals?\b/gi, "male vocals");
    }
    return raw
      .replace(/\b(male|man|men|boy|baritone|tenor|masculine)\b/gi, "female")
      .replace(/\bmale vocals?\b/gi, "female vocals");
  };

  const safeMusicPrompt = scrubVoiceLeak(styleLock?.musicPrompt || "");
  // Duo : raccourcir le DNA lead (Eminem) pour ne pas noyer la 2e voix.
  const musicPromptForGen = feat
    ? String(safeMusicPrompt).slice(0, 180)
    : safeMusicPrompt;
  const voiceLine = feat
    ? duoVocalBits[0] || "distinct two-singer duet"
    : metal
      ? metalVoiceHint(vocal.code, genreBlob, styleLock)
      : vocal.voiceHint;
  const banBits = (Array.isArray(styleLock?.doNot) ? styleLock.doNot : [])
    .slice(0, 4)
    .map((d) => `avoid ${d}`);

  const prompt = (
    musicPromptForGen
      ? metal
        ? [
            ...(feat ? duoVocalBits : []),
            styleLock?.genreSummary || artist?.genre || "metal",
            voiceLine,
            ...duoVocalBits.slice(feat ? 99 : 1),
            ...duoStyleBits,
            ...qualityBits,
            musicPromptForGen,
            ...banBits,
            `${artist?.mood || styleLock.mood || "aggressive"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition inspired by that lane, not a cover",
          ]
        : [
            ...(feat ? duoVocalBits : [vocal.voiceHint]),
            ...duoStyleBits,
            ...arrangeBits,
            ...qualityBits,
            musicPromptForGen,
            `${artist?.mood || styleLock.mood || "emotional"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition",
          ]
      : metal
        ? [
            ...(feat ? duoVocalBits : [voiceLine]),
            ...duoVocalBits.slice(feat ? 99 : 1),
            ...duoStyleBits,
            ...qualityBits,
            artist?.genre || styleLock?.genreSummary || "metal",
            artist?.styleArtists?.length
              ? `in the sonic lane of ${artist.styleArtists.join(" and ")} (original, not a cover)`
              : artist?.styleArtist
                ? `in the sonic lane of ${artist.styleArtist} (original, not a cover)`
                : "",
            `${artist?.mood || styleLock?.mood || "aggressive"} mood`,
            `vocals and lyrics in ${langName}`,
            "original composition, not a cover",
          ]
        : [
          ...(feat ? duoVocalBits : [vocal.voiceHint]),
          ...duoStyleBits,
          ...arrangeBits,
          ...qualityBits,
          packed.gospel ? "contemporary gospel soul R&B" : `${artist?.genre || "pop"}`,
          artist?.styleArtists?.length
            ? `in the sonic lane of ${artist.styleArtists.join(" and ")} (original, not a cover)`
            : artist?.styleArtist
              ? `in the sonic lane of ${artist.styleArtist} (original, not a cover)`
              : "",
          `${artist?.mood || (packed.gospel ? "uplifting" : "emotional")} mood`,
          feat ? null : vocal.voiceForPrompt,
          `vocals and lyrics in ${langName}`,
          "emotional hook, wide stereo mix",
        ]
  )
    .filter(Boolean)
    .join(", ");

  return { prompt, styleLock, genderLock, vocal, arrangeBpm: packed.bpm, arrange, packed, feat };
}

function assembleTrackResult({
  lyrics,
  artist,
  styleLock,
  bpmGuess,
  audioUrl = null,
  audioS3Key = null,
  provider = "brief",
  durationLabel = "3:24",
  hasVocals = false,
  warning,
  vocal = null,
  arrange = null,
}) {
  const lock = withKnownArtistLane(styleLock);
  let arr = arrange || normalizeMusicArrange(artist?.musicArrange);
  if (isDefaultMusicArrange(arr) && lock) {
    arr = musicArrangeFromStyleLock(lock);
  }
  const voice = vocal || resolveVocalGender(artist);
  const genreBlob = styleLockGenreBlob(lock, [artist?.genre, lyrics?.title]);
  const metal = isMetalLane(genreBlob);

  const sunoPrompt = buildSunoPrompt({
    lyrics,
    artist,
    styleLock: lock,
    bpmGuess,
    musicArrange: arr,
    // Duo : laisser buildSunoPrompt injecter les bits deux voix (pas d’override mono-sexe).
    vocalHint: normalizeFeatArtist(artist?.featArtist)
      ? null
      : metal
        ? metalVoiceHint(voice?.code, genreBlob, lock)
        : voice?.voiceHint,
  });

  const noteReady =
    provider === "acestep-studio"
      ? "Chanson générée via ACE-Step Studio (local)."
      : provider === "songgeneration-studio"
        ? "Chanson générée via SongGeneration Studio (LeVo local)."
        : hasVocals
          ? "Chanson générée via MiniMax Music 2.6 (voix + paroles)."
          : "Piste instrumentale (MusicGen) — pas de chant.";

  return {
    title: lyrics?.title || "Untitled Session",
    artist: displayArtistCredit(artist, artist?.featArtist),
    bpm: bpmGuess,
    key: ["Am", "Dm", "Em", "F", "Gm", "C"][Math.floor(Math.random() * 6)],
    duration: audioUrl ? durationLabel : "3:24",
    style: artist?.genre || "Pop",
    mood: artist?.mood || "emotional",
    status: audioUrl ? "audio-ready" : "prompt-ready",
    waveform: waveform(),
    audioUrl,
    audioS3Key: audioS3Key || undefined,
    provider,
    hasVocals,
    sunoPrompt,
    note: audioUrl
      ? noteReady
      : "Métadonnées + prompt Suno prêts — audio manquant jusqu’à import ou provider audio.",
    warning,
  };
}

/**
 * Démarre la gen audio sans bloquer (évite Cloudflare 524 / proxy ~100s).
 * Le client poll via pollTrack.
 */
export async function startTrack({ keys, lyrics, artist, preview = false, skipStyleReference = false, forceAceModelId = null }) {
  const resolvedGender = resolveArtistGender(artist);
  if (!resolvedGender) {
    throw new Error(
      "Sexe / présentation manquant sur l’artiste — ouvre Modifier le profil, choisis Homme/Femme, puis régénère avant le morceau.",
    );
  }
  artist = withResolvedArtistGender(artist);

  // Fige / backfill le timbre (extrait vocal ou dernier audio) avant le prompt.
  try {
    const { ensureTrackArtistsTimbre } = await import("./artistTimbre.js");
    const ensured = await ensureTrackArtistsTimbre(keys, artist);
    if (ensured?.artist) artist = ensured.artist;
    if (ensured?.report?.lead && !ensured.report.lead.skipped) {
      console.info("[timbre] lead", ensured.report.lead);
    }
    if (ensured?.report?.feat && !ensured.report.feat.skipped) {
      console.info("[timbre] feat", ensured.report.feat);
    }
  } catch (e) {
    console.warn("[timbre] pre-track:", e.message);
  }

  const lang = resolveAceVocalLanguage(
    lyrics?.language || artist?.language || "fr",
    lyrics?.text || "",
  );
  const songGenModel = keys?.songGenPreferredModel;
  const wantAceStep = isAceStepMusicProvider(keys);
  const wantSongGen = isSongGenMusicProvider(keys);
  const songGenNative = wantSongGen && isLanguageOkForProvider(lang, "songgen", songGenModel);
  const hasMinimax =
    isStudioEnabled(keys, "replicate") && Boolean(keys?.replicateApiToken?.trim());
  if (wantSongGen && !songGenNative && !hasMinimax) {
    throw new Error(
      `${songGenLanguageHint(songGenModel || "songgeneration_large")} Ajoute un token Replicate pour chanter cette langue, ou passe les paroles en anglais.`,
    );
  }
  const isPreview = Boolean(preview);
  const { prompt, styleLock, vocal, arrangeBpm, arrange, packed } = buildTrackMusicPrompt({
    lyrics,
    artist,
  });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : defaultBpmForGenre(styleLockGenreBlob(styleLock, [artist?.genre]));
  const draft = assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl: null,
    provider: "brief",
    vocal,
    packed,
    arrange,
  });

  if (wantAceStep) {
    const feat = normalizeFeatArtist(artist?.featArtist);
    const featVocal = feat ? vocalLockForArtist(feat) : null;
    // Preview Spotify/Deezer en taskType « cover » → bouillie (lab OK sans cover).
    // DNA = prompt texte (styleLock.musicPrompt), pas l’extrait catalogue.
    let bpmForAce = bpmGuess;
    if (feat && Number(bpmForAce) > 118) bpmForAce = 118;

    const started = await startAceStep(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      language: lang,
      bpm: bpmForAce,
      preview: isPreview,
      referenceAudioUrl: "",
      referenceAudioTitle: "",
      styleLock,
      artist,
      forceModelId: String(forceAceModelId || "").trim() || null,
    });
    return {
      pollNeeded: true,
      musicKind: "acestep",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      model: started.model || null,
      quality: started.quality || null,
      pickReason: started.pickReason || null,
      gpu: started.gpu || null,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmForAce,
        voiceGender: feat
          ? `${vocal?.code || "lead"}+${featVocal?.genderCode || "feat"}`
          : vocal?.code,
        aceStepModel: started.model || null,
        aceStepQuality: started.quality || null,
        aceGen: started.aceGen || null,
        pickReason: started.pickReason || null,
        usedReference: Boolean(started.usedReference),
        language: lang,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: isPreview
          ? `Extrait ACE-Step · ${started.quality || "auto"}${feat ? " · duo" : ""} — brouillon indicatif`
          : feat
            ? `ACE-Step · ${started.quality || started.model || "auto"} · duo ${displayArtistCredit(artist, feat)}`
            : started.model
              ? `ACE-Step · ${started.quality || started.model}`
              : draft.note,
      },
    };
  }

  if (wantSongGen && songGenNative) {
    const started = await startSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: vocal?.code || artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
      preview: isPreview,
    });
    return {
      pollNeeded: true,
      musicKind: "songgen",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmGuess,
        voiceGender: started.gender || vocal?.code,
        songGenModel: started.model || null,
        songGenQuality: started.quality || null,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: isPreview
          ? `Extrait SongGen · ${started.model || "auto"} — brouillon indicatif`
          : started.model
            ? `SongGen · ${started.model}${started.quality ? ` · ${started.quality}` : ""}`
            : draft.note,
      },
    };
  }

  if (hasMinimax) {
    const started = await startMinimaxMusic(keys.replicateApiToken.trim(), {
      prompt,
      lyrics: lyrics?.text || "",
      preview: isPreview,
    });
    return {
      pollNeeded: true,
      musicKind: "replicate",
      generationId: started.generationId,
      provider: started.provider,
      preview: isPreview,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmGuess,
        isPreview,
        status: isPreview ? "preview-ready" : "prompt-ready",
        note: wantSongGen && !songGenNative
          ? isPreview
            ? `Extrait MiniMax · ${lang} — SongGen Large ne chante pas cette langue`
            : `MiniMax · ${lang} (SongGen Large : anglais / chinois seulement)`
          : isPreview
            ? "Extrait MiniMax (paroles tronquées) — brouillon indicatif"
            : draft.note,
      },
    };
  }

  return {
    pollNeeded: false,
    ...assembleTrackResult({
      lyrics,
      artist,
      styleLock,
      bpmGuess,
      vocal,
      packed,
      arrange,
      warning:
        "Aucun provider audio — choisis ACE-Step / SongGeneration (local) ou un token Replicate dans Paramètres, ou importe un mp3.",
    }),
  };
}

/** Tick de poll court — à appeler depuis le client toutes les ~3 s. */
export async function pollTrack({ keys, generationId, musicKind, draft }) {
  const kind = String(musicKind || "").trim();
  let tick;
  if (kind === "acestep") {
    tick = await pollAceStep(keys, generationId);
  } else if (kind === "songgen") {
    tick = await pollSongGeneration(keys, generationId);
  } else if (kind === "replicate") {
    const token = keys?.replicateApiToken?.trim();
    if (!token) throw new Error("Token Replicate manquant pour le poll audio");
    tick = await pollMinimaxMusic(token, generationId);
  } else {
    throw new Error(`musicKind inconnu: ${kind || "(vide)"}`);
  }

  if (!tick.done) {
    const model =
      tick.model ||
      (kind === "acestep" ? draft?.aceStepModel : null) ||
      (kind === "songgen" ? draft?.songGenModel : null) ||
      null;
    return {
      done: false,
      status: tick.status,
      progress: tick.progress,
      message: tick.message || "",
      stage: tick.stage || null,
      gpu: tick.gpu || null,
      model,
      quality: draft?.aceStepQuality || draft?.songGenQuality || null,
      elapsedSeconds: tick.elapsedSeconds || 0,
      estimatedSeconds: tick.estimatedSeconds || 0,
      generationId,
      musicKind: kind,
    };
  }

  const base = draft && typeof draft === "object" ? draft : {};
  const isPreview = Boolean(base.isPreview);
  const persisted = await persistGeneratedAudio(
    tick.url,
    base.artist || "anon",
  );
  const track = {
    ...base,
    audioUrl: persisted.audioUrl,
    audioS3Key: persisted.audioS3Key || undefined,
    provider: tick.provider || base.provider,
    hasVocals: Boolean(tick.hasVocals),
    duration: isPreview
      ? tick.durationLabel || "~extrait"
      : tick.durationLabel || base.duration || "~2–4 min",
    status: isPreview ? "preview-ready" : "audio-ready",
    isPreview,
    note: isPreview
      ? "Extrait prêt — brouillon indicatif (le complet sera une nouvelle génération, mêmes réglages)."
      : tick.provider === "acestep-studio"
        ? "Chanson générée via ACE-Step Studio (local)."
        : tick.provider === "songgeneration-studio"
          ? "Chanson générée via SongGeneration Studio (LeVo local)."
          : "Chanson générée via MiniMax Music 2.6 (voix + paroles).",
    warning: undefined,
  };
  return { done: true, track, generationId, musicKind: kind };
}

/** Annule une génération audio en cours (Replicate) — SongGen : poll arrêté côté client. */
export async function cancelTrack({ keys, generationId, musicKind }) {
  const kind = String(musicKind || "").trim();
  const id = String(generationId || "").trim();
  if (!id) return { ok: false, skipped: true };
  if (kind === "replicate") {
    const token = keys?.replicateApiToken?.trim();
    if (!token) return { ok: false, skipped: true };
    return cancelMinimaxMusic(token, id);
  }
  if (kind === "acestep") {
    return cancelAceStep(keys, id);
  }
  return {
    ok: true,
    skipped: true,
    message: "Poll arrêté — SongGen peut finir en local",
  };
}

/** Sync (pipeline A→Z). Pour l’UI étape Track, préférer startTrack + pollTrack. */
export async function runTrack({ keys, lyrics, artist }) {
  const { prompt, styleLock, vocal, arrangeBpm, arrange, packed } = buildTrackMusicPrompt({
    lyrics,
    artist,
  });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : defaultBpmForGenre(styleLockGenreBlob(styleLock, [artist?.genre]));

  let audioUrl = null;
  let provider = "brief";
  let warning;
  let durationLabel = "3:24";
  let hasVocals = false;

  if (isAceStepMusicProvider(keys)) {
    // Pas de cover auto catalogue (cf. startTrack) — texte DNA seulement.
    const result = await generateMusicWithAceStep(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      language: resolveAceVocalLanguage(
        lyrics?.language || artist?.language || "fr",
        lyrics?.text || "",
      ),
      bpm: bpmGuess,
      referenceAudioUrl: "",
      referenceAudioTitle: "",
      styleLock,
      artist,
    });
    audioUrl = result.url;
    provider = result.provider;
    durationLabel = result.durationLabel || "~2–4 min";
    hasVocals = Boolean(result.hasVocals);
  } else if (isSongGenMusicProvider(keys)) {
    const result = await generateMusicWithSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: vocal?.code || artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
    });
    audioUrl = result.url;
    provider = result.provider;
    durationLabel = result.durationLabel || "~2–4 min";
    hasVocals = Boolean(result.hasVocals);
  } else if (isStudioEnabled(keys, "replicate") && keys?.replicateApiToken?.trim()) {
    const result = await generateMusicWithReplicate(keys.replicateApiToken.trim(), {
      prompt,
      lyrics: lyrics?.text || "",
    });
    audioUrl = typeof result === "string" ? result : result.url;
    provider = typeof result === "string" ? "replicate" : result.provider;
    durationLabel = typeof result === "string" ? "~2–4 min" : result.durationLabel || "~2–4 min";
    hasVocals = typeof result === "string" ? true : Boolean(result.hasVocals);
    warning = typeof result === "string" ? undefined : result.warning;
  } else {
    warning =
      "Aucun provider audio — choisis ACE-Step / SongGeneration (local) ou un token Replicate dans Paramètres, ou importe un mp3.";
  }

  const persisted = await persistGeneratedAudio(
    audioUrl,
    artist?.slug || artist?.name || "anon",
  );

  return assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl: persisted.audioUrl,
    audioS3Key: persisted.audioS3Key,
    provider,
    durationLabel,
    hasVocals,
    warning,
    vocal,
    packed,
    arrange,
  });
}

/** Portrait raster du feat (snapshot ou profil catalogue). */
async function resolveFeatCoverPortrait(feat) {
  if (!feat) return null;
  if (isUsableRasterImage(feat.imageUrl)) return feat.imageUrl;
  const slug = String(feat.slug || "").trim();
  if (!slug) return null;
  try {
    const row = await getArtistBySlug(slug);
    const profile = row?.profile || {};
    const photos = normalizeArtistPhotos(profile.photos, profile.imageUrl);
    return photos.find((u) => isUsableRasterImage(u)) || null;
  } catch {
    return null;
  }
}

export async function runCover({ keys, prompt, artist, track, album }) {
  const portraitUrl = artist?.imageUrl;
  if (!isUsableRasterImage(portraitUrl)) {
    throw new Error(
      "Portrait artiste manquant ou SVG. Ouvre Modifier le profil (photo Gemini ou Replicate) avant la jaquette.",
    );
  }

  const feat = normalizeFeatArtist(artist?.featArtist);
  const featPortraitUrl = feat ? await resolveFeatCoverPortrait(feat) : null;
  const isDuo = Boolean(feat?.name);
  const credit = displayArtistCredit(artist, feat);

  const genderLock =
    artist?.visualIdentity?.genderLock || genderVisualLock(artist?.gender, artist?.age).en;
  const featGenderLock = feat
    ? feat.visualIdentity?.genderLock || genderVisualLock(feat.gender, feat.age).en
    : null;
  const releaseTitle = album?.title || track?.title || "Single";
  const duoBits = isDuo ? duoCoverPromptBits(artist, feat) : [];
  const styleHint = String(prompt || "").trim();

  const visual = [
    album?.title
      ? `Square LP album cover for "${album.title}" by ${credit}`
      : `Album cover for "${releaseTitle}" by ${credit}`,
    album?.concept ? `album concept: ${album.concept}` : "",
    styleHint,
    genderLock,
    featGenderLock && isDuo ? `featured artist look: ${featGenderLock}` : "",
    ...duoBits,
    `mood ${artist?.visualIdentity?.look || artist?.mood || "nocturne"}`,
    `wardrobe ${artist?.visualIdentity?.wardrobe || "contemporary"}`,
    `${artist?.genre || "pop"} aesthetic`,
    `palette ${artist?.palette?.join(", ") || "brass and moss"}`,
    isDuo
      ? featPortraitUrl
        ? "cinematic square composition, BOTH reference portraits must stay recognizable (face, age, hair, skin, gender) — image 1 = lead, image 2 = featured"
        : `cinematic square composition, lead matches reference portrait; featured ${feat.name} must appear as a second distinct person (${featGenderLock || "matching their gender"}), do not clone the lead`
      : "cinematic square composition, SAME PERSON and SAME GENDER as the reference portrait photo, do not change sex or age",
  ]
    .filter(Boolean)
    .join(", ");

  const referenceImageUrls = [portraitUrl, featPortraitUrl].filter((u) =>
    isUsableRasterImage(u),
  );

  const image = await generateVisual({
    keys,
    prompt: visual,
    kind: "cover",
    referenceImageUrl: portraitUrl,
    referenceImageUrls,
  });

  const warnings = [
    image.warning,
    isDuo && !featPortraitUrl
      ? `Feat ${feat.name} sans portrait catalogue — jaquette duo guidée surtout par le lead.`
      : null,
  ].filter(Boolean);

  return {
    prompt: visual,
    imageUrl: image.imageUrl,
    format: "3000×3000 (master)",
    style: isDuo
      ? `cinematic / duo ${credit}`
      : "cinematic / based on artist portrait",
    fallback: false,
    warning: warnings.length ? warnings.join(" ") : undefined,
    provider: image.provider,
    basedOnArtist: true,
    featuring: isDuo ? feat.name : undefined,
    localAsset: false,
    sourcePortrait: Boolean(portraitUrl),
    sourceFeatPortrait: Boolean(featPortraitUrl),
  };
}

export async function runSpotify({ keys, artist, track, cover }) {
  return prepareSpotifyRelease(keys, { artist, track, cover });
}

export async function runDistroKid({
  keys,
  artist,
  track,
  cover,
  lyrics,
  submit = true,
  reuseRelease = false,
  releaseId = null,
}) {
  const onceToken = keys?.onceApiToken?.trim();
  if (!onceToken) {
    throw new Error("Token ONCE requis dans Paramètres pour publier vers Spotify.");
  }
  if (!submit) {
    throw new Error("Soumission ONCE désactivée.");
  }

  let spotifyAssist = null;
  try {
    if (keys?.spotifyClientId?.trim() && keys?.spotifyClientSecret?.trim()) {
      spotifyAssist = await prepareSpotifyRelease(keys, { artist, track, cover });
    }
  } catch {
    /* optional */
  }

  const once = await submitOnceRelease(onceToken, {
    artist,
    track,
    cover,
    lyrics,
    keys,
    reuseRelease: Boolean(reuseRelease),
    releaseId: releaseId || null,
  });
  return {
    provider: "once",
    ...once,
    uploadUrl: once.dashboardUrl,
    spotifyAssist,
  };
}

export async function runSocial({ keys, artist, track, lyrics, cover }) {
  requireTextLlm(keys);
  const data = await llmJson(
    keys,
    `Crée un pack de publication short vertical 9:16 pour CE MORCEAU (pas un clip générique).
Artiste: ${promptJson(artist)}
Morceau: ${promptJson({
      title: track?.title,
      style: track?.style,
      bpm: track?.bpm,
      key: track?.key,
      mood: track?.mood || artist?.mood,
    })}
Jaquette / univers: ${promptJson({ prompt: cover?.prompt, style: cover?.style })}
Paroles (source narrative du clip): ${(lyrics?.text || "").slice(0, 900)}

JSON strict:
{
  "format": "9:16",
  "duration": "8s",
  "platforms": ["TikTok","Instagram Reels","YouTube Shorts"],
  "caption": string,
  "scenes": [string, string, string],
  "hashtags": string[],
  "hook": string,
  "veoPromptHint": string,
  "status": "ready-for-veo"
}
Règles:
- scenes = 3 battements VISUELS en anglais qui illustrent les paroles / le thème du titre (métaphores → images), pas juste le look artiste. Préférer plans larges/moyens, silhouette, mains, décor — éviter gros plans bouche / lip-sync.
- veoPromptHint = 1–2 phrases EN ANGLAIS : direction cinéma du clip fidèle au morceau + portrait + jaquette (énergie BPM, émotion, lieux évoqués par les paroles), cadre 9:16 plein écran sans letterbox, sans lip-sync.
- caption/hook en français, accrocheurs, liés au titre.
- Aucun nom de célébrité réelle.`,
  );

  return {
    ...data,
    tiktokReady: Boolean(keys?.tiktokAccessToken?.trim()),
    webhookReady: Boolean(keys?.socialWebhookUrl?.trim()),
    publishNote: keys?.tiktokAccessToken?.trim() || keys?.socialWebhookUrl?.trim()
      ? "Prêt pour Clip Veo 3 puis diffusion (TikTok / webhook)."
      : "Génère le clip Veo 3, puis configure TikTok/webhook pour diffuser.",
  };
}

/** Étapes du pipeline A→Z (artiste déjà créé ; s'arrête à ONCE). */
export const PIPELINE_STEPS = [
  { key: "trends", label: "Tendances", message: "Analyse Deezer + Gemini…" },
  { key: "lyrics", label: "Paroles", message: "Écriture des paroles…" },
  { key: "track", label: "Morceau", message: "Création morceau / brief audio…" },
  { key: "cover", label: "Jaquette", message: "Génération jaquette…" },
  { key: "distrokid", label: "ONCE", message: "En attente de ta validation…" },
  { key: "done", label: "Terminé", message: "Prêt à publier sur ONCE" },
];

export async function runFullPipeline({
  keys,
  theme,
  market,
  language,
  artistSlug,
  onProgress,
}) {
  const log = [];
  const total = PIPELINE_STEPS.length;
  let trends = null;
  let artist = null;
  let lyrics = null;
  let track = null;
  let cover = null;

  const slug = String(artistSlug || "").trim();
  if (!slug) {
    throw new Error("Choisis un artiste existant. Crée le profil sur /artiste/nouveau.");
  }

  const emitSnapshot = (step) => {
    onProgress?.({
      type: "snapshot",
      step,
      at: new Date().toISOString(),
      snapshot: { trends, artist, lyrics, track, cover, distrokid: null, social: null },
    });
  };

  const push = (step, message) => {
    const entry = { step, message, at: new Date().toISOString() };
    log.push(entry);
    const index = Math.max(
      0,
      PIPELINE_STEPS.findIndex((s) => s.key === step),
    );
    onProgress?.({ ...entry, index, total });
  };

  const profile = await resolveArtistProfileForRelease(slug);
  if (!profile?.name) {
    throw new Error("Artiste introuvable — crée-le d’abord depuis Artistes.");
  }
  artist = withResolvedArtistGender({ ...profile, slug });

  push("trends", "Analyse Deezer + Gemini…");
  trends = await runTrends({ keys, market, artist, artistSlug: slug });
  emitSnapshot("trends");

  push("lyrics", "Écriture des paroles…");
  lyrics = await runLyrics({ keys, theme, artist, trends, language: language || artist.language });
  emitSnapshot("lyrics");

  push("track", "Création morceau / brief audio…");
  track = await runTrack({ keys, lyrics, artist });
  emitSnapshot("track");

  push("cover", "Génération jaquette…");
  cover = await runCover({ keys, artist, track });
  emitSnapshot("cover");

  push("distrokid", "En attente de ta validation ONCE…");
  push("done", "Prêt à publier sur ONCE — vérifie puis clique Publier");

  return {
    trends,
    artist,
    lyrics,
    track,
    cover,
    distrokid: null,
    social: null,
    awaitingOnce: true,
    log,
  };
}
