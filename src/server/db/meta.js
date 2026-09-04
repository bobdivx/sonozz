import { ensureSchema, getDb } from "./client.js";

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
