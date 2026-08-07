import { generateVisual } from "./images.js";
import { fetchDeezerCharts } from "./deezer.js";
import { prepareSpotifyRelease, getSpotifyAccess, spotifySearchContext } from "./spotify.js";
import {
  checkArtistNameAvailability,
  resolveStyleReference,
  resolveStyleReferences,
} from "./styleReference.js";
import { submitOnceRelease } from "./once.js";
import {
  generateMusicWithReplicate,
  startMinimaxMusic,
  pollMinimaxMusic,
} from "./replicate.js";
import {
  generateMusicWithSongGeneration,
  startSongGeneration,
  pollSongGeneration,
  isSongGenMusicProvider,
  resolveVocalGender,
} from "./songGeneration.js";
import { isUsableRasterImage, materializeImageForStorage } from "./imagePersist.js";
import { slugify, getArtistBySlug } from "./artists.js";
import { llmJson, requireTextLlm } from "./llm.js";
import { musicArrangeToSongGen, normalizeMusicArrange } from "../lib/musicArrange.js";

function waveform() {
  return Array.from({ length: 40 }, () => 18 + Math.floor(Math.random() * 82));
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
  const list = Array.isArray(photos) ? photos : [];
  return list
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(p))
    .slice(0, 6);
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
}) {
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

function formatNameCollisions(collisions = []) {
  return collisions
    .slice(0, 3)
    .map((c) => {
      const fans =
        c.followers != null && Number.isFinite(Number(c.followers))
          ? ` · ${Number(c.followers).toLocaleString("fr-FR")} fans`
          : "";
      return `${c.name} (${c.source || "?"}${fans})`;
    })
    .join(", ");
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
  allowTakenName = false,
  mode = "fiction",
  age,
  gender: forcedGender,
  photos = [],
  city,
  legalName,
  voiceSample = null,
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
      throw new Error("Indique ton sexe / présentation (homme, femme ou non-binaire).");
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

  // Styles finaux : référence artiste = vérité ; styles user en complément optionnel
  const finalGenres = styleLock
    ? userStyles.length
      ? [...new Set([...styleLock.genres, ...userStyles])].slice(0, 5)
      : styleLock.genres
    : userStyles;
  const finalGenre = styleLock
    ? styleLock.genreSummary || finalGenres.join(" × ")
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
}
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
    : `Nom de scène : génère un nom crédible adapté au marché et au style ci-dessous (PAS le nom de la référence).`
}

