import { geminiJson } from "./gemini.js";
import { generateVisual } from "./images.js";
import { fetchDeezerCharts } from "./deezer.js";
import { prepareSpotifyRelease, getSpotifyAccess, spotifySearchContext } from "./spotify.js";
import { submitOnceRelease } from "./once.js";
import { generateMusicWithReplicate } from "./replicate.js";
import { isUsableRasterImage } from "./imagePersist.js";
import { slugify } from "./artists.js";
import { requireGemini } from "./http.js";

function waveform() {
  return Array.from({ length: 40 }, () => 18 + Math.floor(Math.random() * 82));
}

function geminiOpts(keys) {
  return { model: keys?.geminiModel?.trim() || "gemini-2.5-flash-lite" };
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

export async function runTrends({ keys, market = "FR" }) {
  const apiKey = requireGemini(keys);
  const charts = await fetchDeezerCharts();

  let spotifyHints = [];
  try {
    const access = await getSpotifyAccess(keys);
    if (access) {
      const search = await spotifySearchContext(access.token, `genre:pop year:2024-${new Date().getFullYear()}`);
      spotifyHints = (search?.tracks?.items || []).slice(0, 5).map((t) => `${t.name} — ${t.artists?.[0]?.name}`);
    }
  } catch {
    /* optional */
  }

  const analysis = await geminiJson(
    apiKey,
    `Tu es un A&R musical expert marché ${market}.
Analyse ces charts Deezer et indices Spotify pour proposer une opportunité d'artiste fictionnel réaliste.

CHARTS DEEZER:
${promptJson(slimCharts(charts))}

SPOTIFY HINTS:
${promptJson(spotifyHints)}

Réponds en JSON strict:
{
  "rising": [{"tag": string, "score": number, "note": string}],
  "audience": {"age": string, "platforms": string[], "listening": string},
  "opportunity": string,
  "mood": string,
  "genre": string,
  "hooks": string[]
}

Règles pour "rising":
- 3 à 5 tendances concrètes (genres / sons / formats) détectables dans les charts.
- "score" = force relative de l'opportunité sur une échelle ENTIÈRE de 0 à 100 (jamais une fraction 0–1).
- Les scores doivent refléter la conviction A&R : une tendance clairement soutenue par les charts ≥ 60, une piste intéressante 40–59, une intuition faible < 40.
- Au moins une tendance doit avoir un score ≥ 65 si les charts le permettent.`,
    geminiOpts(keys),
  );

  return {
    analyzedAt: new Date().toISOString(),
    source: { deezer: true, spotify: spotifyHints.length > 0 },
    charts: {
      topTracks: charts.tracks.slice(0, 6),
      topArtists: charts.artists.slice(0, 5),
    },
    ...analysis,
    rising: normalizeRising(analysis?.rising),
  };
}

export async function runArtist({ keys, name, bioHint, trends }) {
  const apiKey = requireGemini(keys);
  const data = await geminiJson(
    apiKey,
    `Crée un profil d'artiste musical fictionnel mais ultra-réaliste (marché francophone),
avec une identité visuelle cohérente (look, style photo, wardrobe).
Nom suggéré: ${name || "génère un nom crédible"}
Indices bio: ${bioHint || "aucun"}
Tendances: ${promptJson(trends || {})}

JSON strict:
{
  "name": string,
  "aka": string,
  "legalName": string,
  "genre": string,
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
legalName = prénom + nom de famille réalistes (obligatoire pour la distribution, ex. "Kaelen Moreau"), même si name est un mononyme.
portraitPrompt doit décrire un portrait photo réaliste de l'artiste (âge, traits, coiffure, tenue, lumière, décor), en anglais, sans texte dans l'image.`,
    geminiOpts(keys),
  );

  const portraitPrompt =
    data.visualIdentity?.portraitPrompt ||
    `Cinematic portrait of French music artist ${data.name}, ${data.genre} vibe, ${data.mood} mood, wardrobe ${data.visualIdentity?.wardrobe || "contemporary streetwear"}, ${data.visualIdentity?.photographyStyle || "film grain night portrait"}, square composition, photorealistic`;

  const portrait = await generateVisual({
    keys,
    prompt: portraitPrompt,
    kind: "portrait",
  });

  return {
    ...data,
    slug: slugify(data.aka || data.name || "artiste"),
    imageUrl: portrait.imageUrl,
    imageFallback: false,
    imageWarning: portrait.warning,
    imageProvider: portrait.provider,
    localAsset: false,
    portraitPrompt,
  };
}

export async function runLyrics({ keys, theme, artist, trends }) {
  const apiKey = requireGemini(keys);
  const data = await geminiJson(
    apiKey,
    `Écris des paroles de chanson originales en français pour cet artiste.
Artiste: ${promptJson(artist)}
Thème/titre: ${theme || "inspire-toi des tendances"}
Tendances: ${promptJson(trends || {})}

JSON strict:
{
  "title": string,
  "theme": string,
  "language": "fr",
  "structure": string[],
  "text": string
}
Le champ text doit contenir les tags MiniMax en anglais: [Verse], [Chorus], [Verse], [Bridge], [Chorus], [Outro] avec de vraies paroles françaises sous chaque tag.`,
    geminiOpts(keys),
  );
  return data;
}

export async function runTrack({ keys, lyrics, artist }) {
  const prompt = [
    `${artist?.genre || "pop"}`,
    `${artist?.mood || "emotional"} mood`,
    `${artist?.voice || "modern vocals"}`,
    "French contemporary production, radio-ready, emotional hook",
  ].join(", ");

  let audioUrl = null;
  let provider = "brief";
  let warning;
  let durationLabel = "3:24";
  let hasVocals = false;

  if (keys?.replicateApiToken?.trim()) {
    // Erreur propagée (pas avalée) pour que l’UI affiche le message rouge
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
      "Aucun token Replicate — aucun fichier audio généré. Importe un mp3 (Suno) ou ajoute le token dans Paramètres.";
  }

  const sunoPrompt = `Style: ${artist?.genre}. Mood: ${artist?.mood}.
Title: ${lyrics?.title}
Lyrics:
${lyrics?.text || ""}
`.trim();

  return {
    title: lyrics?.title || "Untitled Session",
    artist: artist?.name || "Unknown",
    bpm: 95 + Math.floor(Math.random() * 35),
    key: ["Am", "Dm", "Em", "F", "Gm", "C"][Math.floor(Math.random() * 6)],
    duration: audioUrl ? durationLabel : "3:24",
    style: artist?.genre || "Pop",
    status: audioUrl ? "audio-ready" : "prompt-ready",
    waveform: waveform(),
    audioUrl,
    provider,
    hasVocals,
    sunoPrompt,
    note: audioUrl
      ? hasVocals
        ? "Chanson générée via MiniMax Music 2.6 (voix + paroles)."
        : "Piste instrumentale (MusicGen) — pas de chant."
      : "Métadonnées + prompt Suno prêts — audio manquant jusqu’à import ou Replicate.",
    warning,
  };
}

export async function runCover({ keys, prompt, artist, track }) {
  const portraitUrl = artist?.imageUrl;
  if (!isUsableRasterImage(portraitUrl)) {
    throw new Error(
      "Portrait artiste manquant ou SVG. Régénère l’étape Artiste (Replicate Flux photo) avant la jaquette.",
    );
  }

  const visual =
    prompt?.trim() ||
    [
      `Album cover for "${track?.title || "Single"}" by ${artist?.name || "artist"}`,
      `mood ${artist?.visualIdentity?.look || artist?.mood || "nocturne"}`,
      `wardrobe ${artist?.visualIdentity?.wardrobe || "contemporary"}`,
      `${artist?.genre || "pop"} aesthetic`,
      `palette ${artist?.palette?.join(", ") || "brass and moss"}`,
      "cinematic square composition, keep the same artist face from the reference photo",
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

export async function runDistroKid({ keys, artist, track, cover, lyrics, submit = true }) {
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

  const once = await submitOnceRelease(onceToken, { artist, track, cover, lyrics, keys });
  return {
    provider: "once",
    ...once,
    uploadUrl: once.dashboardUrl,
    spotifyAssist,
  };
}

export async function runSocial({ keys, artist, track, lyrics, cover }) {
  const apiKey = requireGemini(keys);
  const data = await geminiJson(
    apiKey,
    `Crée un pack de publication short vertical 9:16 pour cet artiste.
Artiste: ${promptJson(artist)}
Titre: ${track?.title || ""}
Jaquette / univers: ${promptJson({ prompt: cover?.prompt, style: cover?.style })}
Extrait paroles: ${(lyrics?.text || "").slice(0, 500)}

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
veoPromptHint = 1 phrase en anglais décrivant le clip cinéma fidèle au portrait + jaquette.
scenes = 3 battements visuels cohérents avec le look de l'artiste.`,
    geminiOpts(keys),
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

export async function runFullPipeline({ keys, name, bioHint, theme, market }) {
  const log = [];
  const push = (step, message) => log.push({ step, message, at: new Date().toISOString() });

  push("trends", "Analyse Deezer + Gemini…");
  const trends = await runTrends({ keys, market });

  push("artist", "Génération profil artiste…");
  const artist = await runArtist({ keys, name, bioHint, trends });

  push("lyrics", "Écriture des paroles…");
  const lyrics = await runLyrics({ keys, theme, artist, trends });

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
