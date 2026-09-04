import { getDb } from "../db.js";
import { runCareerAgent } from "../careerAgent.js";
import { getArtistBySlug } from "./crud.js";
import { listArtistReleases } from "./releases.js";
import { computeArtistStats } from "./stats.js";

/**
 * Agent carrière (Analytics → prochain single). Persiste dans stats.career.
 */
export async function adviseArtistCareer(slug, { keys, force = false } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const prevCareer = artist.stats?.career;
  const cachedAt = prevCareer?.updatedAt ? Date.parse(prevCareer.updatedAt) : 0;
  if (!force && cachedAt && Date.now() - cachedAt < 6 * 60 * 60 * 1000) {
    return { career: prevCareer, cached: true };
  }

  const releases = await listArtistReleases(slug, 40);
  // Utilise stats déjà sync (ONCE) si présentes — pas de re-fetch obligatoire
  let stats = artist.stats || {};
  if (!stats.updatedAt) {
    stats = await computeArtistStats(slug, {
      onceToken: keys?.onceApiToken?.trim() || "",
      keys,
    });
  }

  const career = await runCareerAgent({ keys, artist, releases, stats });
  const nextStats = {
    ...stats,
    career,
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET stats_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(nextStats), nextStats.updatedAt, slug],
  });

  return { career, cached: false, stats: nextStats };
}
