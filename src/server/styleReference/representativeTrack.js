/**
 * Choix AUTOMATIQUE d'un titre de référence de style représentatif (Deezer) pour un artiste réel.
 *
 * Leçon Skarlvind (oct. 2026) : un single rock atypique comme référence tire la prod vers le metal ;
 * un titre d'ALBUM typique (Mantra) donne le bon lit batterie / sub. Heuristique :
 *  1. artiste Deezer (id direct ou recherche par nom) ;
 *  2. candidats = titres des albums (record_type « album », pas les singles/EP), hors titres
 *     également sortis en single, intro/outro/remix/live/acoustique/instrumental ;
 *  3. si l'analyse audio est dispo (ffmpeg), on mesure le style de chaque aperçu (rapide, sans
 *     séparation) et on prend le titre le plus proche de la MÉDIANE des candidats ;
 *     sinon : titres d'album les plus écoutés (rank Deezer).
 * Le lien d'aperçu n'est PAS stocké (il expire) : seul l'id de piste l'est, et l'aperçu est
 * redemandé à chaque génération (artistStyleRef.js). Mode « reference », force 1.0, jamais cover.
 */

const API = "https://api.deezer.com";
const ATYPICAL_TITLE =
  /\b(intro|outro|interlude|skit|remix|rmx|live|acoustic|acoustique|unplugged|instrumental|karaoke|edit|version|demo|reprise|sped up|slowed|mix)\b/i;

const normTitle = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

async function getJson(fetchImpl, url) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = await res.json();
    return j && !j.error ? j : null;
  } catch {
    return null;
  }
}

export async function resolveDeezerArtistId({ name, deezerArtistId, fetchImpl = fetch } = {}) {
  if (deezerArtistId) return String(deezerArtistId).replace(/\D+/g, "") || null;
  const q = String(name || "").trim();
  if (!q) return null;
  const j = await getJson(fetchImpl, `${API}/search/artist?q=${encodeURIComponent(q)}&limit=8`);
  const list = Array.isArray(j?.data) ? j.data : [];
  const target = normTitle(q);
  const exact = list.filter((a) => normTitle(a.name) === target);
  const pool = exact.length ? exact : list;
  pool.sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0));
  return pool[0]?.id ? String(pool[0].id) : null;
}

/**
 * Candidats titres d'album (sans audio).
 * @returns {Promise<{ artistId: string|null, artistName: string|null, candidates: Array<object>, genres: string[] }>}
 */
export async function listAlbumTrackCandidates({ name, deezerArtistId, fetchImpl = fetch, maxAlbums = 3, perAlbum = 4, max = 8 } = {}) {
  const artistId = await resolveDeezerArtistId({ name, deezerArtistId, fetchImpl });
  if (!artistId) return { artistId: null, artistName: null, candidates: [], genres: [] };
  const [artist, albumsJ, topJ] = await Promise.all([
    getJson(fetchImpl, `${API}/artist/${artistId}`),
    getJson(fetchImpl, `${API}/artist/${artistId}/albums?limit=60`),
    getJson(fetchImpl, `${API}/artist/${artistId}/top?limit=25`),
  ]);
  const records = Array.isArray(albumsJ?.data) ? albumsJ.data : [];
  const singleTitles = new Set(
    records.filter((r) => r.record_type && r.record_type !== "album").map((r) => normTitle(r.title)),
  );
  const topIds = new Set((Array.isArray(topJ?.data) ? topJ.data : []).map((t) => String(t.id)));
  let albums = records.filter((r) => r.record_type === "album" && !ATYPICAL_TITLE.test(r.title || ""));
  // EP en dernier recours (artistes sans album)
  if (!albums.length) albums = records.filter((r) => r.record_type === "ep");
  albums = albums
    .slice()
    .sort((a, b) => (b.fans || 0) - (a.fans || 0) || String(b.release_date).localeCompare(String(a.release_date)))
    .slice(0, maxAlbums);
  const details = await Promise.all(albums.map((a) => getJson(fetchImpl, `${API}/album/${a.id}`)));
  const genres = [];
  const candidates = [];
  details.forEach((d, ai) => {
    if (!d) return;
    for (const g of d.genres?.data || []) if (g?.name && !genres.includes(g.name)) genres.push(g.name);
    const tracks = (d.tracks?.data || [])
      .filter((t) => t?.id && t.readable !== false)
      .filter((t) => !ATYPICAL_TITLE.test(t.title || ""))
      .filter((t) => !t.duration || (t.duration >= 90 && t.duration <= 420))
      .filter((t) => String(t.artist?.id || artistId) === String(artistId));
    const nonSingles = tracks.filter((t) => !singleTitles.has(normTitle(t.title)));
    const pool = (nonSingles.length >= 2 ? nonSingles : tracks)
      .slice()
      .sort((a, b) => (b.rank || 0) - (a.rank || 0))
      .slice(0, perAlbum);
    for (const t of pool) {
      candidates.push({
        deezerTrackId: String(t.id),
        title: t.title,
        album: d.title,
        albumId: String(d.id),
        albumGenres: (d.genres?.data || []).map((g) => g.name),
        rank: t.rank || 0,
        duration: t.duration || null,
        inTop: topIds.has(String(t.id)),
        alsoSingle: singleTitles.has(normTitle(t.title)),
        albumOrder: ai,
      });
    }
  });
  return {
    artistId,
    artistName: artist?.name || name || null,
    candidates: candidates.slice(0, max),
    genres,
  };
}

