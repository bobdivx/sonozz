import { ensureSchema, getDb, uid } from "./client.js";

export async function createAlbum({ artistSlug, title, concept = "", targetCount = 8, status = "draft" } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const albumId = uid("alb");

  await db.execute({
    sql: `
      INSERT INTO albums (id, artist_slug, title, concept, status, target_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [albumId, artistSlug, title, concept || null, status, targetCount, now, now],
  });

  return { id: albumId, artistSlug, title, concept, status, targetCount, createdAt: now, updatedAt: now };
}

export async function getAlbum(albumId) {
  await ensureSchema();
  const db = getDb();

  const albumRes = await db.execute({
    sql: `SELECT * FROM albums WHERE id = ? LIMIT 1`,
    args: [albumId],
  });

  if (!albumRes.rows[0]) return null;

  const album = albumRes.rows[0];
  const tracksRes = await db.execute({
    sql: `SELECT * FROM album_tracks WHERE album_id = ? ORDER BY index_position`,
    args: [albumId],
  });

  return {
    id: album.id,
    artistSlug: album.artist_slug,
    title: album.title,
    concept: album.concept,
    status: album.status,
    targetCount: album.target_count,
    coverUrl: album.cover_url,
    jobId: album.job_id,
    live: album.live_json ? JSON.parse(album.live_json) : null,
    createdAt: album.created_at,
    updatedAt: album.updated_at,
    tracks: tracksRes.rows.map((t) => ({
      id: t.id,
      albumId: t.album_id,
      projectId: t.project_id,
      role: t.role,
      index: t.index_position,
      workingTitle: t.working_title,
      theme: t.theme,
      status: t.status,
      error: t.error,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  };
}

export async function updateAlbum(albumId, updates = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();

  const fields = [];
  const args = [];

  if (updates.title !== undefined) {
    fields.push("title = ?");
    args.push(updates.title);
  }
  if (updates.concept !== undefined) {
    fields.push("concept = ?");
    args.push(updates.concept);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    args.push(updates.status);
  }
  if (updates.targetCount !== undefined) {
    fields.push("target_count = ?");
    args.push(updates.targetCount);
  }
  if (updates.coverUrl !== undefined) {
    fields.push("cover_url = ?");
    args.push(updates.coverUrl);
  }
  if (updates.jobId !== undefined) {
    fields.push("job_id = ?");
    args.push(updates.jobId);
  }
  if (updates.live !== undefined) {
    fields.push("live_json = ?");
    args.push(updates.live ? JSON.stringify(updates.live) : null);
  }

  if (fields.length === 0) return getAlbum(albumId);

  fields.push("updated_at = ?");
  args.push(now);
  args.push(albumId);

  await db.execute({
    sql: `UPDATE albums SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });

  return getAlbum(albumId);
}

export async function listAlbumsByArtist(artistSlug, limit = 50) {
  await ensureSchema();
  const db = getDb();

  const res = await db.execute({
    sql: `
      SELECT a.*,
        (SELECT COUNT(*) FROM album_tracks WHERE album_id = a.id AND status = 'done') as done_count
      FROM albums a
      WHERE artist_slug = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [artistSlug, limit],
  });

  const albums = [];
  for (const row of res.rows) {
    const tracksRes = await db.execute({
      sql: `SELECT * FROM album_tracks WHERE album_id = ? ORDER BY index_position`,
      args: [row.id],
    });
    albums.push({
      id: row.id,
      artistSlug: row.artist_slug,
      title: row.title,
      concept: row.concept,
      status: row.status,
      targetCount: row.target_count,
      doneCount: Number(row.done_count || 0),
      coverUrl: row.cover_url,
      jobId: row.job_id,
      live: row.live_json ? JSON.parse(row.live_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tracks: tracksRes.rows.map((t) => ({
        id: t.id,
        albumId: t.album_id,
        projectId: t.project_id,
        role: t.role,
        index: t.index_position,
        workingTitle: t.working_title,
        theme: t.theme,
        status: t.status,
        error: t.error,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  }

  return albums;
}

export async function addAlbumTrack({ albumId, projectId = null, role = "member", index, workingTitle = "", theme = "", status = "pending" } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const trackId = uid("trk");

  await db.execute({
    sql: `
      INSERT INTO album_tracks (id, album_id, project_id, role, index_position, working_title, theme, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [trackId, albumId, projectId, role, index, workingTitle, theme, status, now, now],
  });

  return { id: trackId, albumId, projectId, role, index, workingTitle, theme, status, createdAt: now, updatedAt: now };
}

export async function updateAlbumTrack(trackId, updates = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();

  const fields = [];
  const args = [];

  if (updates.projectId !== undefined) {
    fields.push("project_id = ?");
    args.push(updates.projectId);
  }
  if (updates.status !== undefined) {
    fields.push("status = ?");
    args.push(updates.status);
  }
  if (updates.error !== undefined) {
    fields.push("error = ?");
    args.push(updates.error);
  }
  if (updates.workingTitle !== undefined) {
    fields.push("working_title = ?");
    args.push(updates.workingTitle);
  }
  if (updates.theme !== undefined) {
    fields.push("theme = ?");
    args.push(updates.theme);
  }
  if (updates.index !== undefined) {
    fields.push("index_position = ?");
    args.push(updates.index);
  }

  if (fields.length === 0) return { ok: true };

  fields.push("updated_at = ?");
  args.push(now);
  args.push(trackId);

  await db.execute({
    sql: `UPDATE album_tracks SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });

  return { ok: true, updatedAt: now };
}

export async function deleteAlbumTrack(trackId) {
  await ensureSchema();
  const db = getDb();

  await db.execute({
    sql: `DELETE FROM album_tracks WHERE id = ?`,
    args: [trackId],
  });

  return { ok: true };
}

export async function deleteAlbum(albumId) {
  await ensureSchema();
  const db = getDb();

  await db.execute({
    sql: `DELETE FROM album_tracks WHERE album_id = ?`,
    args: [albumId],
  });

  await db.execute({
    sql: `DELETE FROM albums WHERE id = ?`,
    args: [albumId],
  });

  return { ok: true };
}
