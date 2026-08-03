import { getSpotifyAccess, spotifySearchContext } from "./spotify.js";
import { llmJson, requireTextLlm } from "./llm.js";

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseGenre(g) {
  return String(g || "")
    .trim()
    .split(/[\s_/]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Score de matching nom artiste (exact > préfixe > inclusion > fuzzy). */
function nameMatchScore(candidate, query) {
  const a = norm(candidate);
  const b = norm(query);
  if (!a || !b) return 0;
  if (a === b) return 1000;

  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  const aSet = new Set(at);
  const exactOverlap = bt.filter((t) => aSet.has(t)).length;
  const tokenCoverage = bt.length ? exactOverlap / bt.length : 0;

  // Préfixe uniquement si longueurs proches (évite "Jonah" > "Jonah Dean")
  if (a.startsWith(b) || b.startsWith(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (ratio >= 0.8) return 800;
    if (tokenCoverage >= 1) return 550;
    return 80 + Math.round(tokenCoverage * 100);
  }

  if (a.includes(b) || b.includes(a)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (ratio >= 0.75) return 600;
    if (tokenCoverage >= 1) return 520;
    return 60 + Math.round(tokenCoverage * 120);
  }

  if (exactOverlap === bt.length && bt.length > 0) {
    // Tous les tokens query présents — pénaliser si candidat beaucoup plus court
    const lenRatio = at.length / bt.length;
    if (lenRatio >= 0.8 && lenRatio <= 1.5) return 500;
    return 280;
  }
  if (exactOverlap > 0) return 120 + exactOverlap * 40;

  // Fuzzy token (typos : johan ↔ jonah)
  let fuzzyHits = 0;
  for (const t of bt) {
    if (t.length < 3) continue;
    if (at.some((x) => tokenClose(x, t))) fuzzyHits += 1;
  }
  if (fuzzyHits === bt.length && bt.length > 0) {
    const lenRatio = at.length / bt.length;
    if (lenRatio >= 0.8 && lenRatio <= 1.5) return 420;
    return 200;
  }
  if (fuzzyHits > 0) return 80 + fuzzyHits * 30;
  return 0;
}

function tokenClose(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshtein(a, b) <= (a.length <= 4 ? 1 : 2);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

async function searchSpotifyArtist(keys, query) {
  const access = await getSpotifyAccess(keys);
  if (!access?.token) return null;

  const candidates = await listSpotifyCandidates(keys, query);
  const hit = candidates[0];
  if (!hit?.id) return null;

  return hydrateSpotifyCatalog(access.token, hit, hit.matchScore);
}

async function listSpotifyCandidates(keys, query) {
  const access = await getSpotifyAccess(keys);
  if (!access?.token) return [];

  const qArtist = encodeURIComponent(`artist:${query}`);
  const qPlain = encodeURIComponent(query);
  const headers = { Authorization: `Bearer ${access.token}` };

  const [resArtist, resPlain, resTrack] = await Promise.all([
    fetch(`https://api.spotify.com/v1/search?q=${qArtist}&type=artist&limit=10`, { headers }),
    fetch(`https://api.spotify.com/v1/search?q=${qPlain}&type=artist&limit=10`, { headers }),
    fetch(`https://api.spotify.com/v1/search?q=${qPlain}&type=track&limit=15`, { headers }),
  ]);

  const items = [];
  if (resArtist.ok) {
    const d = await resArtist.json();
    items.push(...(d.artists?.items || []));
  }
  if (resPlain.ok) {
    const d = await resPlain.json();
    items.push(...(d.artists?.items || []));
  }
  // Artistes niche souvent mieux trouvés via leurs titres
  if (resTrack.ok) {
    const d = await resTrack.json();
    for (const t of d.tracks?.items || []) {
      for (const a of t.artists || []) {
        if (a?.id) items.push({ ...a, genres: a.genres || [], popularity: a.popularity || 0, followers: a.followers || { total: 0 }, images: a.images || [], external_urls: a.external_urls || {} });
      }
    }
  }

  const byId = new Map();
  for (const a of items) {
    if (!a?.id) continue;
    const prev = byId.get(a.id);
    if (!prev || (a.popularity || 0) > (prev.popularity || 0)) byId.set(a.id, a);
  }

  // Enrichir les artistes issus des tracks (souvent sans genres/images)
  const thin = [...byId.values()].filter((a) => !(a.images?.length) || a.popularity == null);
  if (thin.length && thin.length <= 8) {
    await Promise.all(
      thin.slice(0, 5).map(async (a) => {
        try {
          const res = await fetch(`https://api.spotify.com/v1/artists/${a.id}`, { headers });
          if (!res.ok) return;
          const full = await res.json();
          byId.set(a.id, full);
        } catch {
          /* ignore */
        }
      }),
    );
  }

  return [...byId.values()]
    .map((a) => ({
      source: "spotify",
      id: a.id,
      name: a.name,
      genres: (a.genres || []).map(titleCaseGenre).slice(0, 3),
      followers: a.followers?.total ?? null,
      popularity: a.popularity ?? null,
      image: a.images?.[1]?.url || a.images?.[0]?.url || null,
      url: a.external_urls?.spotify || null,
      matchScore: nameMatchScore(a.name, query) + Math.min(99, a.popularity || 0) * 0.2,
    }))
    .sort((x, y) => y.matchScore - x.matchScore)
    .slice(0, 8);
}

async function hydrateSpotifyCatalog(token, hit, matchScore = 1000) {
  const headers = { Authorization: `Bearer ${token}` };
  const [artistRes, topRes, relatedRes, albumsRes] = await Promise.all([
    fetch(`https://api.spotify.com/v1/artists/${hit.id}`, { headers }),
    fetch(`https://api.spotify.com/v1/artists/${hit.id}/top-tracks?market=FR`, { headers }),
    fetch(`https://api.spotify.com/v1/artists/${hit.id}/related-artists`, { headers }),
    fetch(`https://api.spotify.com/v1/artists/${hit.id}/albums?include_groups=album,single&limit=6&market=FR`, {
      headers,
    }),
  ]);

  const artist = artistRes.ok ? await artistRes.json() : hit;
  const top = topRes.ok ? await topRes.json() : { tracks: [] };
  const related = relatedRes.ok ? await relatedRes.json() : { artists: [] };
  const albums = albumsRes.ok ? await albumsRes.json() : { items: [] };

  const relatedArtists = (related.artists || []).slice(0, 8).map((a) => ({
    name: a.name,
    genres: a.genres || [],
  }));

  const genrePool = [
    ...(artist.genres || hit.genres || []),
    ...relatedArtists.flatMap((a) => a.genres || []),
  ];
  const genreCounts = new Map();
  for (const g of genrePool) {
    const key = String(g || "").trim().toLowerCase();
    if (!key) continue;
    genreCounts.set(key, (genreCounts.get(key) || 0) + 1);
  }
  const inferredGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => titleCaseGenre(g));

  return {
    source: "spotify",
    id: artist.id || hit.id,
    name: artist.name || hit.name,
    genres: (artist.genres || hit.genres || []).map(titleCaseGenre),
    inferredGenres,
    popularity: artist.popularity ?? hit.popularity ?? null,
    followers: artist.followers?.total ?? null,
    topTracks: (top.tracks || []).slice(0, 6).map((t) => t.name).filter(Boolean),
    albums: (albums.items || []).slice(0, 5).map((a) => a.name).filter(Boolean),
    related: relatedArtists.map((a) => a.name).filter(Boolean),
    relatedGenres: inferredGenres,
    url: artist.external_urls?.spotify || hit.url || null,
    image: artist.images?.[0]?.url || hit.image || null,
    matchScore,
  };
}

async function listDeezerCandidates(query) {
  const q = encodeURIComponent(query);
  const res = await fetch(`https://api.deezer.com/search/artist?q=${q}&limit=10`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || [])
    .map((a) => ({
      source: "deezer",
      id: String(a.id),
      name: a.name,
      genres: [],
      followers: a.nb_fan ?? null,
      popularity: null,
      image: a.picture_medium || a.picture || null,
      url: a.link || null,
      matchScore:
        nameMatchScore(a.name, query) + Math.min(99, Math.log10((a.nb_fan || 1) + 1) * 20),
    }))
    .sort((x, y) => y.matchScore - x.matchScore)
    .slice(0, 8);
}

async function listItunesCandidates(query) {
  const q = encodeURIComponent(query);
  const [artistsRes, songsRes] = await Promise.all([
    fetch(`https://itunes.apple.com/search?term=${q}&entity=musicArtist&limit=15`),
    fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=15`),
  ]);

  const byId = new Map();

  if (artistsRes.ok) {
    const data = await artistsRes.json();
    for (const a of data.results || []) {
      if (!a.artistId) continue;
      const id = String(a.artistId);
      byId.set(id, {
        source: "itunes",
        id,
        name: a.artistName,
        genres: a.primaryGenreName ? [titleCaseGenre(a.primaryGenreName)] : [],
        followers: null,
        popularity: null,
        image: null,
        url: a.artistLinkUrl || null,
        matchScore: nameMatchScore(a.artistName, query) + 30,
      });
    }
  }

  // Les titres remontent souvent mieux les artistes niche (ex. Jonah Dean)
  if (songsRes.ok) {
    const data = await songsRes.json();
    for (const t of data.results || []) {
      if (!t.artistId || !t.artistName) continue;
      const id = String(t.artistId);
      const score = nameMatchScore(t.artistName, query) + 40;
      const prev = byId.get(id);
      if (!prev || score > prev.matchScore) {
        byId.set(id, {
          source: "itunes",
          id,
          name: t.artistName,
          genres: t.primaryGenreName
            ? [titleCaseGenre(t.primaryGenreName)]
            : prev?.genres || [],
          followers: null,
          popularity: null,
          image: t.artworkUrl100?.replace("100x100", "300x300") || prev?.image || null,
          url: t.artistViewUrl || prev?.url || null,
          matchScore: score,
        });
      } else if (prev && !prev.image && t.artworkUrl100) {
        prev.image = t.artworkUrl100.replace("100x100", "300x300");
      }
    }
  }

  return [...byId.values()]
    .sort((x, y) => y.matchScore - x.matchScore)
    .slice(0, 10);
}

async function hydrateItunesCatalog(hit, matchScore = 1000) {
  const id = encodeURIComponent(hit.id);
  const q = encodeURIComponent(hit.name || "");
  const [lookupRes, songsRes] = await Promise.all([
    fetch(`https://itunes.apple.com/lookup?id=${id}&entity=album&limit=6`),
    fetch(
      `https://itunes.apple.com/search?term=${q}&entity=song&attribute=artistTerm&limit=8`,
    ),
  ]);

  const lookup = lookupRes.ok ? await lookupRes.json() : { results: [] };
  const artistRow = (lookup.results || []).find((r) => r.wrapperType === "artist") || {};
  const albums = (lookup.results || [])
    .filter((r) => r.wrapperType === "collection")
    .map((a) => a.collectionName)
    .filter(Boolean)
    .slice(0, 5);

  const songsData = songsRes.ok ? await songsRes.json() : { results: [] };
  const topTracks = (songsData.results || [])
    .filter((t) => String(t.artistId) === String(hit.id))
    .map((t) => t.trackName)
    .filter(Boolean)
    .slice(0, 6);

  const genre =
    artistRow.primaryGenreName ||
    hit.genres?.[0] ||
    songsData.results?.[0]?.primaryGenreName ||
    null;

  const artwork =
    hit.image ||
    songsData.results?.find((t) => String(t.artistId) === String(hit.id))?.artworkUrl100?.replace(
      "100x100",
      "600x600",
    ) ||
    null;

  return {
    source: "itunes",
    id: String(hit.id),
    name: artistRow.artistName || hit.name,
    genres: genre ? [titleCaseGenre(genre)] : (hit.genres || []).map(titleCaseGenre),
    inferredGenres: genre ? [titleCaseGenre(genre)] : [],
    popularity: null,
    followers: null,
    topTracks,
    albums,
    related: [],
    relatedGenres: [],
    url: artistRow.artistLinkUrl || hit.url || null,
    image: artwork,
    matchScore,
  };
}

async function searchDeezerArtist(query) {
  const candidates = await listDeezerCandidates(query);
  // Préférer un match nominal correct
  const hit =
    candidates.find((c) => nameMatchScore(c.name, query) >= 500) || candidates[0];
  if (!hit?.id) return null;
  return hydrateDeezerCatalog(hit, hit.matchScore);
}

async function searchItunesArtist(query) {
  const candidates = await listItunesCandidates(query);
  const hit =
    candidates.find((c) => nameMatchScore(c.name, query) >= 500) || candidates[0];
  if (!hit?.id) return null;
  return hydrateItunesCatalog(hit, hit.matchScore);
}

async function hydrateDeezerCatalog(hit, matchScore = 1000) {
  const [artistRes, topRes, relatedRes] = await Promise.all([
    fetch(`https://api.deezer.com/artist/${hit.id}`),
    fetch(`https://api.deezer.com/artist/${hit.id}/top?limit=6`),
    fetch(`https://api.deezer.com/artist/${hit.id}/related?limit=8`),
  ]);

  const artist = artistRes.ok ? await artistRes.json() : hit;
  const top = topRes.ok ? await topRes.json() : { data: [] };
  const related = relatedRes.ok ? await relatedRes.json() : { data: [] };

  return {
    source: "deezer",
    id: String(artist.id || hit.id),
    name: artist.name || hit.name,
    genres: [],
    inferredGenres: [],
    popularity: null,
    followers: artist.nb_fan ?? hit.followers ?? null,
    topTracks: (top.data || []).map((t) => t.title).filter(Boolean),
    albums: [],
    related: (related.data || []).map((a) => a.name).filter(Boolean),
    relatedGenres: [],
    url: artist.link || hit.url || null,
    image: artist.picture_xl || artist.picture_medium || hit.image || null,
    matchScore,
  };
}

async function listMusicBrainzCandidates(query) {
  const q = encodeURIComponent(query);
  const res = await fetch(
    `https://musicbrainz.org/ws/2/artist/?query=${q}&fmt=json&limit=8`,
    {
      headers: {
        Accept: "application/json",
        // MusicBrainz demande un User-Agent identifiable
        "User-Agent": "SONOZZ/1.0 (https://github.com/sonozz)",
      },
    },
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.artists || [])
    .map((a) => ({
      source: "musicbrainz",
      id: a.id,
      name: a.name,
      genres: (a.tags || [])
        .sort((x, y) => (y.count || 0) - (x.count || 0))
        .slice(0, 3)
        .map((t) => titleCaseGenre(t.name)),
      followers: null,
      popularity: a.score ?? null,
      image: null,
      url: `https://musicbrainz.org/artist/${a.id}`,
      // score MB 0–100 → boost matching nominal
      matchScore: nameMatchScore(a.name, query) + Math.min(80, Number(a.score) || 0) * 0.5,
      country: a.country || a.area?.name || null,
    }))
    .sort((x, y) => y.matchScore - x.matchScore)
    .slice(0, 6);
}

/**
 * Si MusicBrainz trouve un bon match, on le résout sur iTunes (image + genre + tracks).
 */
async function resolveMusicBrainzViaItunes(mbHits, query) {
  const out = [];
  for (const hit of mbHits.slice(0, 3)) {
    // Exiger un bon match sur le nom complet (pas un prénom seul)
    if (nameMatchScore(hit.name, query) < 450) continue;
    try {
      const itunes = await listItunesCandidates(hit.name);
      const exact =
        itunes.find((c) => norm(c.name) === norm(hit.name)) ||
        itunes.find((c) => nameMatchScore(c.name, hit.name) >= 800);
      if (exact && nameMatchScore(exact.name, query) >= 450) {
        out.push({
          ...exact,
          matchScore: Math.max(exact.matchScore, hit.matchScore) + 20,
          genres: exact.genres?.length ? exact.genres : hit.genres,
        });
      } else if (nameMatchScore(hit.name, query) >= 500) {
        out.push(hit);
      }
    } catch {
      if (nameMatchScore(hit.name, query) >= 500) out.push(hit);
    }
  }
  return out;
}

/**
 * Liste des candidats pour validation utilisateur (Spotify + iTunes + Deezer + MusicBrainz).
 */
export async function searchStyleArtistCandidates(keys, artistName) {
  const query = String(artistName || "").trim().slice(0, 120);
  if (query.length < 2) return { query, candidates: [] };

  const [spotify, itunes, deezer, musicbrainz] = await Promise.all([
    listSpotifyCandidates(keys, query).catch(() => []),
    listItunesCandidates(query).catch(() => []),
    listDeezerCandidates(query).catch(() => []),
    listMusicBrainzCandidates(query).catch(() => []),
  ]);

  const mbResolved = await resolveMusicBrainzViaItunes(musicbrainz, query).catch(() => musicbrainz);

  // Dédupliquer par nom normalisé — priorité : exact match > Spotify > iTunes > Deezer > MB
  const sourceRank = { spotify: 4, itunes: 3, deezer: 2, musicbrainz: 1 };
  const byName = new Map();
  for (const c of [...spotify, ...itunes, ...deezer, ...mbResolved]) {
    const key = norm(c.name);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, c);
      continue;
    }
    const betterScore = c.matchScore > prev.matchScore + 5;
    const betterSource =
      Math.abs(c.matchScore - prev.matchScore) <= 5 &&
      (sourceRank[c.source] || 0) > (sourceRank[prev.source] || 0);
    if (betterScore || betterSource) byName.set(key, c);
  }

  const ranked = [...byName.values()].sort((a, b) => b.matchScore - a.matchScore);
  const best = ranked[0]?.matchScore || 0;
  const candidates = ranked
    .filter((c) => {
      // Garder les bons matchs ; si on a un exact, dropper le bruit faible
      if (best >= 900) return c.matchScore >= 250;
      if (best >= 500) return c.matchScore >= 150;
      return c.matchScore >= 80;
    })
    .slice(0, 10)
    .map(({ matchScore, ...rest }) => ({
      ...rest,
      matchScore: Math.round(matchScore),
    }));

  return {
    query,
    candidates,
    sources: {
      spotify: spotify.length > 0,
      itunes: itunes.length > 0,
      deezer: deezer.length > 0,
      musicbrainz: musicbrainz.length > 0,
    },
  };
}

/**
 * Charge la fiche complète d'un candidat validé par l'utilisateur.
 */
export async function loadStyleArtistCatalog(keys, pick) {
  if (!pick?.source || !pick?.id) {
    throw new Error("Sélection artiste invalide — valide un résultat de recherche.");
  }
  if (pick.source === "spotify") {
    const access = await getSpotifyAccess(keys);
    if (!access?.token) {
      throw new Error("Spotify non configuré — impossible de charger cet artiste.");
    }
    return hydrateSpotifyCatalog(access.token, pick, 1000);
  }
  if (pick.source === "itunes") {
    return hydrateItunesCatalog(pick, 1000);
  }
  if (pick.source === "deezer") {
    return hydrateDeezerCatalog(pick, 1000);
  }
  if (pick.source === "musicbrainz") {
    // Essayer de résoudre via iTunes pour titres / artwork
    try {
      const itunes = await listItunesCandidates(pick.name);
      const exact =
        itunes.find((c) => norm(c.name) === norm(pick.name)) || itunes[0];
      if (exact && nameMatchScore(exact.name, pick.name) >= 600) {
        return hydrateItunesCatalog(exact, 1000);
      }
    } catch {
      /* ignore */
    }
    return {
      source: "musicbrainz",
      id: String(pick.id),
      name: pick.name,
      genres: (pick.genres || []).map(titleCaseGenre),
      inferredGenres: (pick.genres || []).map(titleCaseGenre),
      popularity: null,
      followers: null,
      topTracks: [],
      albums: [],
      related: [],
      relatedGenres: [],
      url: pick.url || `https://musicbrainz.org/artist/${pick.id}`,
      image: pick.image || null,
      matchScore: 1000,
    };
  }
  throw new Error(`Source inconnue : ${pick.source}`);
}

/**
 * Enrichit une fiche catalogue (souvent sans genres Spotify) en brief style verrouillé via LLM.
 */
async function enrichStyleLock(keys, catalog, query) {
  requireTextLlm(keys);
  const knownGenres = [
    ...(catalog.genres || []),
    ...(catalog.inferredGenres || []),
    ...(catalog.relatedGenres || []),
  ].filter(Boolean);
  const uniqueGenres = [...new Set(knownGenres.map((g) => g.toLowerCase()))].map(titleCaseGenre);

  const data = await llmJson(
    keys,
    `Tu es un A&R / analyste musical. L'utilisateur veut cloner le STYLE musical exact d'un artiste réel.

Artiste recherché: "${query}"
Fiche catalogue (${catalog.source}):
${JSON.stringify(
  {
    name: catalog.name,
    genres: catalog.genres,
    inferredFromRelated: catalog.inferredGenres,
    topTracks: catalog.topTracks,
    albums: catalog.albums,
    relatedArtists: catalog.related,
    followers: catalog.followers,
    popularity: catalog.popularity,
  },
  null,
  2,
)}

Genres déjà connus: ${uniqueGenres.join(", ") || "(aucun — déduis depuis titres, related et ta connaissance)"}

Retourne un LOCK STYLE strict pour créer un artiste FICTIONNEL dans EXACTEMENT la même lane sonore.
Pas de vague "pop" générique si l'artiste est funk-rock / experimental pop / etc.

JSON strict:
{
  "resolvedName": string,
  "genres": [string, string, string],
  "genreSummary": string,
  "mood": string,
  "energy": "low" | "mid" | "high",
  "tempoFeel": string,
  "production": string,
  "vocalStyle": string,
  "sonicKeywords": [string, string, string, string, string],
  "similarArtists": [string, string, string],
  "writingStyle": string,
  "visualVibe": string,
  "doNot": [string, string, string]
}
"genres" = 2 à 4 labels précis (ex. "Funk Rock", "Experimental Pop").
"genreSummary" = une ligne, ex. "experimental pop / funk-rock énergique, grooves maximalistes".
"doNot" = styles INTERDITS (ex. drill, ambient zen, hyperpop asiatique) pour éviter les dérives.
"similarArtists" = artistes vraiment proches soniquement (pas des stars aléatoires).`,
  );

  return {
    resolvedName: data.resolvedName || catalog.name || query,
    genres: (Array.isArray(data.genres) ? data.genres : [])
      .map((g) => String(g || "").trim())
      .filter(Boolean)
      .slice(0, 4),
    genreSummary: String(data.genreSummary || "").trim(),
    mood: String(data.mood || "").trim(),
    energy: ["low", "mid", "high"].includes(data.energy) ? data.energy : "mid",
    tempoFeel: String(data.tempoFeel || "").trim(),
    production: String(data.production || "").trim(),
    vocalStyle: String(data.vocalStyle || "").trim(),
    sonicKeywords: (Array.isArray(data.sonicKeywords) ? data.sonicKeywords : [])
      .map((k) => String(k || "").trim())
      .filter(Boolean)
      .slice(0, 8),
    similarArtists: (Array.isArray(data.similarArtists) ? data.similarArtists : [])
      .map((a) => String(a || "").trim())
      .filter(Boolean)
      .slice(0, 5),
    writingStyle: String(data.writingStyle || "").trim(),
    visualVibe: String(data.visualVibe || "").trim(),
    doNot: (Array.isArray(data.doNot) ? data.doNot : [])
      .map((d) => String(d || "").trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}

/**
 * Recherche fiable d'un artiste réel + verrouillage de tous les paramètres de style.
 * @param {object} keys
 * @param {string|{source:string,id:string,name?:string}|null} artistNameOrPick
 *   Soit un nom (legacy), soit un candidat validé { source, id, name }.
 * @throws Error si introuvable
 */
export async function resolveStyleReference(keys, artistNameOrPick) {
  const pick =
    artistNameOrPick &&
    typeof artistNameOrPick === "object" &&
    artistNameOrPick.source &&
    artistNameOrPick.id
      ? artistNameOrPick
      : null;
  const query = String(pick?.name || artistNameOrPick || "")
    .trim()
    .slice(0, 120);

  if (!pick && !query) throw new Error("Nom d'artiste de référence manquant");

  let catalog = null;
  let spotifyErr = null;

  if (pick) {
    catalog = await loadStyleArtistCatalog(keys, pick);
  } else {
    try {
      catalog = await searchSpotifyArtist(keys, query);
    } catch (e) {
      spotifyErr = e;
    }

    if (!catalog || nameMatchScore(catalog.name, query) < 500) {
      try {
        const itunesHit = await searchItunesArtist(query);
        if (
          itunesHit &&
          (!catalog || nameMatchScore(itunesHit.name, query) > nameMatchScore(catalog.name, query))
        ) {
          catalog = itunesHit;
        }
      } catch {
        /* ignore */
      }
    }

    if (!catalog || nameMatchScore(catalog.name, query) < 500) {
      try {
        const deezerHit = await searchDeezerArtist(query);
        if (
          deezerHit &&
          (!catalog || nameMatchScore(deezerHit.name, query) > nameMatchScore(catalog.name, query))
        ) {
          catalog = deezerHit;
        }
      } catch {
        /* ignore */
      }
    }

    if (!catalog) {
      try {
        const access = await getSpotifyAccess(keys);
        if (access?.token) {
          const search = await spotifySearchContext(access.token, query);
          const hit = (search?.artists?.items || [])
            .map((a) => ({ ...a, _score: nameMatchScore(a.name, query) }))
            .sort((x, y) => y._score - x._score)[0];
          if (hit) {
            catalog = await hydrateSpotifyCatalog(access.token, hit, hit._score);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!catalog) {
    const hint = spotifyErr?.message
      ? ` (${spotifyErr.message})`
      : !keys?.spotifyClientId?.trim()
        ? " — configure Spotify Client ID/Secret dans Paramètres pour une recherche fiable"
        : "";
    throw new Error(
      `Artiste de référence introuvable : « ${query} »${hint}. Cherche puis valide un résultat.`,
    );
  }

  const lock = await enrichStyleLock(keys, catalog, catalog.name || query);

  // Genres finaux : lock LLM prioritaire, sinon catalogue
  let genres = lock.genres.length
    ? lock.genres
    : (catalog.genres.length ? catalog.genres : catalog.inferredGenres).slice(0, 4);
  if (!genres.length) {
    genres = ["Pop"];
  }

  const genreSummary = lock.genreSummary || genres.join(" × ");

  const influences = [
    catalog.name,
    ...lock.similarArtists,
    ...(catalog.related || []),
  ]
    .filter((v, i, arr) => v && arr.findIndex((x) => norm(x) === norm(v)) === i)
    .slice(0, 6);

  return {
    query: query || catalog.name,
    matchedName: catalog.name,
    source: catalog.source,
    sourceId: catalog.id,
    confidence: pick
      ? "confirmed"
      : catalog.matchScore >= 900
        ? "high"
        : catalog.matchScore >= 600
          ? "medium"
          : "low",
    url: catalog.url,
    image: catalog.image,
    topTracks: catalog.topTracks,
    albums: catalog.albums,
    related: catalog.related,
    genres,
    genreSummary,
    mood: lock.mood || "énergique",
    energy: lock.energy,
    tempoFeel: lock.tempoFeel,
    production: lock.production,
    vocalStyle: lock.vocalStyle,
    sonicKeywords: lock.sonicKeywords,
    writingStyle: lock.writingStyle,
    visualVibe: lock.visualVibe,
    doNot: lock.doNot,
    influences,
    musicPrompt: [
      genreSummary,
      lock.production,
      ...(lock.sonicKeywords || []),
      lock.vocalStyle ? `vocals: ${lock.vocalStyle}` : "",
      lock.tempoFeel ? `tempo: ${lock.tempoFeel}` : "",
      `energy ${lock.energy}`,
      `exactly in the style of ${catalog.name}`,
      "original artist, not a cover, not an imitation of identity",
    ]
      .filter(Boolean)
      .join(", "),
  };
}
