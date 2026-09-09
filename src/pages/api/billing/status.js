import { json, error } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import { getBillingState } from "../../../server/billing.js";
import {
  isStripeConfigured,
  isCreditsPackConfigured,
  getStripeConfig,
} from "../../../server/stripe.js";

export const prerender = false;

/** GET /api/billing/status — plan + crédits for the current session. */
export async function GET({ cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);
    const billing = await getBillingState(session.email);
    const cfg = getStripeConfig();
    return json({
      ...billing,
      stripeConfigured: isStripeConfigured(),
      creditsPackConfigured: isCreditsPackConfigured(),
      creditsPerPack: cfg.creditsPerPack,
    });
  } catch (e) {
    console.error("[billing/status]", e?.message || e);
    return error(e?.message || "Erreur statut billing", 500);
  }
}