const FEATURE_KEYS = ["drumShare", "subShare", "melodicShare", "kickPerSec", "hatPerSec", "brightnessHz", "distortion"];
const LOG_KEYS = new Set(["subShare", "brightnessHz", "distortion"]);

/** Indice du candidat le plus proche de la médiane (z-scores robustes). */
export function closestToMedian(featureRows) {
  const rows = featureRows.map((f) =>
    f ? FEATURE_KEYS.map((k) => (LOG_KEYS.has(k) ? Math.log(Math.max(1e-6, Number(f[k]) || 0)) : Number(f[k]) || 0)) : null,
  );
  const ok = rows.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  if (!ok.length) return -1;
  if (ok.length < 3) return ok[0];
  const med = FEATURE_KEYS.map((_, j) => {
    const v = ok.map((i) => rows[i][j]).sort((a, b) => a - b);
    return v[v.length >> 1];
  });
  const mad = FEATURE_KEYS.map((_, j) => {
    const v = ok.map((i) => Math.abs(rows[i][j] - med[j])).sort((a, b) => a - b);
    return Math.max(1e-6, v[v.length >> 1] * 1.4826);
  });
  let best = -1, bestD = Infinity;
  for (const i of ok) {
    const d = rows[i].reduce((s, x, j) => s + Math.min(9, ((x - med[j]) / mad[j]) ** 2), 0);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Choisit le titre de référence. `analyzeStyle(url)` (optionnel) renvoie les mesures de style
 * d'un aperçu ; sans lui → titre d'album le plus écouté (non sorti en single si possible).
 */
export async function pickRepresentativeTrack({ name, deezerArtistId, fetchImpl = fetch, analyzeStyle = null } = {}) {
  const { artistId, artistName, candidates, genres } = await listAlbumTrackCandidates({ name, deezerArtistId, fetchImpl });
  if (!candidates.length) return null;
  let chosen = null;
  let method = "rank";
  let measured = [];
  if (typeof analyzeStyle === "function") {
    const feats = [];
    for (const c of candidates) {
      const t = await getJson(fetchImpl, `${API}/track/${c.deezerTrackId}`);
      const url = String(t?.preview || "");
      let f = null;
      if (/^https:\/\//.test(url)) {
        try {
          f = await analyzeStyle(url);
        } catch {
          f = null;
        }
      }
      feats.push(f);
    }
    const i = closestToMedian(feats);
    if (i >= 0) {
      chosen = candidates[i];
      method = "median-audio";
      measured = candidates.map((c, j) => ({ title: c.title, style: feats[j] || null }));
    }
  }
  if (!chosen) {
    const pool = candidates.filter((c) => !c.alsoSingle);
    chosen = (pool.length ? pool : candidates).slice().sort((a, b) => b.rank - a.rank)[0];
  }
  return {
    source: "deezer",
    deezerTrackId: chosen.deezerTrackId,
    deezerArtistId: artistId,
    title: `${chosen.title} — ${artistName || name || ""}`.replace(/ — $/, ""),
    album: chosen.album,
    mode: "reference",
    strength: 1,
    auto: true,
    method,
    albumGenres: genres,
    candidates: candidates.map((c) => c.title).slice(0, 8),
    measured: measured.length ? measured : undefined,
  };
}
