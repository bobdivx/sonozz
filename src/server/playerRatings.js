/**
 * Système de notes anonymes pour le lecteur public /play
 * Utilise un player_id stocké dans localStorage côté client
 */
import { ensureSchema, getDb, uid } from "./db.js";

async function ensureRatingsSchema() {
  await ensureSchema();
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS player_ratings (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(player_id, track_id)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_player_ratings_track ON player_ratings(track_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_player_ratings_player ON player_ratings(player_id)
  `);
}

/**
 * Enregistrer ou mettre à jour une note
 */
export async function savePlayerRating({ playerId, trackId, rating }) {
  if (!playerId || !trackId) {
    throw new Error("player_id et track_id requis");
  }
  const score = Number(rating);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("La note doit être un entier entre 1 et 5");
  }

  await ensureRatingsSchema();
  const db = getDb();
  const now = new Date().toISOString();

  // Vérifier si une note existe déjà
  const existing = await db.execute({
    sql: `SELECT id, rating FROM player_ratings WHERE player_id = ? AND track_id = ? LIMIT 1`,
    args: [playerId, trackId],
  });

  if (existing.rows[0]) {
    // Mise à jour
    await db.execute({
      sql: `UPDATE player_ratings SET rating = ?, updated_at = ? WHERE id = ?`,
      args: [score, now, existing.rows[0].id],
    });
    return {
      id: existing.rows[0].id,
      playerId,
      trackId,
      rating: score,
      updatedAt: now,
      isNew: false,
    };
  } else {
    // Création
    const id = uid("rate");
    await db.execute({
      sql: `
        INSERT INTO player_ratings (id, player_id, track_id, rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      args: [id, playerId, trackId, score, now, now],
    });
    return {
      id,
      playerId,
      trackId,
      rating: score,
      createdAt: now,
      updatedAt: now,
      isNew: true,
    };
  }
}

/**
 * Récupérer la note d'un utilisateur pour un morceau
 */
export async function getPlayerRating({ playerId, trackId }) {
  if (!playerId || !trackId) return null;

  await ensureRatingsSchema();
  const db = getDb();

  const res = await db.execute({
    sql: `SELECT rating, created_at, updated_at FROM player_ratings WHERE player_id = ? AND track_id = ? LIMIT 1`,
    args: [playerId, trackId],
  });

  if (!res.rows[0]) return null;

  return {
    rating: Number(res.rows[0].rating),
    createdAt: res.rows[0].created_at,
    updatedAt: res.rows[0].updated_at,
  };
}

/**
 * Récupérer les statistiques agrégées pour un morceau
 */
export async function getTrackRatingStats(trackId) {
  if (!trackId) return null;

  await ensureRatingsSchema();
  const db = getDb();

  const res = await db.execute({
    sql: `
      SELECT 
        COUNT(*) as count,
        AVG(rating) as average,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as count_5,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as count_4,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as count_3,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as count_2,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as count_1
      FROM player_ratings
      WHERE track_id = ?
    `,
    args: [trackId],
  });

  const row = res.rows[0];
  if (!row || Number(row.count) === 0) {
    return {
      count: 0,
      average: 0,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  return {
    count: Number(row.count),
    average: Number(row.average) || 0,
    distribution: {
      1: Number(row.count_1) || 0,
      2: Number(row.count_2) || 0,
      3: Number(row.count_3) || 0,
      4: Number(row.count_4) || 0,
      5: Number(row.count_5) || 0,
    },
  };
}

/**
 * Récupérer les notes d'un utilisateur pour plusieurs morceaux
 */
export async function getPlayerRatings({ playerId, trackIds = [] }) {
  if (!playerId || !trackIds.length) return {};

  await ensureRatingsSchema();
  const db = getDb();

  const placeholders = trackIds.map(() => "?").join(",");
  const res = await db.execute({
    sql: `SELECT track_id, rating FROM player_ratings WHERE player_id = ? AND track_id IN (${placeholders})`,
    args: [playerId, ...trackIds],
  });

  const ratings = {};
  for (const row of res.rows) {
    ratings[row.track_id] = Number(row.rating);
  }
  return ratings;
}
