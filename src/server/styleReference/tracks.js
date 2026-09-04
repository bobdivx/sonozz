import { getSpotifyAccess } from "../spotify.js";
import { listenArtistPreviewDna } from "../musicListen.js";
import { withKnownArtistLane } from "../../lib/musicLane.js";
import { norm, uniqGenres, titleCaseGenre, nameMatchScore } from "./util.js";
import { enrichStyleLock } from "./lock.js";

export function rankArtistTopTracks(raw = [], artistName = "") {
  const want = norm(artistName);
  const scored = raw.map((c, i) => {
    const artist = norm(c.artistName);
    const same =
      Boolean(want) &&
      (artist === want || artist.includes(want) || want.includes(artist));
    return {
      c,
      score: (same ? 80 : 0) + (c.previewUrl ? 25 : 0) + Math.max(0, 12 - i),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const byName = new Map();
  for (const { c } of scored) {
    const key = `${norm(c.name)}|${norm(c.artistName)}`;
    if (key.startsWith("|")) continue;
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { ...c, genres: uniqGenres(c.genres) });
      continue;
    }
    prev.genres = uniqGenres([...(prev.genres || []), ...(c.genres || [])]);
    if (!prev.previewUrl && c.previewUrl) prev.previewUrl = c.previewUrl;
    if (!prev.image && c.image) prev.image = c.image;
  }
  return [...byName.values()].slice(0, 8);
}

function trackFromDeezer(t) {
  if (!t?.id) return null;
  return {
    source: "deezer",
    id: String(t.id),
    name: t.title || t.title_short || "Sans titre",
    artistName: t.artist?.name || "",
    artistId: t.artist?.id != null ? String(t.artist.id) : undefined,
    album: t.album?.title || "",
    image: t.album?.cover_medium || t.album?.cover || null,
    previewUrl: t.preview || null,
    duration: t.duration || null,
    url: t.link || `https://www.deezer.com/track/${t.id}`,
    genres: [],
  };
}

function trackFromItunes(t) {
  if (!t?.trackId) return null;
  return {
    source: "itunes",
    id: String(t.trackId),
    name: t.trackName || "Sans titre",
    artistName: t.artistName || "",
    artistId: t.artistId != null ? String(t.artistId) : undefined,
    album: t.collectionName || "",
    image: t.artworkUrl100?.replace("100x100", "300x300") || t.artworkUrl60 || null,
    previewUrl: t.previewUrl || null,
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    url: t.trackViewUrl || null,
    genres: t.primaryGenreName ? [titleCaseGenre(t.primaryGenreName)] : [],
  };
}

function trackFromSpotify(t) {
  if (!t?.id) return null;
  return {
    source: "spotify",
    id: String(t.id),
    name: t.name || "Sans titre",
    artistName: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
    artistId: t.artists?.[0]?.id ? String(t.artists[0].id) : undefined,
    album: t.album?.name || "",
    image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
    previewUrl: t.preview_url || null,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
    url: t.external_urls?.spotify || null,
    genres: [],
  };
}

async function deezerTopTracksForArtistName(name) {
  const q = String(name || "").trim();
  if (q.length < 2) return [];
  const enc = encodeURIComponent(q);
  const searchRes = await fetch(`https://api.deezer.com/search/artist?q=${enc}&limit=5`);
  if (!searchRes.ok) return [];
  const search = await searchRes.json();
  const hit =
    (search.data || []).find((a) => nameMatchScore(a.name, q) >= 500) || (search.data || [])[0];
  if (!hit?.id) return [];
  const topRes = await fetch(`https://api.deezer.com/artist/${hit.id}/top?limit=8`);
  if (!topRes.ok) return [];
  const top = await topRes.json();
  return (top.data || []).map(trackFromDeezer).filter(Boolean);
}

/**
 * Titres les plus connus d’un artiste de référence (Deezer top + catalogue source).
 */
export async function listArtistTopTrackCandidates(keys, artistPick) {
  const source = String(artistPick?.source || "").trim();
  const id = String(artistPick?.id || "").trim();
  const name = String(artistPick?.name || "").trim();
  if (!id && name.length < 2) return { candidates: [], sources: [] };

  const raw = [];
  const sources = [];

  const tasks = [];

  if (name) {
    tasks.push(
      deezerTopTracksForArtistName(name)
        .then((list) => {
          if (list.length) sources.push("deezer");
          raw.push(...list);
        })
        .catch(() => {}),
    );
    const enc = encodeURIComponent(name);
    tasks.push(
      fetch(
        `https://itunes.apple.com/search?term=${enc}&entity=song&attribute=artistTerm&limit=12`,
      )
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json();
          const tracks = (data.results || [])
            .filter((r) => r.wrapperType === "track" || r.trackId)
            .filter((r) => nameMatchScore(r.artistName, name) >= 500)
            .map(trackFromItunes)
            .filter(Boolean);
          if (tracks.length) sources.push("itunes");
          raw.push(...tracks);
        })
        .catch(() => {}),
    );
  }

  if (source === "deezer" && id) {
    tasks.push(
      fetch(`https://api.deezer.com/artist/${encodeURIComponent(id)}/top?limit=8`)
        .then(async (res) => {
          if (!res.ok) return;
          const top = await res.json();
          sources.push("deezer");
          raw.push(...(top.data || []).map(trackFromDeezer).filter(Boolean));
        })
        .catch(() => {}),
    );
  }

  if (source === "itunes" && id) {
    tasks.push(
      fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&limit=12`)
        .then(async (res) => {
          if (!res.ok) return;
          const data = await res.json();
          sources.push("itunes");
          raw.push(
            ...(data.results || [])
              .filter((r) => r.wrapperType === "track" || r.trackId)
              .map(trackFromItunes)
              .filter(Boolean),
          );
        })
        .catch(() => {}),
    );
  }

  if (source === "spotify" && id) {
    tasks.push(
      getSpotifyAccess(keys)
        .then(async (access) => {
          if (!access?.token) return;
          const res = await fetch(
            `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}/top-tracks?market=FR`,
            { headers: { Authorization: `Bearer ${access.token}` } },
          );
          if (!res.ok) return;
          const data = await res.json();
          sources.push("spotify");
          raw.push(...(data.tracks || []).map(trackFromSpotify).filter(Boolean));
        })
        .catch(() => {}),
    );
  }

  await Promise.all(tasks);
  return {
    candidates: rankArtistTopTracks(raw, name),
    sources: [...new Set(sources)],
  };
}

/**
 * Recherche de titres (Deezer / iTunes / Spotify) pour seed style précis.
 */
export async function searchStyleTrackCandidates(keys, query) {
  const q = String(query || "").trim();
  if (q.length < 2) return { candidates: [], sources: [] };

  const enc = encodeURIComponent(q);
  const sources = [];
  const raw = [];

  try {
    const res = await fetch(`https://api.deezer.com/search?q=${enc}&limit=12`);
    if (res.ok) {
      const d = await res.json();
      sources.push("deezer");
      for (const t of d.data || []) {
        if (!t?.id) continue;
        raw.push({
          source: "deezer",
          id: String(t.id),
          name: t.title || t.title_short || "Sans titre",
          artistName: t.artist?.name || "",
          artistId: t.artist?.id != null ? String(t.artist.id) : undefined,
          album: t.album?.title || "",
          image: t.album?.cover_medium || t.album?.cover || null,
          previewUrl: t.preview || null,
          duration: t.duration || null,
          url: t.link || `https://www.deezer.com/track/${t.id}`,
          genres: [],
        });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${enc}&entity=song&limit=12`,
    );
    if (res.ok) {
      const d = await res.json();
      sources.push("itunes");
      for (const t of d.results || []) {
        if (!t?.trackId) continue;
        raw.push({
          source: "itunes",
          id: String(t.trackId),
          name: t.trackName || "Sans titre",
          artistName: t.artistName || "",
          artistId: t.artistId != null ? String(t.artistId) : undefined,
          album: t.collectionName || "",
          image: t.artworkUrl100 || t.artworkUrl60 || null,
          previewUrl: t.previewUrl || null,
          duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
          url: t.trackViewUrl || null,
          genres: t.primaryGenreName ? [t.primaryGenreName] : [],
        });
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const access = await getSpotifyAccess(keys);
    if (access?.token) {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${enc}&type=track&limit=10`,
        { headers: { Authorization: `Bearer ${access.token}` } },
      );
      if (res.ok) {
        const d = await res.json();
        sources.push("spotify");
        for (const t of d.tracks?.items || []) {
          if (!t?.id) continue;
          raw.push({
            source: "spotify",
            id: String(t.id),
            name: t.name || "Sans titre",
            artistName: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
            artistId: t.artists?.[0]?.id ? String(t.artists[0].id) : undefined,
            album: t.album?.name || "",
            image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || null,
            previewUrl: t.preview_url || null,
            duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
            url: t.external_urls?.spotify || null,
            genres: [],
          });
        }
      }
    }
  } catch {
    /* ignore */
  }

  // Dédup : privilégier Deezer/iTunes (preview fiable) sur Spotify
  const byNorm = new Map();
  const scoreSource = (s) => (s === "deezer" ? 3 : s === "itunes" ? 2 : 1);
  for (const c of raw) {
    const key = `${norm(c.name)}|${norm(c.artistName)}`;
    const prev = byNorm.get(key);
    if (!prev) {
      byNorm.set(key, c);
      continue;
    }
    const prevScore =
      scoreSource(prev.source) + (prev.previewUrl ? 2 : 0);
    const nextScore = scoreSource(c.source) + (c.previewUrl ? 2 : 0);
    if (nextScore > prevScore) byNorm.set(key, c);
  }

  const candidates = [...byNorm.values()].slice(0, 16);
  return { candidates, sources: [...new Set(sources)] };
}

