/**
 * Turso helpers for Stripe billing entitlements.
 */
import { getDb, ensureSchema } from "./db.js";
import { findUserByEmail, createUser } from "./users.js";

export { findUserByEmail };

function nowIso() {
  return new Date().toISOString();
}

export async function ensureUserForBilling(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) throw new Error("Email requis");
  let user = await findUserByEmail(normalized);
  if (!user) {
    user = await createUser({ email: normalized });
  }
  return user;
}

export async function getBillingState(email) {
  await ensureSchema();
  const user = await findUserByEmail(email);
  if (!user) {
    return {
      plan: "free",
      subscriptionStatus: null,
      credits: 0,
      publishPlus: false,
      stripeCustomerId: null,
      canGenerate: true,
    };
  }
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT plan, subscription_status, credits_balance, publish_plus, stripe_customer_id, subscription_id
          FROM users WHERE email = ? LIMIT 1`,
    args: [String(email).trim().toLowerCase()],
  });
  const row = res.rows[0] || {};
  const plan = String(row.plan || "free").toLowerCase() === "pro" ? "pro" : "free";
  const status = row.subscription_status || null;
  const credits = Number(row.credits_balance || 0) || 0;
  const activePro = plan === "pro" && (!status || ["active", "trialing", "past_due"].includes(String(status)));
  return {
    plan: activePro ? "pro" : "free",
    subscriptionStatus: status,
    credits,
    publishPlus: Boolean(Number(row.publish_plus || 0)),
    stripeCustomerId: row.stripe_customer_id || null,
    subscriptionId: row.subscription_id || null,
    canGenerate: activePro || credits > 0 || plan === "free",
  };
}

export async function wasStripeEventProcessed(eventId) {
  if (!eventId) return false;
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id FROM stripe_events WHERE id = ? LIMIT 1`,
    args: [eventId],
  });
  return Boolean(res.rows[0]);
}

export async function markStripeEventProcessed(eventId, type) {
  if (!eventId) return;
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO stripe_events (id, type, processed_at) VALUES (?, ?, ?)`,
    args: [eventId, type || "", nowIso()],
  });
}

async function updateUserBilling(email, patch) {
  await ensureSchema();
  const user = await ensureUserForBilling(email);
  const db = getDb();
  const fields = [];
  const args = [];
  for (const [col, val] of Object.entries(patch)) {
    fields.push(`${col} = ?`);
    args.push(val);
  }
  fields.push("billing_updated_at = ?");
  args.push(nowIso());
  fields.push("updated_at = ?");
  args.push(nowIso());
  args.push(user.id);
  await db.execute({
    sql: `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    args,
  });
}

/**
 * @param {any} session Stripe Checkout Session
 * @param {{ creditsPerPack: number }} cfg
 */
export async function applyCheckoutCompleted(session, cfg) {
  const email = String(
    session?.metadata?.sonozz_email ||
      session?.customer_email ||
      session?.customer_details?.email ||
      "",
  )
    .trim()
    .toLowerCase();
  if (!email) {
    console.warn("[billing] checkout.session.completed sans email");
    return;
  }
  const plan = String(session?.metadata?.sonozz_plan || "pro").toLowerCase();
  const customerId = session?.customer || null;

  if (plan === "credits") {
    const pack = Number(cfg?.creditsPerPack || 20) || 20;
    await ensureSchema();
    const user = await ensureUserForBilling(email);
    const db = getDb();
    await db.execute({
      sql: `UPDATE users
            SET credits_balance = COALESCE(credits_balance, 0) + ?,
                stripe_customer_id = COALESCE(?, stripe_customer_id),
                billing_updated_at = ?,
                updated_at = ?
            WHERE id = ?`,
      args: [pack, customerId || null, nowIso(), nowIso(), user.id],
    });
    return;
  }

  const patch = {
    stripe_customer_id: customerId,
    plan: plan === "publish_plus" ? "pro" : "pro",
    subscription_status: "active",
  };
  if (session?.subscription) {
    patch.subscription_id = String(session.subscription);
  }
  if (plan === "publish_plus") {
    patch.publish_plus = 1;
  }
  await updateUserBilling(email, patch);
}

/**
 * @param {any} sub Stripe Subscription
 * @param {string} eventType
 */
export async function applySubscriptionEvent(sub, eventType) {
  const email = String(sub?.metadata?.sonozz_email || "")
    .trim()
    .toLowerCase();
  const customerId = sub?.customer || null;
  const status = String(sub?.status || "");
  const planMeta = String(sub?.metadata?.sonozz_plan || "pro").toLowerCase();

  let resolvedEmail = email;
  if (!resolvedEmail && customerId) {
    await ensureSchema();
    const db = getDb();
    const res = await db.execute({
      sql: `SELECT email FROM users WHERE stripe_customer_id = ? LIMIT 1`,
      args: [String(customerId)],
    });
    resolvedEmail = String(res.rows[0]?.email || "").toLowerCase();
  }
  if (!resolvedEmail) {
    console.warn("[billing] subscription event sans email", eventType, sub?.id);
    return;
  }

  const deleted = eventType === "customer.subscription.deleted" || status === "canceled";
  const active = ["active", "trialing", "past_due"].includes(status);

  const patch = {
    stripe_customer_id: customerId ? String(customerId) : null,
    subscription_id: sub?.id ? String(sub.id) : null,
    subscription_status: deleted ? "canceled" : status || null,
    plan: deleted || !active ? "free" : "pro",
  };
  if (planMeta === "publish_plus" && active && !deleted) {
    patch.publish_plus = 1;
  }
  if (deleted) {
    patch.publish_plus = 0;
  }
  await updateUserBilling(resolvedEmail, patch);
}

/**
 * Soft entitlement check for generation APIs.
 * Free: allowed (quota TBD). Pro: allowed. Credits: allowed if balance > 0 when enforced later.
 */
export async function assertCanGenerate(email) {
  const state = await getBillingState(email);
  return state;
}
