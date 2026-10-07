/**
 * Historique d’écriture d’un artiste (Turso) : titres / thèmes / hooks récents
 * pour l’anti-répétition des paroles.
 */
import { getDb } from "../db.js";
import { getArtistBySlug } from "../artists.js";
import { extractHookLine } from "../../lib/songwriting/brief.js";

/**
 * @returns {Promise<{ title: string, theme: string, hook: string, category?: string, pov?: string, tone?: string, projectId: string }[]>}
 */
export async function loadArtistSongHistory({ slug, name, limit = 10, excludeProjectId = null } = {}) {
  const s = String(slug || "").trim();
  const n = String(name || "").trim();
  if (!s && !n) return [];
  try {
    const db = getDb();
    const res = await db.execute({
      sql: `
        SELECT
          id,
          json_extract(project_json, '$.lyrics.title') AS title,
          json_extract(project_json, '$.lyrics.theme') AS theme,
          json_extract(project_json, '$.lyrics.hook') AS hook,
          json_extract(project_json, '$.lyrics.newsRef') AS news_ref,
          json_extract(project_json, '$.lyrics.brief.category') AS category,
          json_extract(project_json, '$.lyrics.brief.pov') AS pov,
          json_extract(project_json, '$.lyrics.brief.tone') AS tone,
          substr(json_extract(project_json, '$.lyrics.text'), 1, 1800) AS text
        FROM projects
        WHERE (artist_slug = ? OR artist_name = ?)
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      // Pas de json_extract dans le WHERE (project_json peut être lourd) : on filtre en JS.
      args: [s || n, n || s, Math.max(1, Math.min(30, Number(limit) || 10)) * 2 + 1],
    });
    const seen = new Set();
    const out = [];
    for (const row of res.rows) {
      if (excludeProjectId && row.id === excludeProjectId) continue;
      if (!row.text && !row.title) continue;
      const title = String(row.title || "").trim();
      const key = title.toLowerCase();
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push({
        projectId: row.id,
        title,
        theme: String(row.theme || "").trim(),
        hook: String(row.hook || "").trim() || extractHookLine(row.text),
        newsRef: row.news_ref ? String(row.news_ref).slice(0, 160) : undefined,
        category: row.category ? String(row.category) : undefined,
        pov: row.pov ? String(row.pov) : undefined,
        tone: row.tone ? String(row.tone) : undefined,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn("[songwriting] history:", e.message);
    return [];
  }
}

/** Réglages d’écriture à jour depuis le hub artiste (le projet peut être ancien). */
export async function loadArtistWritingSettings(slug) {
  const s = String(slug || "").trim();
  if (!s) return {};
  try {
    const row = await getArtistBySlug(s);
    const p = row?.profile || {};
    const out = {};
    for (const k of ["newsMode", "writingVoice", "favoriteTopics", "avoidTopics"]) {
      if (p[k] != null && p[k] !== "") out[k] = p[k];
    }
    return out;
  } catch (e) {
    console.warn("[songwriting] settings:", e.message);
    return {};
  }
}
