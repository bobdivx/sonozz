import { getDb, ensureSchema } from "./db.js";

/**
 * Métriques produit owner (Turso). Stripe / MRR / churn : à brancher.
 */
export async function getAdminStats() {
  await ensureSchema();
  const db = getDb();

  const count = async (sql, args = []) => {
    const res = await db.execute({ sql, args });
    return Number(res.rows[0]?.c || 0);
  };

  const [users, artists, tracks, albumTracks, events] = await Promise.all([
    count(`SELECT COUNT(*) AS c FROM users`),
    count(
      `SELECT COUNT(DISTINCT artist_name) AS c FROM projects
       WHERE artist_name IS NOT NULL AND TRIM(artist_name) != ''`,
    ),
    count(`SELECT COUNT(*) AS c FROM projects`),
    count(`SELECT COUNT(*) AS c FROM album_tracks`),
    count(`SELECT COUNT(*) AS c FROM project_events`),
  ]);

  const recentRes = await db.execute({
    sql: `SELECT email, created_at FROM users ORDER BY created_at DESC LIMIT 10`,
  });
  const recentUsers = recentRes.rows.map((row) => ({
    email: String(row.email || "").toLowerCase(),
    createdAt: row.created_at || null,
  }));

  return {
    users,
    artists,
    tracks,
    albumTracks,
    events,
    generations: events,
    recentUsers,
    mrr: null,
    churn: null,
    stripeNote: "à brancher",
  };
}