async function hydrateStyleTrack(pick) {
  const source = String(pick?.source || "").trim();
  const id = String(pick?.id || "").trim();
  if (!source || !id) throw new Error("Titre de référence invalide");

  if (source === "deezer") {
    const res = await fetch(`https://api.deezer.com/track/${id}`);
    if (!res.ok) throw new Error("Titre Deezer introuvable");
    const t = await res.json();
    if (t?.error) throw new Error(t.error?.message || "Titre Deezer introuvable");
    return {
      source: "deezer",
      id: String(t.id),
      name: t.title || pick.name,
      artistName: t.artist?.name || pick.artistName || "",
      artistId: t.artist?.id != null ? String(t.artist.id) : pick.artistId,
      album: t.album?.title || "",
      image: t.album?.cover_medium || t.album?.cover || pick.image || null,
      previewUrl: t.preview || pick.previewUrl || null,
      url: t.link || pick.url,
      genres: [],
    };
  }

  if (source === "itunes") {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error("Titre iTunes introuvable");
    const d = await res.json();
    const t = (d.results || []).find((r) => String(r.trackId) === id) || d.results?.[0];
    if (!t) throw new Error("Titre iTunes introuvable");
    return {
      source: "itunes",
      id: String(t.trackId),
      name: t.trackName || pick.name,
      artistName: t.artistName || pick.artistName || "",
      artistId: t.artistId != null ? String(t.artistId) : pick.artistId,
      album: t.collectionName || "",
      image: t.artworkUrl100 || pick.image || null,
      previewUrl: t.previewUrl || pick.previewUrl || null,
      url: t.trackViewUrl || pick.url,
      genres: t.primaryGenreName ? [t.primaryGenreName] : [],
    };
  }

  if (source === "spotify") {
    // Prefer pick payload if already complete; else need token — caller should pass keys via loadStyleTrack
    return {
      source: "spotify",
      id,
      name: pick.name || "Sans titre",
      artistName: pick.artistName || "",
      artistId: pick.artistId,
      album: pick.album || "",
      image: pick.image || null,
      previewUrl: pick.previewUrl || null,
      url: pick.url,
      genres: [],
    };
  }

  throw new Error(`Source titre inconnue: ${source}`);
}

