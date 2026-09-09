import { json, error, readBody } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { isAdminRole, listUsers, findUserByEmail } from "../../../server/users.js";
import { getDb, ensureSchema } from "../../../server/db.js";
import { getBillingState } from "../../../server/billing.js";

export const prerender = false;

function requireAdmin(cookies) {
  const session = getSessionFromCookies(cookies);
  if (!session?.email) return { error: error("Non autorisé", 401) };
  if (!isAdminRole(session.role)) return { error: error("Réservé à l'administrateur", 403) };
  return { session };
}

export async function GET({ cookies }) {
  const gate = requireAdmin(cookies);
  if (gate.error) return gate.error;
  try {
    await ensureSchema();
    const users = await listUsers();
    const rows = [];
    for (const u of users) {
      const billing = await getBillingState(u.email);
      rows.push({
        id: u.id,
        email: u.email,
        role: u.role,
        name: u.name,
        disabledAt: u.disabledAt,
        createdAt: u.createdAt,
        plan: billing.plan,
        credits: billing.credits,
        publishPlus: billing.publishPlus,
        subscriptionStatus: billing.subscriptionStatus,
        stripeCustomerId: billing.stripeCustomerId,
      });
    }
    return json({ users: rows });
  } catch (e) {
    return error(e.message || "Liste users impossible", 500);
  }
}

/**
 * PATCH body: { email, plan?, credits?, creditsDelta?, publishPlus? }
 */
export async function PATCH({ request, cookies }) {
  const gate = requireAdmin(cookies);
  if (gate.error) return gate.error;
  try {
    const body = await readBody(request);
    const email = String(body?.email || "").trim().toLowerCase();
    if (!email) return error("email requis", 400);
    const user = await findUserByEmail(email);
    if (!user) return error("Utilisateur introuvable", 404);

    await ensureSchema();
    const db = getDb();
    const now = new Date().toISOString();
    const sets = ["updated_at = ?", "billing_updated_at = ?"];
    const args = [now, now];

    if (body.plan === "free" || body.plan === "pro") {
      sets.push("plan = ?");
      args.push(body.plan);
      if (body.plan === "pro") {
        sets.push("subscription_status = COALESCE(subscription_status, ?)");
        args.push("active");
      }
    }
    if (typeof body.credits === "number" && Number.isFinite(body.credits)) {
      sets.push("credits_balance = ?");
      args.push(Math.max(0, Math.floor(body.credits)));
    } else if (typeof body.creditsDelta === "number" && Number.isFinite(body.creditsDelta)) {
      sets.push("credits_balance = MAX(0, COALESCE(credits_balance, 0) + ?)");
      args.push(Math.floor(body.creditsDelta));
    }
    if (typeof body.publishPlus === "boolean") {
      sets.push("publish_plus = ?");
      args.push(body.publishPlus ? 1 : 0);
    }

    args.push(user.id);
    await db.execute({
      sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
      args,
    });

    const billing = await getBillingState(email);
    return json({ ok: true, email, billing });
  } catch (e) {
    console.error("[admin/users]", e?.message || e);
    return error(e.message || "Mise à jour user impossible", 500);
  }
}