${
  styleLock
    ? `═══ LOCK STYLE — ARTISTE RÉEL TROUVÉ (${styleLock.source}, confiance ${styleLock.confidence}) ═══
Requête: "${styleLock.query}"
Match catalogue: "${styleLock.matchedName}"
${styleLock.url ? `URL: ${styleLock.url}` : ""}
Titres phares: ${(styleLock.topTracks || []).join(" · ") || "n/a"}
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
    // Nom inventé par le LLM : refuser s'il est déjà pris sur les stores
    let availability = await checkArtistNameAvailability(keys, data.name);
    if (!availability.available) {
      const blocked = formatNameCollisions(availability.collisions);
      const alt = await llmJson(
        keys,
        `Le nom de scène "${data.name}" est DÉJÀ PRIS sur Spotify / Apple Music / Deezer (${blocked}).
Propose un autre nom de scène FICTIONNEL, crédible, dans le même style musical, clairement DISTINCT.
JSON strict: { "name": string, "aka": string }
"name" et "aka" = le même nouveau nom. Interdit: "${data.name}" et toute variante orthographique proche.`,
      );
      const nextName = String(alt?.name || alt?.aka || "")
        .trim()
        .slice(0, 80);
      if (!nextName || nextName.toLowerCase() === String(data.name).toLowerCase()) {
        throw new Error(
          `Le nom généré « ${data.name} » est déjà pris (${blocked}). Relance avec un nom de scène libre.`,
        );
      }
      data.name = nextName;
      data.aka = String(alt?.aka || nextName).trim().slice(0, 80) || nextName;
      availability = await checkArtistNameAvailability(keys, data.name);
      if (!availability.available) {
        throw new Error(
          `Impossible de trouver un nom libre (dernier essai « ${data.name} » déjà pris : ${formatNameCollisions(availability.collisions)}). Saisis un nom de scène manuellement.`,
        );
      }
    }
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

  return {
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
    influences: lockedInfluences,
    voice: lockedVoice,
    slug: slugify((forcedName || data.aka || data.name) || "artiste"),
    imageUrl: portrait.imageUrl,
    photos: persistedPhotos.length > 1 ? persistedPhotos : undefined,
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
}

export async function runLyrics({ keys, theme, artist, trends, language }) {
  requireTextLlm(keys);
  const lang = resolveLanguage(language, artist);
  const langName = languagePromptName(lang);
  const lock = artist?.styleLock;
  const data = await llmJson(
    keys,
    `Écris des paroles de chanson originales en ${langName} pour cet artiste.
Artiste: ${promptJson({
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
Style musical VERROUILLÉ: ${artist?.genre || "pop contemporain"}
${
  lock
    ? `Lock référence "${lock.matchedName}"${Array.isArray(artist?.styleArtists) && artist.styleArtists.length > 1 ? ` (blend: ${artist.styleArtists.join(" × ")})` : ""}:
- production: ${lock.production}
- writingStyle: ${lock.writingStyle}
- mood/energy: ${lock.mood} / ${lock.energy}
- groove/rythme: ${lock.rhythmFeel || lock.tempoFeel || ""}
- timbre: ${lock.timbre || ""}
- bpm cible: ${lock.bpm || "n/a"}
- instruments: ${(lock.instruments || []).join(", ")}
- sonicKeywords: ${(lock.sonicKeywords || []).join(", ")}
- doNot (styles/écritures interdits): ${(lock.doNot || []).join(", ")}
Écris dans EXACTEMENT cette lane (hooks, rythme des phrases, vibe) — sans pasticher les paroles de "${lock.matchedName}".`
    : artist?.styleArtists?.length
      ? `Boussole style (sans pastiche) : ${artist.styleArtists.join(" · ")}`
      : artist?.styleArtist
        ? `Boussole style (sans pastiche) : ${artist.styleArtist}`
        : ""
}
Langue obligatoire des paroles: ${langName} (code ${lang}) — aucune autre langue dans le chant.
Thème/titre: ${theme || "inspire-toi des tendances"}
Tendances: ${promptJson(lock ? {} : trends || {})}

JSON strict:
{
  "title": string,
  "theme": string,
  "language": "${lang}",
  "structure": string[],
  "text": string
}
Le champ text doit contenir les tags MiniMax en anglais: [Verse], [Chorus], [Verse], [Bridge], [Chorus], [Outro] avec de vraies paroles en ${langName} sous chaque tag.
"language" doit être exactement "${lang}".`,
  );
  return { ...data, language: lang };
}

function buildTrackMusicPrompt({ lyrics, artist }) {
  const lang = resolveLanguage(lyrics?.language, artist);
  const langName = languagePromptName(lang);
  const genderLock = genderVisualLock(artist?.gender, artist?.age);
  const styleLock = artist?.styleLock;
  const vocal = resolveVocalGender(artist);
  const packed = musicArrangeToSongGen(normalizeMusicArrange(artist?.musicArrange), {
    styleLockInstruments: styleLock?.instruments,
  });
  const arrangeBits = packed.customFragments || [];
  // Arrangement (chœur…) EN TÊTE pour MiniMax aussi + qualité production
  const qualityBits = packed.gospel
    ? [
        "commercial contemporary gospel-soul production",
        "full band with choir, organ, piano, bass and drums",
        "radio-ready streaming quality",
      ]
    : [
        "commercial radio-ready full-band production",
        "polished multi-instrument arrangement like a Billboard hit",
        "rich bass, harmony instruments, drums and pads — never thin or single-instrument",
      ];
  const prompt = (
    styleLock?.musicPrompt
      ? [
          ...arrangeBits,
          ...qualityBits,
          vocal.voiceHint,
          styleLock.musicPrompt,
          `${artist?.mood || styleLock.mood || "emotional"} mood`,
          `vocals and lyrics in ${langName}`,
          "original composition",
        ]
      : [
          ...arrangeBits,
          ...qualityBits,
          vocal.voiceHint,
          packed.gospel ? "contemporary gospel soul R&B" : `${artist?.genre || "pop"}`,
          artist?.styleArtists?.length
            ? `in the sonic lane of ${artist.styleArtists.join(" and ")} (original, not a cover)`
            : artist?.styleArtist
              ? `in the sonic lane of ${artist.styleArtist} (original, not a cover)`
              : "",
          `${artist?.mood || (packed.gospel ? "uplifting" : "emotional")} mood`,
          vocal.voiceForPrompt,
          `vocals and lyrics in ${langName}`,
          "emotional hook, wide stereo mix",
        ]
  )
    .filter(Boolean)
    .join(", ");

  return { prompt, styleLock, genderLock, vocal, arrangeBpm: packed.bpm };
}

function assembleTrackResult({
  lyrics,
  artist,
  styleLock,
  bpmGuess,
  audioUrl = null,
  provider = "brief",
  durationLabel = "3:24",
  hasVocals = false,
  warning,
}) {
  const sunoPrompt = `Style: ${artist?.genre}${styleLock?.matchedName ? ` (lane of ${styleLock.matchedName})` : ""}. Mood: ${artist?.mood}.
Production: ${styleLock?.production || "contemporary"}
Keywords: ${(styleLock?.sonicKeywords || []).join(", ")}
Title: ${lyrics?.title}
Lyrics:
${lyrics?.text || ""}
`.trim();

  const noteReady =
    provider === "songgeneration-studio"
      ? "Chanson générée via SongGeneration Studio (LeVo local)."
      : hasVocals
        ? "Chanson générée via MiniMax Music 2.6 (voix + paroles)."
        : "Piste instrumentale (MusicGen) — pas de chant.";

  return {
    title: lyrics?.title || "Untitled Session",
    artist: artist?.name || "Unknown",
    bpm: bpmGuess,
    key: ["Am", "Dm", "Em", "F", "Gm", "C"][Math.floor(Math.random() * 6)],
    duration: audioUrl ? durationLabel : "3:24",
    style: artist?.genre || "Pop",
    mood: artist?.mood || "emotional",
    status: audioUrl ? "audio-ready" : "prompt-ready",
    waveform: waveform(),
    audioUrl,
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
export async function startTrack({ keys, lyrics, artist }) {
  const { prompt, styleLock, vocal, arrangeBpm } = buildTrackMusicPrompt({ lyrics, artist });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : 95 + Math.floor(Math.random() * 35);
  const draft = assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl: null,
    provider: "brief",
  });

  if (!artist?.gender) {
    throw new Error(
      "Sexe / présentation manquant sur l’artiste — retourne à l’étape Artiste, choisis Homme/Femme, puis régénère le profil avant le morceau.",
    );
  }

  if (isSongGenMusicProvider(keys)) {
    const started = await startSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: vocal?.code || artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
    });
    return {
      pollNeeded: true,
      musicKind: "songgen",
      generationId: started.generationId,
      provider: started.provider,
      draft: {
        ...draft,
        provider: started.provider,
        bpm: bpmGuess,
        voiceGender: started.gender || vocal?.code,
        songGenModel: started.model || null,
        songGenQuality: started.quality || null,
        note: started.model
          ? `SongGen · ${started.model}${started.quality ? ` · ${started.quality}` : ""}`
          : draft.note,
      },
    };
  }

  if (keys?.replicateApiToken?.trim()) {
    const started = await startMinimaxMusic(keys.replicateApiToken.trim(), {
      prompt,
      lyrics: lyrics?.text || "",
    });
    return {
      pollNeeded: true,
      musicKind: "replicate",
      generationId: started.generationId,
      provider: started.provider,
      draft: { ...draft, provider: started.provider, bpm: bpmGuess },
    };
  }

  return {
    pollNeeded: false,
    ...assembleTrackResult({
      lyrics,
      artist,
      styleLock,
      bpmGuess,
      warning:
        "Aucun provider audio — choisis SongGeneration Studio (local) ou un token Replicate dans Paramètres, ou importe un mp3.",
    }),
  };
}

/** Tick de poll court — à appeler depuis le client toutes les ~3 s. */
export async function pollTrack({ keys, generationId, musicKind, draft }) {
  const kind = String(musicKind || "").trim();
  let tick;
  if (kind === "songgen") {
    tick = await pollSongGeneration(keys, generationId);
  } else if (kind === "replicate") {
    const token = keys?.replicateApiToken?.trim();
    if (!token) throw new Error("Token Replicate manquant pour le poll audio");
    tick = await pollMinimaxMusic(token, generationId);
  } else {
    throw new Error(`musicKind inconnu: ${kind || "(vide)"}`);
  }

  if (!tick.done) {
    return {
      done: false,
      status: tick.status,
      progress: tick.progress,
      message: tick.message || "",
      stage: tick.stage || null,
      elapsedSeconds: tick.elapsedSeconds || 0,
      estimatedSeconds: tick.estimatedSeconds || 0,
      generationId,
      musicKind: kind,
    };
  }

  const base = draft && typeof draft === "object" ? draft : {};
  const track = {
    ...base,
    audioUrl: tick.url,
    provider: tick.provider || base.provider,
    hasVocals: Boolean(tick.hasVocals),
    duration: tick.durationLabel || base.duration || "~2–4 min",
    status: "audio-ready",
    note:
      tick.provider === "songgeneration-studio"
        ? "Chanson générée via SongGeneration Studio (LeVo local)."
        : "Chanson générée via MiniMax Music 2.6 (voix + paroles).",
    warning: undefined,
  };
  return { done: true, track, generationId, musicKind: kind };
}

/** Sync (pipeline A→Z). Pour l’UI étape Track, préférer startTrack + pollTrack. */
export async function runTrack({ keys, lyrics, artist }) {
  const { prompt, styleLock, arrangeBpm } = buildTrackMusicPrompt({ lyrics, artist });
  const lockBpm = Number(arrangeBpm ?? styleLock?.bpm);
  const bpmGuess =
    Number.isFinite(lockBpm) && lockBpm >= 60 && lockBpm <= 200
      ? Math.round(lockBpm)
      : 95 + Math.floor(Math.random() * 35);

  let audioUrl = null;
  let provider = "brief";
  let warning;
  let durationLabel = "3:24";
  let hasVocals = false;

  if (isSongGenMusicProvider(keys)) {
    const result = await generateMusicWithSongGeneration(keys, {
      prompt,
      lyrics: lyrics?.text || "",
      title: lyrics?.title || artist?.name || "SONOZZ",
      gender: artist?.gender,
      artist,
      genre: artist?.genre || styleLock?.genre,
      mood: artist?.mood || styleLock?.mood,
      bpm: bpmGuess,
    });
    audioUrl = result.url;
    provider = result.provider;
    durationLabel = result.durationLabel || "~2–4 min";
    hasVocals = Boolean(result.hasVocals);
  } else if (keys?.replicateApiToken?.trim()) {
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
      "Aucun provider audio — choisis SongGeneration Studio (local) ou un token Replicate dans Paramètres, ou importe un mp3.";
  }

  return assembleTrackResult({
    lyrics,
    artist,
    styleLock,
    bpmGuess,
    audioUrl,
    provider,
    durationLabel,
    hasVocals,
    warning,
  });
}

export async function runCover({ keys, prompt, artist, track }) {
  const portraitUrl = artist?.imageUrl;
  if (!isUsableRasterImage(portraitUrl)) {
    throw new Error(
      "Portrait artiste manquant ou SVG. Régénère l’étape Artiste (Replicate Flux photo) avant la jaquette.",
    );
  }

  const genderLock =
    artist?.visualIdentity?.genderLock || genderVisualLock(artist?.gender, artist?.age).en;
  const visual =
    prompt?.trim() ||
    [
      `Album cover for "${track?.title || "Single"}" by ${artist?.name || "artist"}`,
      genderLock,
      `mood ${artist?.visualIdentity?.look || artist?.mood || "nocturne"}`,
      `wardrobe ${artist?.visualIdentity?.wardrobe || "contemporary"}`,
      `${artist?.genre || "pop"} aesthetic`,
      `palette ${artist?.palette?.join(", ") || "brass and moss"}`,
      "cinematic square composition, SAME PERSON and SAME GENDER as the reference portrait photo, do not change sex or age",
    ].join(", ");

  const image = await generateVisual({
    keys,
    prompt: visual,
    kind: "cover",
    referenceImageUrl: portraitUrl,
  });

  return {
    prompt: visual,
    imageUrl: image.imageUrl,
    format: "3000×3000 (master)",
    style: "cinematic / based on artist portrait",
    fallback: false,
    warning: image.warning,
    provider: image.provider,
    basedOnArtist: true,
    localAsset: false,
    sourcePortrait: Boolean(portraitUrl),
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

/** Étapes du pipeline A→Z (ordre d’exécution). */
export const PIPELINE_STEPS = [
  { key: "trends", label: "Tendances", message: "Analyse Deezer + Gemini…" },
  { key: "artist", label: "Artiste", message: "Génération profil artiste…" },
  { key: "lyrics", label: "Paroles", message: "Écriture des paroles…" },
  { key: "track", label: "Morceau", message: "Création morceau / brief audio…" },
  { key: "cover", label: "Jaquette", message: "Génération jaquette…" },
  { key: "distrokid", label: "ONCE", message: "Soumission ONCE → Spotify…" },
  { key: "social", label: "Réseaux", message: "Pack shorts réseaux…" },
  { key: "done", label: "Terminé", message: "Pipeline terminé" },
];

export async function runFullPipeline({
  keys,
  name,
  bioHint,
  theme,
  market,
  genre,
  genres,
  language,
  styleArtist,
  styleArtistPick,
  styleArtistPicks,
  allowTakenName = false,
  mode,
  age,
  gender,
  photos,
  city,
  legalName,
  voiceSample,
  onProgress,
}) {
  const log = [];
  const total = PIPELINE_STEPS.length;
  const push = (step, message) => {
    const entry = { step, message, at: new Date().toISOString() };
    log.push(entry);
    const index = Math.max(
      0,
      PIPELINE_STEPS.findIndex((s) => s.key === step),
    );
    onProgress?.({ ...entry, index, total });
  };

  push("trends", "Analyse Deezer + Gemini…");
  const trends = await runTrends({ keys, market });

  push("artist", "Génération profil artiste…");
  const artist = await runArtist({
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
    allowTakenName,
    mode,
    age,
    gender,
    photos,
    city,
    legalName,
    voiceSample,
  });

  push("lyrics", "Écriture des paroles…");
  const lyrics = await runLyrics({ keys, theme, artist, trends, language: language || artist.language });

  push("track", "Création morceau / brief audio…");
  const track = await runTrack({ keys, lyrics, artist });

  push("cover", "Génération jaquette…");
  const cover = await runCover({ keys, artist, track });

  push("distrokid", "Soumission ONCE → Spotify…");
  const distrokid = await runDistroKid({ keys, artist, track, cover, lyrics, submit: true });

  let social = null;
  if (track?.audioUrl) {
    push("social", "Pack shorts réseaux…");
    social = await runSocial({ keys, artist, track, lyrics, cover });
  } else {
    push("social", "Shorts ignorés — pas d'audio. Termine le morceau d'abord.");
  }

  push("done", "Pipeline terminé");

  return { trends, artist, lyrics, track, cover, distrokid, social, log };
}