async function hydrateStyleTrackFull(keys, pick) {
  let track = await hydrateStyleTrack(pick);
  if (track.source === "spotify" && keys) {
    try {
      const access = await getSpotifyAccess(keys);
      if (access?.token) {
        const res = await fetch(`https://api.spotify.com/v1/tracks/${track.id}`, {
          headers: { Authorization: `Bearer ${access.token}` },
        });
        if (res.ok) {
          const t = await res.json();
          track = {
            source: "spotify",
            id: String(t.id),
            name: t.name || track.name,
            artistName: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
            artistId: t.artists?.[0]?.id ? String(t.artists[0].id) : track.artistId,
            album: t.album?.name || "",
            image: t.album?.images?.[1]?.url || t.album?.images?.[0]?.url || track.image,
            previewUrl: t.preview_url || track.previewUrl,
            url: t.external_urls?.spotify || track.url,
            genres: [],
          };
        }
      }
    } catch {
      /* keep pick data */
    }
  }

  // Si pas de preview Spotify, tenter Deezer/iTunes avec "titre artiste"
  if (!track.previewUrl && track.name && track.artistName) {
    const q = `${track.name} ${track.artistName}`;
    try {
      const { candidates } = await searchStyleTrackCandidates(keys, q);
      const withPreview = candidates.find(
        (c) =>
          c.previewUrl &&
          (norm(c.name) === norm(track.name) ||
            norm(c.artistName) === norm(track.artistName)),
      );
      if (withPreview?.previewUrl) {
        track = {
          ...track,
          previewUrl: withPreview.previewUrl,
          image: track.image || withPreview.image,
        };
      }
    } catch {
      /* ignore */
    }
  }

  return track;
}

