/**
 * Stripe Checkout scaffolding (subscriptions).
 *
 * Env (DevForge / runtime — never hardcode secrets):
 *   STRIPE_SECRET_KEY          — sk_test_… / sk_live_…
 *   STRIPE_WEBHOOK_SECRET      — whsec_… (Signing secret for /api/billing/webhook)
 *   STRIPE_PRICE_PRO           — price_… for plan "pro"
 *   STRIPE_PRICE_PUBLISH_PLUS  — price_… for plan "publish_plus" (optional)
 *   APP_URL                    — public base, e.g. https://sonozz.briseteia.me
 *   STRIPE_SUCCESS_URL         — optional override for the base URL used in Checkout redirects
 *
 * Default public base when unset: https://sonozz.briseteia.me
 */
import Stripe from "stripe";

const DEFAULT_APP_URL = "https://sonozz.briseteia.me";

function env(name) {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  return String(meta[name] || proc[name] || "").trim();
}

export function getStripeConfig() {
  return {
    secretKey: env("STRIPE_SECRET_KEY"),
    webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    pricePro: env("STRIPE_PRICE_PRO"),
    pricePublishPlus: env("STRIPE_PRICE_PUBLISH_PLUS"),
    appUrl: env("APP_URL"),
    successUrlBase: env("STRIPE_SUCCESS_URL"),
  };
}

/** Public base for success/cancel URLs (no trailing slash). */
export function getBillingBaseUrl() {
  const { successUrlBase, appUrl } = getStripeConfig();
  const raw = successUrlBase || appUrl || DEFAULT_APP_URL;
  return String(raw).replace(/\/+$/, "") || DEFAULT_APP_URL;
}

export function isStripeConfigured() {
  const { secretKey, pricePro } = getStripeConfig();
  return Boolean(secretKey && pricePro);
}

/**
 * Stripe Node SDK client: prefer StripeClient if the installed SDK exports it,
 * otherwise classic `new Stripe(secretKey)`.
 */
export function getStripe() {
  const { secretKey } = getStripeConfig();
  if (!secretKey) {
    throw new Error(
      "STRIPE_SECRET_KEY manquant. Configure-le dans DevForge (pas encore de clés réelles).",
    );
  }

  if (typeof Stripe?.StripeClient === "function") {
    return new Stripe.StripeClient(secretKey);
  }
  if (typeof Stripe === "function") {
    return new Stripe(secretKey);
  }
  const Ctor = Stripe?.default;
  if (typeof Ctor === "function") {
    return new Ctor(secretKey);
  }
  throw new Error("SDK Stripe introuvable (import Stripe échoué)");
}

/** @param {'pro' | 'publish_plus'} plan */
export function priceIdForPlan(plan) {
  const { pricePro, pricePublishPlus } = getStripeConfig();
  if (plan === "pro") {
    if (!pricePro) throw new Error("STRIPE_PRICE_PRO manquant");
    return pricePro;
  }
  if (plan === "publish_plus") {
    if (!pricePublishPlus) {
      throw new Error("STRIPE_PRICE_PUBLISH_PLUS manquant (plan optionnel non configuré)");
    }
    return pricePublishPlus;
  }
  throw new Error(`Plan inconnu: ${plan}`);
}

/**
 * Create a Checkout Session in subscription mode.
 * @param {{ plan: 'pro' | 'publish_plus', customerEmail: string, clientReferenceId?: string }} opts
 */
export async function createCheckoutSession({ plan, customerEmail, clientReferenceId }) {
  const stripe = getStripe();
  const base = getBillingBaseUrl();
  const price = priceIdForPlan(plan);
  const email = String(customerEmail || "").trim().toLowerCase();
  if (!email) throw new Error("customer_email requis (session utilisateur)");

  const params = {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/studio?billing=success`,
    cancel_url: `${base}/#pricing`,
    customer_email: email,
    metadata: { plan, sonozz_email: email },
    subscription_data: {
      metadata: { plan, sonozz_email: email },
    },
  };
  if (clientReferenceId) {
    params.client_reference_id = String(clientReferenceId).slice(0, 200);
  }

  return stripe.checkout.sessions.create(params);
}

/**
 * Verify Stripe webhook signature and return the Event.
 * @param {Buffer|Uint8Array|string} rawBody
 * @param {string} signatureHeader
 */
export function constructWebhookEvent(rawBody, signatureHeader) {
  const { webhookSecret } = getStripeConfig();
  if (!webhookSecret) {
    throw new Error("STRIPE_WEBHOOK_SECRET manquant");
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

/**
 * Minimal handler: log + stub plan update (DB wiring later).
 * @param {import('stripe').Stripe.Event} event
 */
export async function handleBillingWebhookEvent(event) {
  const type = event?.type || "";
  const obj = event?.data?.object || {};

  if (type === "checkout.session.completed") {
    const email =
      obj.customer_email ||
      obj.customer_details?.email ||
      obj.metadata?.sonozz_email ||
      null;
    const plan = obj.metadata?.plan || null;
    console.info("[stripe-webhook] checkout.session.completed", {
      id: obj.id,
      email,
      plan,
      mode: obj.mode,
      subscription: obj.subscription,
    });
    // Stub: persist plan / stripeCustomerId on user when billing tables exist.
    return { ok: true, handled: type, email, plan };
  }

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    console.info("[stripe-webhook]", type, {
      id: obj.id,
      status: obj.status,
      customer: obj.customer,
      plan: obj.metadata?.plan || null,
      email: obj.metadata?.sonozz_email || null,
    });
    // Stub: sync subscription status → user entitlements.
    return { ok: true, handled: type, status: obj.status };
  }

  console.info("[stripe-webhook] ignored", type);
  return { ok: true, ignored: true, type };
}
