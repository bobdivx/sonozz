/**
 * Quotas plan (artistes / albums) par compte.
 */
import { getDb, ensureSchema } from "./db.js";
import { ensureArtistSchema } from "./artists/schema.js";
import { getBillingPlans } from "./plans.js";
import { getBillingState } from "./billing.js";
import { ROLE_ADMIN } from "./users.js";

export async function countOwnedArtists(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return 0;
  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS c FROM artists WHERE owner_email = ?`,
    args: [normalized],
  });
  return Number(res.rows[0]?.c || 0) || 0;
}

export async function countOwnedAlbums(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return 0;
  await ensureArtistSchema();
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT COUNT(*) AS c
      FROM albums a
      INNER JOIN artists ar ON ar.slug = a.artist_slug
      WHERE ar.owner_email = ?
    `,
    args: [normalized],
  });
  return Number(res.rows[0]?.c || 0) || 0;
}

export async function planLimitsForEmail(email) {
  const state = await getBillingState(email);
  const plans = await getBillingPlans();
  const tier = state.plan === "pro" ? plans.pro : plans.free;
  return {
    plan: state.plan,
    artists: Math.max(0, Number(tier?.artists) || 0),
    albums: Math.max(0, Number(tier?.albums) || 0),
    creditsPerMonth: Math.max(0, Number(tier?.creditsPerMonth) || 0),
    watermark: Boolean(tier?.watermark),
    cleanExport: Boolean(tier?.cleanExport),
  };
}

export async function assertArtistQuota(email, { role } = {}) {
  if (role === ROLE_ADMIN) return { ok: true, bypass: true };
  const normalized = String(email || "").trim().toLowerCase();
  const limits = await planLimitsForEmail(normalized);
  const used = await countOwnedArtists(normalized);
  if (used >= limits.artists) {
    const err = new Error(
      `Quota artistes atteint (${used}/${limits.artists} sur ${limits.plan === "pro" ? "Pro" : "Free"}). Passe Pro ou supprime un profil.`,
    );
    err.code = "QUOTA_ARTISTS";
    throw err;
  }
  return { ok: true, used, limit: limits.artists };
}

export async function assertAlbumQuota(email, { role } = {}) {
  if (role === ROLE_ADMIN) return { ok: true, bypass: true };
  const normalized = String(email || "").trim().toLowerCase();
  const limits = await planLimitsForEmail(normalized);
  const used = await countOwnedAlbums(normalized);
  if (used >= limits.albums) {
    const err = new Error(
      `Quota albums atteint (${used}/${limits.albums} sur ${limits.plan === "pro" ? "Pro" : "Free"}). Passe Pro ou archive un album.`,
    );
    err.code = "QUOTA_ALBUMS";
    throw err;
  }
  return { ok: true, used, limit: limits.albums };
}

export async function assertCanOwnArtistSlug(email, slug, { role } = {}) {
  if (role === ROLE_ADMIN) return { ok: true };
  const normalized = String(email || "").trim().toLowerCase();
  const s = String(slug || "").trim();
  if (!s) return { ok: true };
  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT owner_email FROM artists WHERE slug = ? LIMIT 1`,
    args: [s],
  });
  const owner = res.rows[0]?.owner_email
    ? String(res.rows[0].owner_email).toLowerCase()
    : null;
  if (owner && owner !== normalized) {
    const err = new Error("Cet artiste appartient à un autre compte");
    err.code = "FORBIDDEN_ARTIST";
    throw err;
  }
  return { ok: true, owner };
}
