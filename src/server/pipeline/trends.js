import { fetchDeezerCharts } from "../deezer.js";
import { getSpotifyAccess, spotifySearchContext } from "../spotify.js";
import { getArtistBySlug } from "../artists.js";
import { llmJson, requireTextLlm } from "../llm.js";
import {
  forPrompt,
  promptJson,
  slimCharts,
  slimArtistForTrends,
  slimStatsForTrends,
  normalizeRising,
  spotifyQueryForArtist,
} from "./util.js";

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
