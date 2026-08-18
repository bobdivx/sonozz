import { getDb, ensureSchema, uid } from "./db.js";

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: String(row.email || "").toLowerCase(),
    pocketIdSub: row.pocket_id_sub || null,
    ssoLinkedAt: row.sso_linked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findUserByEmail(email) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users WHERE email = ? LIMIT 1`,
    args: [String(email || "").trim().toLowerCase()],
  });
  return rowToUser(res.rows[0]);
}

export async function findUserByPocketSub(sub) {
  if (!sub) return null;
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users WHERE pocket_id_sub = ? LIMIT 1`,
    args: [String(sub)],
  });
  return rowToUser(res.rows[0]);
}

export async function createUser({ email, pocketIdSub = null, ssoLinkedAt = null } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const id = uid("usr");
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("Email requis");
  await db.execute({
    sql: `
      INSERT INTO users (id, email, pocket_id_sub, sso_linked_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    args: [id, normalized, pocketIdSub || null, ssoLinkedAt || null, now, now],
  });
  return findUserByEmail(normalized);
}

/**
 * Après callback Pocket ID : retrouve le user par email (ou sub), sinon le crée.
 * Pose pocket_id_sub + sso_linked_at.
 */
export async function upsertUserFromOidc({ email, sub }) {
  const normalized = String(email || "").trim().toLowerCase();
  const pocketSub = String(sub || "").trim();
  if (!normalized) throw new Error("Pocket ID n’a pas renvoyé d’email");
  if (!pocketSub) throw new Error("Pocket ID n’a pas renvoyé de sub");

  const now = new Date().toISOString();
  const bySub = await findUserByPocketSub(pocketSub);
  if (bySub && bySub.email !== normalized) {
    throw new Error("Ce compte Pocket ID est déjà lié à un autre email");
  }

  let user = bySub || (await findUserByEmail(normalized));
  if (!user) {
    return createUser({
      email: normalized,
      pocketIdSub: pocketSub,
      ssoLinkedAt: now,
    });
  }

  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `
      UPDATE users
      SET pocket_id_sub = ?, sso_linked_at = ?, email = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [pocketSub, now, normalized, now, user.id],
  });
  return findUserByEmail(normalized);
}

export async function unlinkPocketId(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      UPDATE users
      SET pocket_id_sub = NULL, sso_linked_at = NULL, updated_at = ?
      WHERE id = ?
    `,
    args: [now, user.id],
  });
  return findUserByEmail(email);
}

export async function isSsoLinkedEmail(email) {
  try {
    const user = await findUserByEmail(email);
    return Boolean(user?.ssoLinkedAt);
  } catch {
    return false;
  }
}