/**
 * Style lock calé sur UN morceau précis (preview DNA + lane sonore du titre).
 */
export async function resolveStyleTrackReference(keys, pick) {
  const track = await hydrateStyleTrackFull(keys, pick);
  if (!track?.name) throw new Error("Titre de référence introuvable");

  let audioDna = null;
  if (keys?.geminiApiKey?.trim() && track.previewUrl) {
    audioDna = await listenArtistPreviewDna(keys.geminiApiKey, {
      previewUrl: track.previewUrl,
      artistName: track.artistName || track.name,
      topTracks: [track.name],
    });
  }

  const catalog = {
    name: track.artistName || track.name,
    source: track.source,
    id: track.artistId || track.id,
    matchScore: 1000,
    genres: track.genres || [],
    inferredGenres: [],
    topTracks: [track.name],
    albums: track.album ? [track.album] : [],
    related: [],
    previewUrls: track.previewUrl ? [track.previewUrl] : [],
    url: track.url,
    image: track.image,
    followers: null,
    popularity: null,
  };

  const queryLabel = `${track.name} — ${track.artistName || "?"}`.trim();
  const lock = await enrichStyleLock(keys, catalog, queryLabel, audioDna);

  let genres = lock.genres.length
    ? lock.genres
    : (catalog.genres || []).slice(0, 4);
  if (!genres.length) genres = ["Pop"];
  const genreSummary = lock.genreSummary || genres.join(" × ");
  const bpm = lock.bpm || audioDna?.bpmEstimate || null;

  const seedTrack = {
    title: track.name,
    artistName: track.artistName || "",
    source: track.source,
    sourceId: track.id,
    previewUrl: track.previewUrl || null,
    album: track.album || "",
    url: track.url || null,
    image: track.image || null,
  };

  return withKnownArtistLane({
    query: queryLabel,
    matchedName: catalog.name,
    source: track.source,
    sourceId: track.id,
    confidence: "confirmed",
    url: track.url,
    image: track.image,
    topTracks: [track.name],
    albums: catalog.albums,
    related: [],
    genres,
    genreSummary,
    mood: lock.mood || "énergique",
    energy: lock.energy,
    tempoFeel: lock.tempoFeel,
    bpm,
    production: lock.production,
    vocalStyle: lock.vocalStyle,
    vocalRegister: lock.vocalRegister,
    timbre: lock.timbre,
    rhythmFeel: lock.rhythmFeel,
    instruments: lock.instruments,
    sonicKeywords: lock.sonicKeywords,
    writingStyle: lock.writingStyle,
    visualVibe: lock.visualVibe,
    doNot: lock.doNot,
    influences: [catalog.name, track.name].filter(Boolean),
    audioListened: Boolean(lock.audioListened || audioDna),
    seedTrack,
    previewUrl: track.previewUrl || null,
    musicPrompt: [
      genreSummary,
      lock.production,
      ...(lock.sonicKeywords || []),
      lock.timbre ? `timbre: ${lock.timbre}` : "",
      lock.vocalStyle ? `vocals: ${lock.vocalStyle}` : "",
      lock.vocalRegister ? `register: ${lock.vocalRegister}` : "",
      lock.rhythmFeel ? `groove: ${lock.rhythmFeel}` : "",
      lock.tempoFeel ? `tempo: ${lock.tempoFeel}` : "",
      bpm ? `~${bpm} BPM` : "",
      ...(lock.instruments || []).slice(0, 4).map((i) => `instrument: ${i}`),
      `energy ${lock.energy}`,
      `exactly in the sonic lane of "${track.name}" by ${catalog.name}`,
      "original composition inspired by that track's sound, not a cover or remix",
    ]
      .filter(Boolean)
      .join(", "),
  });
}

export { hydrateStyleTrackFull };
