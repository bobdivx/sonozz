/**
 * Système de notes studio (like/dislike) pour le panneau Revue
 * Unifié avec le système player_ratings de /play
 */
import { ensureSchema, getDb, uid } from "./db.js";

async function ensureStudioRatingsSchema() {
  await ensureSchema();
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS studio_ratings (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL UNIQUE,
      rating TEXT NOT NULL CHECK(rating IN ('like', 'dislike', 'neutral')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_studio_ratings_track ON studio_ratings(track_id)
  `);
}

/**
 * Enregistrer ou mettre à jour une note studio
 */
export async function saveStudioRating({ trackId, rating }) {
  if (!trackId) {
    throw new Error("track_id requis");
  }
  if (!['like', 'dislike', 'neutral'].includes(rating)) {
    throw new Error("La note doit être 'like', 'dislike' ou 'neutral'");
  }

  await ensureStudioRatingsSchema();
  const db = getDb();
  const now = new Date().toISOString();

  // Vérifier si une note existe déjà
  const existing = await db.execute({
    sql: `SELECT id FROM studio_ratings WHERE track_id = ? LIMIT 1`,
    args: [trackId],
  });

  if (existing.rows[0]) {
    // Mise à jour
    await db.execute({
      sql: `UPDATE studio_ratings SET rating = ?, updated_at = ? WHERE id = ?`,
      args: [rating, now, existing.rows[0].id],
    });
    return {
      id: existing.rows[0].id,
      trackId,
      rating,
      updatedAt: now,
      isNew: false,
    };
  } else {
    // Création
    const id = uid("strate");
    await db.execute({
      sql: `
        INSERT INTO studio_ratings (id, track_id, rating, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [id, trackId, rating, now, now],
    });
    return {
      id,
      trackId,
      rating,
      createdAt: now,
      updatedAt: now,
      isNew: true,
    };
  }
}

/**
 * Récupérer les notes studio pour plusieurs morceaux
 */
export async function getStudioRatings(trackIds = []) {
  if (!trackIds.length) return {};

  await ensureStudioRatingsSchema();
  const db = getDb();

  const placeholders = trackIds.map(() => "?").join(",");
  const res = await db.execute({
    sql: `SELECT track_id, rating FROM studio_ratings WHERE track_id IN (${placeholders})`,
    args: trackIds,
  });

  const ratings = {};
  for (const row of res.rows) {
    ratings[row.track_id] = row.rating;
  }
  return ratings;
}

/**
 * Récupérer une note studio pour un morceau
 */
export async function getStudioRating(trackId) {
  if (!trackId) return null;

  await ensureStudioRatingsSchema();
  const db = getDb();

  const res = await db.execute({
    sql: `SELECT rating, created_at, updated_at FROM studio_ratings WHERE track_id = ? LIMIT 1`,
    args: [trackId],
  });

  if (!res.rows[0]) return null;

  return {
    rating: res.rows[0].rating,
    createdAt: res.rows[0].created_at,
    updatedAt: res.rows[0].updated_at,
  };
}
