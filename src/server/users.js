import { getDb, ensureSchema, uid } from "./db.js";
import { hashPassword, verifyPassword } from "./password.js";

export const ROLE_ADMIN = "admin";
export const ROLE_MEMBER = "member";

function adminEmailFromEnv() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  return String(meta.AUTH_EMAIL || proc.AUTH_EMAIL || "")
    .trim()
    .toLowerCase();
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: String(row.email || "").toLowerCase(),
    pocketIdSub: row.pocket_id_sub || null,
    ssoLinkedAt: row.sso_linked_at || null,
    passwordHash: row.password_hash || null,
    role: row.role === ROLE_ADMIN ? ROLE_ADMIN : ROLE_MEMBER,
    name: row.name || null,
    disabledAt: row.disabled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isAdminRole(role) {
  return role === ROLE_ADMIN;
}

export function resolveRoleForEmail(email, dbRole = null) {
  const normalized = String(email || "").trim().toLowerCase();
  const adminEmail = adminEmailFromEnv();
  if (adminEmail && normalized === adminEmail) return ROLE_ADMIN;
  if (dbRole === ROLE_ADMIN) return ROLE_ADMIN;
  return ROLE_MEMBER;
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

export async function listUsers() {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM users ORDER BY created_at ASC`,
  });
  return res.rows.map(rowToUser);
}

export async function createUser({
  email,
  pocketIdSub = null,
  ssoLinkedAt = null,
  passwordHash = null,
  role = ROLE_MEMBER,
  name = null,
} = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const id = uid("usr");
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("Email requis");
  const finalRole = resolveRoleForEmail(normalized, role);
  await db.execute({
    sql: `
      INSERT INTO users (
        id, email, pocket_id_sub, sso_linked_at, password_hash, role, name, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      normalized,
      pocketIdSub || null,
      ssoLinkedAt || null,
      passwordHash || null,
      finalRole,
      name ? String(name).trim() : null,
      now,
      now,
    ],
  });
  return findUserByEmail(normalized);
}

/**
 * Après callback Pocket ID : retrouve le user par email (ou sub).
 * Ne crée plus de comptes inconnus — seuls admin seed / invites existent.
 */
export async function upsertUserFromOidc({ email, sub, allowCreate = false } = {}) {
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
    if (!allowCreate) {
      throw new Error("Compte inconnu — demande une invitation au studio");
    }
    return createUser({
      email: normalized,
      pocketIdSub: pocketSub,
      ssoLinkedAt: now,
      role: resolveRoleForEmail(normalized),
    });
  }

  if (user.disabledAt) {
    throw new Error("Compte désactivé");
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

export async function setUserPassword(email, password) {
  const user = await findUserByEmail(email);
  if (!user) throw new Error("Utilisateur introuvable");
  const passwordHash = hashPassword(password);
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`,
    args: [passwordHash, now, user.id],
  });
  return findUserByEmail(email);
}

export async function verifyUserPassword(email, password) {
  const user = await findUserByEmail(email);
  if (!user || user.disabledAt) return null;
  if (!user.passwordHash) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

export async function disableUser(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  if (user.role === ROLE_ADMIN) throw new Error("Impossible de désactiver l’admin");
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?`,
    args: [now, now, user.id],
  });
  return findUserByEmail(email);
}

export async function enableUser(email) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE users SET disabled_at = NULL, updated_at = ? WHERE id = ?`,
    args: [now, user.id],
  });
  return findUserByEmail(email);
}

export async function resolveSessionRole(email) {
  const normalized = String(email || "").trim().toLowerCase();
  try {
    const user = await findUserByEmail(normalized);
    if (user?.disabledAt) return null;
    if (user) return resolveRoleForEmail(normalized, user.role);
  } catch {
    /* DB down */
  }
  return resolveRoleForEmail(normalized);
}
