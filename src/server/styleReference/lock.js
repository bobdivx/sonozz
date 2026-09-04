import { getSpotifyAccess, spotifySearchContext } from "../spotify.js";
import { llmJson, requireTextLlm } from "../llm.js";
import { listenArtistPreviewDna } from "../musicListen.js";
import { withKnownArtistLane } from "../../lib/musicLane.js";
import { norm, nameMatchScore, uniqStrings, titleCaseGenre } from "./util.js";
import {
  searchSpotifyArtist,
  searchDeezerArtist,
  searchItunesArtist,
  hydrateSpotifyCatalog,
} from "./providers.js";
import { loadStyleArtistCatalog } from "./availability.js";

export async function enrichStyleLock(keys, catalog, query, audioDna = null) {
  requireTextLlm(keys);
  const knownGenres = [
    ...(catalog.genres || []),
    ...(catalog.inferredGenres || []),
    ...(catalog.relatedGenres || []),
  ].filter(Boolean);
  const uniqueGenres = [...new Set(knownGenres.map((g) => g.toLowerCase()))].map(titleCaseGenre);

  const audioBlock = audioDna
    ? `
ÉCOUTE RÉELLE d'un extrait preview (~30s) de cet artiste (priorité absolue sur les genres catalogue) :
${JSON.stringify(audioDna, null, 2)}
Base-toi d'abord sur cette écoute pour : BPM, énergie, timbre vocal, groove/rythme, instruments, densité de prod.
`
    : `
Pas d'extrait audio dispo — déduis le DNA sonore depuis titres phares, related et ta connaissance précise de l'artiste (évite le vague).
`;

  const data = await llmJson(
    keys,
    `Tu es un A&R / producteur. L'utilisateur veut cloner le STYLE musical exact d'un artiste réel — pas seulement le genre.

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

Genres déjà connus: ${uniqueGenres.join(", ") || "(aucun)"}
ATTENTION catalogues: iTunes/Apple classent souvent un sous-genre (metal, rap, électronique…) sous une ombrelle « Rock » ou « Pop ». genres DOIT reprendre le sous-genre réel de CET artiste — jamais l’ombrelle si un tag plus précis existe.
Si le titre SEED est atypique (ballade, acoustique, remix), décris CET arrangement dans production / rhythmFeel / bpmEstimate, mais genreSummary et genres restent la lane principale de l’artiste, pas un résumé du seul titre atypique.
"doNot" = dérives à éviter par rapport à CETTE lane (ex. vocoder si la voix du DNA est organique).
${audioBlock}

Retourne un LOCK STYLE strict pour un artiste FICTIONNEL dans EXACTEMENT la même lane sonore (groove, timbre, écriture, prod).

JSON strict:
{
  "resolvedName": string,
  "genres": [string, string, string],
  "genreSummary": string,
  "mood": string,
  "energy": "low" | "mid" | "high",
  "tempoFeel": string,
  "bpmEstimate": number,
  "production": string,
  "vocalStyle": string,
  "vocalRegister": string,
  "timbre": string,
  "rhythmFeel": string,
  "instruments": [string, string, string],
  "sonicKeywords": [string, string, string, string, string],
  "similarArtists": [string, string, string],
  "writingStyle": string,
  "visualVibe": string,
  "doNot": [string, string, string]
}
"timbre" = couleur de voix / texture (ex. "breathy tenor", "raspy baritone", "bright mezzo").
"rhythmFeel" = groove (ex. "syncopated 16ths", "four-on-floor", "swung boom-bap", "halftime trap").
"bpmEstimate" = entier 60–200 crédible pour cet artiste.
"vocalRegister" = ex. "tenor", "baritone", "alto", "soprano", "spoken-sung".
"instruments" = 3–6 éléments de prod typiques.
"doNot" = styles INTERDITS pour éviter les dérives.
Pas de vague "pop" générique si l'artiste est funk-rock / drill / neo-soul / etc.`,
  );

  const bpmNum = Number(data.bpmEstimate ?? audioDna?.bpmEstimate);
  const bpm =
    Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : null;

  return {
    resolvedName: data.resolvedName || catalog.name || query,
    genres: (Array.isArray(data.genres) ? data.genres : [])
      .map((g) => String(g || "").trim())
      .filter(Boolean)
      .slice(0, 4),
    genreSummary: String(data.genreSummary || "").trim(),
    mood: String(data.mood || audioDna?.mood || "").trim(),
    energy: ["low", "mid", "high"].includes(data.energy)
      ? data.energy
      : ["low", "mid", "high"].includes(audioDna?.energy)
        ? audioDna.energy
        : "mid",
    tempoFeel: String(data.tempoFeel || audioDna?.rhythmFeel || "").trim(),
    bpm,
    production: String(data.production || "").trim(),
    vocalStyle: String(data.vocalStyle || audioDna?.vocalStyle || "").trim(),
    vocalRegister: String(data.vocalRegister || audioDna?.vocalRegister || "").trim(),
    timbre: String(data.timbre || audioDna?.timbre || "").trim(),
    rhythmFeel: String(data.rhythmFeel || audioDna?.rhythmFeel || "").trim(),
    instruments: (
      Array.isArray(data.instruments)
        ? data.instruments
        : Array.isArray(audioDna?.instruments)
          ? audioDna.instruments
          : []
    )
      .map((k) => String(k || "").trim())
      .filter(Boolean)
      .slice(0, 8),
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
    audioListened: Boolean(audioDna),
  };
}

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

  let audioDna = null;
  let previewUrls = Array.isArray(catalog.previewUrls) ? catalog.previewUrls.filter(Boolean) : [];
  // Spotify renvoie souvent preview_url=null — Deezer/iTunes sont plus fiables pour ~30s
  if (!previewUrls.length && catalog.name) {
    try {
      const deezerHit = await searchDeezerArtist(catalog.name);
      if (deezerHit?.previewUrls?.length) {
        previewUrls = deezerHit.previewUrls;
      }
    } catch {
      /* ignore */
    }
  }
  if (!previewUrls.length && catalog.name) {
    try {
      const itunesHit = await searchItunesArtist(catalog.name);
      if (itunesHit?.previewUrls?.length) {
        previewUrls = itunesHit.previewUrls;
      }
    } catch {
      /* ignore */
    }
  }
  if (keys?.geminiApiKey?.trim() && previewUrls.length) {
    for (const previewUrl of previewUrls.slice(0, 2)) {
      audioDna = await listenArtistPreviewDna(keys.geminiApiKey, {
        previewUrl,
        artistName: catalog.name,
        topTracks: catalog.topTracks,
      });
      if (audioDna) break;
    }
  }

  const lock = await enrichStyleLock(keys, catalog, catalog.name || query, audioDna);

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

  const bpm = lock.bpm || audioDna?.bpmEstimate || null;

  return withKnownArtistLane({
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
    influences,
    audioListened: Boolean(lock.audioListened || audioDna),
    previewUrl: previewUrls[0] || null,
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
      `exactly in the style of ${catalog.name}`,
      "original artist, not a cover, not an imitation of identity",
    ]
      .filter(Boolean)
      .join(", "),
  });
}

