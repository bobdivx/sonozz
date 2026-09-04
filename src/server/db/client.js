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
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      name TEXT,
      disabled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  for (const sql of [
    `ALTER TABLE users ADD COLUMN password_hash TEXT`,
    `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'`,
    `ALTER TABLE users ADD COLUMN name TEXT`,
    `ALTER TABLE users ADD COLUMN disabled_at TEXT`,
  ]) {
    try {
      await db.execute(sql);
    } catch {
      /* already exists */
    }
  }

  await db.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_pocket_sub ON users(pocket_id_sub)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      invited_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email, status)
  `);

  await seedAdminUser(db);

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

async function seedAdminUser(db) {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  const email = String(meta.AUTH_EMAIL || proc.AUTH_EMAIL || "")
    .trim()
    .toLowerCase();
  if (!email) return;

  const existing = await db.execute({
    sql: `SELECT id, role FROM users WHERE email = ? LIMIT 1`,
    args: [email],
  });
  const now = new Date().toISOString();
  if (existing.rows[0]) {
    if (String(existing.rows[0].role || "") !== "admin") {
      await db.execute({
        sql: `UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`,
        args: [now, existing.rows[0].id],
      });
    }
    return;
  }

  const id = uid("usr");
  await db.execute({
    sql: `
      INSERT INTO users (id, email, role, created_at, updated_at)
      VALUES (?, ?, 'admin', ?, ?)
    `,
    args: [id, email, now, now],
  });
}

export function uid(prefix = "p") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
