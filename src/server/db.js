import { createClient } from "@libsql/client";

let client;
let ready;

function getTursoEnv() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  return {
    url: String(meta.TURSO_DATABASE_URL || proc.TURSO_DATABASE_URL || "").trim(),
    authToken: String(meta.TURSO_AUTH_TOKEN || proc.TURSO_AUTH_TOKEN || "").trim(),
  };
}

export function getDb() {
  if (client) return client;

  const { url, authToken } = getTursoEnv();

  if (!url || !authToken) {
    throw new Error(
      "Turso non configuré. Ajoute TURSO_DATABASE_URL et TURSO_AUTH_TOKEN dans .env",
    );
  }

  client = createClient({ url, authToken });
  return client;
}

export async function ensureSchema() {
  if (ready) return;
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Sans titre',
      artist_name TEXT,
      track_title TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      seed_json TEXT,
      project_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      step_key TEXT,
      event_type TEXT NOT NULL,
      message TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_events_project ON project_events(project_id, created_at DESC)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      pocket_id_sub TEXT,
      sso_linked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pocket_sub ON users(pocket_id_sub)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      artist_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      concept TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      target_count INTEGER,
      cover_url TEXT,
      job_id TEXT,
      live_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_albums_artist ON albums(artist_slug, updated_at DESC)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS album_tracks (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      project_id TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      index_position INTEGER NOT NULL,
      working_title TEXT,
      theme TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_album_tracks_album ON album_tracks(album_id, index_position)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_album_tracks_project ON album_tracks(project_id)
  `);

  ready = true;
}

export function uid(prefix = "p") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarize(project = {}, seed = {}) {
  const artistName = project.artist?.name || seed.name || null;
  const trackTitle = project.track?.title || project.lyrics?.title || seed.theme || null;
  const title = [artistName, trackTitle].filter(Boolean).join(" — ") || "Projet SONOZZ";

  let status = "draft";
  if (project.social?.publishedAt || project.social?.publish) status = "published";
  else if (
    project.clip?.videoBase64 ||
    project.clip?.videoUrl ||
    (Array.isArray(project.clips) &&
      project.clips.some((c) => c?.videoUrl || c?.s3Key || c?.storedRemote || c?.storedLocally))
  )
    status = "clip";
  else if (project.social) status = "shorts";
  else if (project.distrokid) status = "distribution";
  else if (project.cover) status = "cover";
  else if (
    project.track?.audioUrl &&
    project.track?.status !== "pending-review" &&
    project.track?.status !== "preview-ready" &&
    !project.track?.isPreview
  )
    status = "audio";
  else if (project.track) status = "track";
  else if (project.lyrics) status = "lyrics";
  else if (project.artist) status = "artist";
  else if (project.trends) status = "trends";

  return { title, artistName, trackTitle, status };
}

export async function listProjects(limit = 50) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT id, title, artist_name, track_title, status, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [limit],
  });
  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getProject(id) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row) return null;

  const events = await db.execute({
    sql: `
      SELECT id, step_key, event_type, message, payload_json, created_at
      FROM project_events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `,
    args: [id],
  });

  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    status: row.status,
    seed: row.seed_json ? JSON.parse(row.seed_json) : {},
    project: stripHeavyProjectPayload(JSON.parse(row.project_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.rows.map((e) => ({
      id: e.id,
      stepKey: e.step_key,
      eventType: e.event_type,
      message: e.message,
      payload: e.payload_json ? JSON.parse(e.payload_json) : null,
      createdAt: e.created_at,
    })),
  };
}

function stripHeavyProjectPayload(project = {}) {
  if (!project || typeof project !== "object") return project;
  const next = { ...project };

  if (next.clip && typeof next.clip === "object") {
    const { videoBase64, videoUrl, ...meta } = next.clip;
    const remote = typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined;
    next.clip = {
      ...meta,
      videoUrl: remote,
      videoBase64: undefined,
      storedRemote: Boolean(remote || meta.s3Key || meta.storedRemote),
      storedLocally: Boolean(meta.storedLocally && !remote),
    };
  }

  if (Array.isArray(next.clips)) {
    next.clips = next.clips.map((c) => {
      if (!c || typeof c !== "object") return c;
      const { videoBase64, videoUrl, ...meta } = c;
      const remote =
        typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined;
      return {
        ...meta,
        videoUrl: remote,
        videoBase64: undefined,
        storedRemote: Boolean(remote || meta.s3Key || meta.storedRemote),
        storedLocally: Boolean(meta.storedLocally && !remote),
      };
    });
  }

  const stripHeavyAudio = (trackObj) => {
    if (!trackObj || typeof trackObj !== "object") return trackObj;
    const audio = trackObj.audioUrl;
    if (typeof audio === "string" && audio.startsWith("data:") && audio.length > 500_000) {
      return {
        ...trackObj,
        audioUrl: null,
        localAsset: true,
        assetMissingReason: "audio-data-stripped",
      };
    }
    return trackObj;
  };

  if (next.track) next.track = stripHeavyAudio(next.track);
  if (Array.isArray(next.trackVersions)) {
    next.trackVersions = next.trackVersions.map(stripHeavyAudio);
  }

  return next;
}

export async function saveProject({ id, project, seed = {}, event } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const lightProject = stripHeavyProjectPayload(project || {});
  const summary = summarize(lightProject, seed);
  const projectId = id || uid("proj");

  const existing = await db.execute({
    sql: `SELECT id, created_at FROM projects WHERE id = ? LIMIT 1`,
    args: [projectId],
  });

  if (existing.rows[0]) {
    await db.execute({
      sql: `
        UPDATE projects
        SET title = ?, artist_name = ?, track_title = ?, status = ?,
            seed_json = ?, project_json = ?, updated_at = ?
        WHERE id = ?
      `,
      args: [
        summary.title,
        summary.artistName,
        summary.trackTitle,
        summary.status,
        JSON.stringify(seed || {}),
        JSON.stringify(lightProject),
        now,
        projectId,
      ],
    });
  } else {
    await db.execute({
      sql: `
        INSERT INTO projects
          (id, title, artist_name, track_title, status, seed_json, project_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        projectId,
        summary.title,
        summary.artistName,
        summary.trackTitle,
        summary.status,
        JSON.stringify(seed || {}),
        JSON.stringify(lightProject),
        now,
        now,
      ],
    });
  }

  if (event) {
    await db.execute({
      sql: `
        INSERT INTO project_events
          (id, project_id, step_key, event_type, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        uid("evt"),
        projectId,
        event.stepKey || null,
        event.eventType || "update",
        event.message || null,
        event.payload ? JSON.stringify(event.payload) : null,
        now,
      ],
    });
  }

  return getProject(projectId);
}

export async function deleteProject(id) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM project_events WHERE project_id = ?`,
    args: [id],
  });
  await db.execute({
    sql: `DELETE FROM projects WHERE id = ?`,
    args: [id],
  });
  return { ok: true };
}

export async function testDb() {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute(`SELECT COUNT(*) AS c FROM projects`);
  const { url } = getTursoEnv();
  return {
    ok: true,
    projects: Number(res.rows[0]?.c || 0),
    url,
  };
}

export async function getAppMeta(key) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT value FROM app_meta WHERE key = ? LIMIT 1`,
    args: [key],
  });
  return res.rows[0]?.value ?? null;
}

export async function setAppMeta(key, value) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
    args: [key, String(value ?? ""), now],
  });
  return { key, updatedAt: now };
}

export async function deleteAppMeta(key) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM app_meta WHERE key = ?`,
    args: [key],
  });
  return { ok: true };
}

/** Blob JSON des clés / tokens API utilisateur (Paramètres). */
export const USER_KEYS_META = "user_api_keys";

export async function getUserKeys() {
  const raw = await getAppMeta(USER_KEYS_META);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveUserKeys(keys) {
  const payload = keys && typeof keys === "object" ? keys : {};
  const result = await setAppMeta(USER_KEYS_META, JSON.stringify(payload));
  return { ok: true, updatedAt: result.updatedAt };
}

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
  
  return res.rows.map((row) => ({
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
  }));
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
