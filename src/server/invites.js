import { createHash, randomBytes } from "node:crypto";
import { getDb, ensureSchema, uid } from "./db.js";
import { createUser, findUserByEmail, ROLE_MEMBER } from "./users.js";
import { hashPassword, isPasswordStrongEnough, MIN_PASSWORD_LEN } from "./password.js";
import { getAppUrl, sendInviteEmail, isMailConfigured } from "./mail.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 jours

export function hashInviteToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

export function generateInviteToken() {
  return randomBytes(32).toString("base64url");
}

function rowToInvite(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: String(row.email || "").toLowerCase(),
    invitedBy: row.invited_by || null,
    status: row.status || "pending",
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at || null,
    createdAt: row.created_at,
  };
}

export async function listInvitations() {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM invitations ORDER BY created_at DESC LIMIT 100`,
  });
  return res.rows.map(rowToInvite);
}

export async function findPendingInviteByToken(token) {
  const tokenHash = hashInviteToken(token);
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM invitations WHERE token_hash = ? LIMIT 1`,
    args: [tokenHash],
  });
  const invite = rowToInvite(res.rows[0]);
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.status === "revoked") return { ok: false, reason: "revoked", invite };
  if (invite.status === "accepted") return { ok: false, reason: "accepted", invite };
  if (invite.status !== "pending") return { ok: false, reason: "invalid", invite };
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    await db.execute({
      sql: `UPDATE invitations SET status = 'expired' WHERE id = ? AND status = 'pending'`,
      args: [invite.id],
    });
    return { ok: false, reason: "expired", invite: { ...invite, status: "expired" } };
  }
  return { ok: true, invite };
}

export async function createInvitation({ email, invitedBy, request } = {}) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    throw new Error("Email d’invitation invalide");
  }

  const existing = await findUserByEmail(normalized);
  if (existing && !existing.disabledAt) {
    throw new Error("Cet email a déjà accès au studio");
  }

  if (!isMailConfigured()) {
    throw new Error("SMTP non configuré — impossible d’envoyer l’invitation");
  }

  await ensureSchema();
  const db = getDb();

  // Révoquer les invitations pending précédentes pour le même email
  await db.execute({
    sql: `UPDATE invitations SET status = 'revoked' WHERE email = ? AND status = 'pending'`,
    args: [normalized],
  });

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const id = uid("inv");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await db.execute({
    sql: `
      INSERT INTO invitations (id, email, token_hash, invited_by, status, expires_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `,
    args: [id, normalized, tokenHash, invitedBy || null, expiresAt, now],
  });

  const base = getAppUrl(request);
  const inviteUrl = `${base}/rejoindre?token=${encodeURIComponent(token)}`;

  try {
    await sendInviteEmail({
      to: normalized,
      inviteUrl,
      invitedBy: invitedBy || null,
    });
  } catch (e) {
    await db.execute({
      sql: `UPDATE invitations SET status = 'revoked' WHERE id = ?`,
      args: [id],
    });
    throw new Error(e.message || "Envoi de l’email impossible");
  }

  return { invite: await getInvitationById(id), inviteUrl };
}

async function getInvitationById(id) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM invitations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rowToInvite(res.rows[0]);
}

export async function revokeInvitation(id) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM invitations WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const invite = rowToInvite(res.rows[0]);
  if (!invite) throw new Error("Invitation introuvable");
  if (invite.status !== "pending") {
    throw new Error("Seule une invitation en attente peut être révoquée");
  }
  await db.execute({
    sql: `UPDATE invitations SET status = 'revoked' WHERE id = ?`,
    args: [id],
  });
  return getInvitationById(id);
}

/**
 * Accepte l’invitation : crée le user member + marque accepted.
 * @returns {{ user, email }}
 */
export async function acceptInvitation({ token, password, name } = {}) {
  if (!isPasswordStrongEnough(password)) {
    throw new Error(`Mot de passe trop court (min. ${MIN_PASSWORD_LEN} caractères)`);
  }

  const check = await findPendingInviteByToken(token);
  if (!check.ok) {
    const messages = {
      invalid: "Lien d’invitation invalide",
      revoked: "Cette invitation a été révoquée",
      accepted: "Cette invitation a déjà été utilisée",
      expired: "Cette invitation a expiré",
    };
    throw new Error(messages[check.reason] || "Invitation invalide");
  }

  const invite = check.invite;
  const existing = await findUserByEmail(invite.email);
  if (existing && !existing.disabledAt && existing.passwordHash) {
    throw new Error("Cet email a déjà un compte");
  }

  const passwordHash = hashPassword(password);
  let user;
  if (existing) {
    await ensureSchema();
    const db = getDb();
    const now = new Date().toISOString();
    await db.execute({
      sql: `
        UPDATE users
        SET password_hash = ?, role = ?, name = COALESCE(?, name), disabled_at = NULL, updated_at = ?
        WHERE id = ?
      `,
      args: [
        passwordHash,
        ROLE_MEMBER,
        name ? String(name).trim() : null,
        now,
        existing.id,
      ],
    });
    user = await findUserByEmail(invite.email);
  } else {
    user = await createUser({
      email: invite.email,
      passwordHash,
      role: ROLE_MEMBER,
      name: name ? String(name).trim() : null,
    });
  }

  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE invitations SET status = 'accepted', accepted_at = ? WHERE id = ?`,
    args: [now, invite.id],
  });

  return { user, email: invite.email };
}

export { INVITE_TTL_MS, MIN_PASSWORD_LEN };
