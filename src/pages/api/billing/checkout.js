import { json, error, readBody } from "../../../server/http.js";
import { getSessionFromCookies } from "../../../server/auth.js";
import {
  createCheckoutSession,
  isStripeConfigured,
  getStripeConfig,
} from "../../../server/stripe.js";

export const prerender = false;

/**
 * POST /api/billing/checkout
 * Body: { plan: 'pro' | 'publish_plus' }
 * Auth required (middleware). Returns { url } for Stripe Checkout redirect.
 */
export async function POST({ request, cookies }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) {
      return error("Non autorisé", 401);
    }

    if (!isStripeConfigured()) {
      const cfg = getStripeConfig();
      return error(
        !cfg.secretKey
          ? "Stripe non configuré (STRIPE_SECRET_KEY manquant)"
          : "Stripe non configuré (STRIPE_PRICE_PRO manquant)",
        503,
      );
    }

    const body = await readBody(request);
    const plan = String(body?.plan || "pro").trim().toLowerCase();
    if (plan !== "pro" && plan !== "publish_plus") {
      return error("plan doit être 'pro' ou 'publish_plus'", 400);
    }

    const checkout = await createCheckoutSession({
      plan,
      customerEmail: session.email,
      clientReferenceId: session.email,
    });

    if (!checkout?.url) {
      return error("Session Checkout créée sans URL", 502);
    }

    return json({
      id: checkout.id,
      url: checkout.url,
      plan,
    });
  } catch (e) {
    console.error("[billing/checkout]", e?.message || e);
    if (e?.stack) console.error(e.stack);
    const msg = e?.message || "Erreur Checkout Stripe";
    const status = /manquant|inconnu|requis/i.test(msg) ? 400 : 500;
    return error(msg, status);
  }
}
