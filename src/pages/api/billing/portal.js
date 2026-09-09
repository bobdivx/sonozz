import { json, error } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { createPortalSession, isStripeConfigured } from "../../../server/stripe.js";
import { getBillingState } from "../../../server/billing.js";

export const prerender = false;

/**
 * POST /api/billing/portal — Customer Portal for the logged-in user.
 */
export async function POST({ cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);
    if (!isStripeConfigured()) {
      return error("Stripe non configuré", 503);
    }
    const billing = await getBillingState(session.email);
    if (!billing.stripeCustomerId) {
      return error("Aucun client Stripe — souscris d’abord à Pro", 400);
    }
    const portal = await createPortalSession({
      customerId: billing.stripeCustomerId,
    });
    if (!portal?.url) return error("Portal sans URL", 502);
    return json({ url: portal.url });
  } catch (e) {
    console.error("[billing/portal]", e?.message || e);
    return error(e?.message || "Erreur Portal Stripe", 500);
  }
}