export function mergeStyleLocks(locks = []) {
  const list = (Array.isArray(locks) ? locks : []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return { ...list[0], refs: [list[0]] };

  const names = uniqStrings(list.map((l) => l.matchedName), 6);
  const genres = uniqStrings(list.flatMap((l) => l.genres || []), 6);
  const genreSummary = genres.join(" × ") || list[0].genreSummary;
  const sonicKeywords = uniqStrings(list.flatMap((l) => l.sonicKeywords || []), 14);
  const instruments = uniqStrings(list.flatMap((l) => l.instruments || []), 10);
  const influences = uniqStrings(
    [...names, ...list.flatMap((l) => l.influences || [])],
    8,
  );
  const doNot = uniqStrings(list.flatMap((l) => l.doNot || []), 10);
  const production = uniqStrings(
    list.map((l) => l.production).filter(Boolean),
    4,
  ).join(" · ");
  const writingStyle = uniqStrings(
    list.map((l) => l.writingStyle).filter(Boolean),
    3,
  ).join(" · ");
  const vocalStyle = uniqStrings(
    list.map((l) => l.vocalStyle).filter(Boolean),
    3,
  ).join(" · ");
  const timbre = uniqStrings(
    list.map((l) => l.timbre).filter(Boolean),
    3,
  ).join(" · ");
  const rhythmFeel = uniqStrings(
    list.map((l) => l.rhythmFeel).filter(Boolean),
    3,
  ).join(" · ");
  const tempoFeel = uniqStrings(
    list.map((l) => l.tempoFeel || l.rhythmFeel).filter(Boolean),
    3,
  ).join(" · ");
  const vocalRegister = list.find((l) => l.vocalRegister)?.vocalRegister || "";
  const visualVibe = uniqStrings(
    list.map((l) => l.visualVibe).filter(Boolean),
    3,
  ).join(" · ");
  const moods = uniqStrings(list.map((l) => l.mood).filter(Boolean), 3);

  const energyRank = { low: 0, mid: 1, high: 2 };
  const energyVals = list
    .map((l) => energyRank[l.energy])
    .filter((n) => Number.isFinite(n));
  const energy =
    energyVals.length > 0
      ? (["low", "mid", "high"][
          Math.round(energyVals.reduce((a, b) => a + b, 0) / energyVals.length)
        ] || list[0].energy)
      : list[0].energy;

  const bpms = list
    .map((l) => Number(l.bpm))
    .filter((n) => Number.isFinite(n) && n >= 60 && n <= 200);
  const bpm = bpms.length
    ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)
    : null;

  return {
    query: names.join(" + "),
    matchedName: names.join(" × "),
    source: "multi",
    sourceId: list.map((l) => `${l.source}:${l.sourceId}`).join("|"),
    confidence: "confirmed",
    url: list[0].url || null,
    image: list[0].image || null,
    topTracks: uniqStrings(list.flatMap((l) => l.topTracks || []), 8),
    albums: uniqStrings(list.flatMap((l) => l.albums || []), 6),
    related: uniqStrings(list.flatMap((l) => l.related || []), 8),
    genres,
    genreSummary,
    mood: moods[0] || list[0].mood,
    energy,
    tempoFeel: tempoFeel || list[0].tempoFeel,
    bpm,
    production,
    vocalStyle,
    vocalRegister,
    timbre,
    rhythmFeel,
    instruments,
    sonicKeywords,
    writingStyle,
    visualVibe,
    doNot,
    influences,
    audioListened: list.some((l) => l.audioListened),
    previewUrl: list.find((l) => l.previewUrl)?.previewUrl || list[0].previewUrl || null,
    seedTrack: list.find((l) => l.seedTrack?.previewUrl)?.seedTrack || list.find((l) => l.seedTrack)?.seedTrack,
    musicPrompt: [
      genreSummary,
      production,
      ...sonicKeywords,
      timbre ? `timbre: ${timbre}` : "",
      vocalStyle ? `vocals: ${vocalStyle}` : "",
      rhythmFeel ? `groove: ${rhythmFeel}` : "",
      bpm ? `~${bpm} BPM` : "",
      ...instruments.slice(0, 4).map((i) => `instrument: ${i}`),
      `blend of: ${names.join(", ")}`,
      "original artist identity, not a cover",
    ]
      .filter(Boolean)
      .join(", "),
    refs: list,
  };
}

/**
 * Résout 1..N artistes de référence (favoris) et fusionne le lock style.
 */
export async function resolveStyleReferences(keys, picks = []) {
  const list = (Array.isArray(picks) ? picks : [])
    .filter((p) => p?.source && p?.id)
    .slice(0, 5);
  if (!list.length) return null;

  const locks = [];
  const errors = [];
  for (const pick of list) {
    try {
      locks.push(await resolveStyleReference(keys, pick));
    } catch (e) {
      errors.push(`${pick.name || pick.id}: ${e.message || "KO"}`);
    }
  }
  if (!locks.length) {
    throw new Error(
      `Aucun artiste favori résolu. ${errors.slice(0, 2).join(" · ")}`,
    );
  }
  const merged = mergeStyleLocks(locks);
  if (errors.length) merged.resolveWarnings = errors;
  return merged;
}
