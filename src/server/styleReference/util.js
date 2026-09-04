import { normalizeCatalogCountry } from "../../lib/studio.js";

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

function uniqGenres(list = []) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : [list]) {
    const g = String(raw || "").trim();
    if (!g) continue;
    const key = norm(g);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(g);
  }
  return out;
}

const ARTIST_SOURCE_RANK = { spotify: 4, itunes: 3, deezer: 2, musicbrainz: 1 };

/**
 * Déduplique par nom : garde la meilleure source, mais fusionne les genres
 * (Deezer gagne souvent au score fans tout en ayant genres vides).
 */
export function mergeArtistCandidatesByName(list = []) {
  const byName = new Map();
  for (const c of list) {
    const key = norm(c?.name);
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, { ...c, genres: uniqGenres(c.genres) });
      continue;
    }
    const betterScore = c.matchScore > prev.matchScore + 5;
    const betterSource =
      Math.abs(c.matchScore - prev.matchScore) <= 5 &&
      (ARTIST_SOURCE_RANK[c.source] || 0) > (ARTIST_SOURCE_RANK[prev.source] || 0);
    const winner = betterScore || betterSource ? c : prev;
    const other = winner === c ? prev : c;
    byName.set(key, {
      ...winner,
      genres: uniqGenres([...(winner.genres || []), ...(other.genres || [])]),
      followers: winner.followers ?? other.followers ?? null,
      image: winner.image || other.image || null,
      url: winner.url || other.url || null,
      country:
        normalizeCatalogCountry(winner.country) ||
        normalizeCatalogCountry(other.country) ||
        winner.country ||
        other.country ||
        null,
      language: winner.language || other.language || null,
      gender: winner.gender || other.gender || null,
    });
  }
  return [...byName.values()];
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

function uniqStrings(items = [], max = 12) {
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const key = norm(v);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function httpPreviewUrl(raw) {
  const u = String(raw || "").trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

export {
  norm,
  titleCaseGenre,
  uniqGenres,
  uniqStrings,
  ARTIST_SOURCE_RANK,
  nameMatchScore,
  httpPreviewUrl,
};
