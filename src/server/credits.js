/**
 * Crédits génération : grant mensuel lazy + débit.
 * 1 crédit ≈ 1 génération de titre (paroles+audio).
 * Tout nouveau compte démarre Free (crédits Free) ; Pro change le plafond mensuel.
 */
import { getDb, ensureSchema } from "./db.js";
import { findUserByEmail } from "./users.js";
import { getBillingPlans } from "./plans.js";
import { getBillingState } from "./billing.js";

function nowIso() {
  return new Date().toISOString();
}

export function currentCreditsPeriod(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function tierCredits(plans, plan) {
  const tier = plan === "pro" ? plans.pro : plans.free;
  return Math.max(0, Number(tier?.creditsPerMonth) || 0);
}

/**
 * Ajoute les crédits du mois si la période a changé (idempotent).
 * @returns {{ granted: number, balance: number, period: string, plan: string }}
 */
export async function grantMonthlyCreditsIfDue(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("Email requis");
  await ensureSchema();
  const user = await findUserByEmail(normalized);
  if (!user) throw new Error("Compte introuvable");

  const period = currentCreditsPeriod();
  const db = getDb();
  const rowRes = await db.execute({
    sql: `SELECT plan, subscription_status, credits_balance, credits_period
          FROM users WHERE email = ? LIMIT 1`,
    args: [normalized],
  });
  const row = rowRes.rows[0] || {};
  const planRaw = String(row.plan || "free").toLowerCase();
  const status = row.subscription_status || null;
  const activePro =
    planRaw === "pro" && (!status || ["active", "trialing", "past_due"].includes(String(status)));
  const plan = activePro ? "pro" : "free";
  const prevPeriod = row.credits_period ? String(row.credits_period) : null;
  const balance = Number(row.credits_balance || 0) || 0;

  if (prevPeriod === period) {
    return { granted: 0, balance, period, plan };
  }

  const plans = await getBillingPlans();
  const amount = tierCredits(plans, plan);

  await db.execute({
    sql: `UPDATE users
          SET credits_balance = COALESCE(credits_balance, 0) + ?,
              credits_period = ?,
              billing_updated_at = ?,
              updated_at = ?
          WHERE email = ? AND (credits_period IS NULL OR credits_period != ?)`,
    args: [amount, period, nowIso(), nowIso(), normalized, period],
  });

  const after = await db.execute({
    sql: `SELECT credits_balance FROM users WHERE email = ? LIMIT 1`,
    args: [normalized],
  });
  return {
    granted: amount,
    balance: Number(after.rows[0]?.credits_balance || 0) || balance + amount,
    period,
    plan,
  };
}

/** Solde initial à l’inscription (plan Free par défaut). */
export async function grantSignupCredits(email) {
  return grantMonthlyCreditsIfDue(email);
}

/**
 * Débite N crédits. Échoue si solde insuffisant.
 * @returns {{ balance: number }}
 */
export async function spendCredits(email, amount = 1) {
  const normalized = String(email || "").trim().toLowerCase();
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  if (!normalized) throw new Error("Email requis");

  await grantMonthlyCreditsIfDue(normalized);
  await ensureSchema();
  const db = getDb();

  const before = await db.execute({
    sql: `SELECT credits_balance FROM users WHERE email = ? LIMIT 1`,
    args: [normalized],
  });
  const current = Number(before.rows[0]?.credits_balance || 0) || 0;
  if (current < n) {
    const err = new Error(
      `Crédits insuffisants (${current} restant${current > 1 ? "s" : ""}). Passe Pro ou achète un pack.`,
    );
    err.code = "CREDITS";
    throw err;
  }

  const now = nowIso();
  await db.execute({
    sql: `UPDATE users
          SET credits_balance = credits_balance - ?,
              billing_updated_at = ?,
              updated_at = ?
          WHERE email = ?
            AND COALESCE(credits_balance, 0) >= ?`,
    args: [n, now, now, normalized, n],
  });

  const after = await db.execute({
    sql: `SELECT credits_balance FROM users WHERE email = ? LIMIT 1`,
    args: [normalized],
  });
  const balance = Number(after.rows[0]?.credits_balance || 0) || 0;
  if (balance !== current - n && balance > current - n) {
    // course rare : re-vérifier
    if (balance === current) {
      const err = new Error(
        `Crédits insuffisants (${current} restant${current > 1 ? "s" : ""}). Passe Pro ou achète un pack.`,
      );
      err.code = "CREDITS";
      throw err;
    }
  }
  return { balance };
}

/**
 * Vérifie le droit de générer (+ grant mensuel). Admin : toujours ok.
 */
export async function assertGenerationAllowed(email, { isAdmin = false } = {}) {
  if (isAdmin) {
    const state = await getBillingState(email);
    return { ...state, canGenerate: true, watermark: false, bypass: true };
  }
  await grantMonthlyCreditsIfDue(email);
  const state = await getBillingState(email);
  const plans = await getBillingPlans();
  const tier = state.plan === "pro" ? plans.pro : plans.free;
  const watermark = Boolean(tier?.watermark);
  if ((state.credits || 0) < 1) {
    const err = new Error(
      "Plus de crédits ce mois-ci. Passe Pro, achète un pack, ou attends le renouvellement.",
    );
    err.code = "CREDITS";
    throw err;
  }
  return { ...state, canGenerate: true, watermark, bypass: false };
}
