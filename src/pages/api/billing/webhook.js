import { json, error } from "../../../server/http.js";
import {
  constructWebhookEvent,
  handleBillingWebhookEvent,
  getStripeConfig,
} from "../../../server/stripe.js";

export const prerender = false;

/**
 * POST /api/billing/webhook — public (isPublicPath).
 * Stripe signature verification; handles checkout.session.completed
 * and customer.subscription.* minimally (log + stub).
 */
export async function POST({ request }) {
  try {
    const { webhookSecret, secretKey } = getStripeConfig();
    if (!secretKey || !webhookSecret) {
      return error("Webhook Stripe non configuré (clés manquantes)", 503);
    }

    const raw = Buffer.from(await request.arrayBuffer());
    const signature =
      request.headers.get("stripe-signature") ||
      request.headers.get("Stripe-Signature") ||
      "";

    if (!signature) {
      return error("En-tête stripe-signature manquant", 400);
    }

    let event;
    try {
      event = constructWebhookEvent(raw, signature);
    } catch (e) {
      console.error("[billing/webhook] signature", e?.message || e);
      return error("Signature Stripe invalide", 400);
    }

    const result = await handleBillingWebhookEvent(event);
    return json(result);
  } catch (e) {
    console.error("[billing/webhook]", e?.message || e);
    return error(e?.message || "Webhook Stripe échoué", 500);
  }
}

/** Health / discovery (Stripe Dashboard may probe). */
export async function GET() {
  const { webhookSecret, secretKey } = getStripeConfig();
  return json({
    ok: true,
    endpoint: "/api/billing/webhook",
    configured: Boolean(secretKey && webhookSecret),
    events: [
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ],
  });
}
