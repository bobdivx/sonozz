import { createClient } from "@libsql/client";

let client;
let ready;

function getEnv(name) {
  const fromImport = typeof import.meta !== "undefined" ? import.meta.env?.[name] : "";
  const fromProcess = typeof process !== "undefined" ? process.env?.[name] : "";
  return String(fromImport || fromProcess || "").trim();
}

export function getDb() {
  if (client) return client;

  const url = getEnv("TURSO_DATABASE_URL");
  const authToken = getEnv("TURSO_AUTH_TOKEN");

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
  if (project.social) status = "shorts";
  else if (project.distrokid) status = "distribution";
  else if (project.cover) status = "cover";
  else if (project.track?.audioUrl) status = "audio";
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
    project: JSON.parse(row.project_json),
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

export async function saveProject({ id, project, seed = {}, event } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const summary = summarize(project, seed);
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
        JSON.stringify(project || {}),
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
        JSON.stringify(project || {}),
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
  return {
    ok: true,
    projects: Number(res.rows[0]?.c || 0),
    url: getEnv("TURSO_DATABASE_URL"),
  };
}
