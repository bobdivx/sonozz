/**
 * Stripe Checkout + Customer Portal + webhooks.
 *
 * Env (DevForge — never hardcode secrets):
 *   STRIPE_SECRET_KEY         — sk_test_… / sk_live_… (prefer rk_ restricted key)
 *   STRIPE_WEBHOOK_SECRET     — whsec_… for /api/billing/webhook
 *   STRIPE_PRICE_PRO          — price_… monthly Pro
 *   STRIPE_PRICE_PUBLISH_PLUS — price_… Publish+ (optional)
 *   STRIPE_PRICE_CREDITS      — price_… one-time credit pack (optional)
 *   STRIPE_CREDITS_PER_PACK   — credits granted per pack (default 20)
 *   APP_URL / STRIPE_SUCCESS_URL — public base, e.g. https://sonozz.briseteia.me
 *
 * Dashboard: webhook → https://sonozz.briseteia.me/api/billing/webhook
 * Events: checkout.session.completed, customer.subscription.*, invoice.paid
 */

import Stripe from "stripe";
import {
  applyCheckoutCompleted,
  applySubscriptionEvent,
  markStripeEventProcessed,
  wasStripeEventProcessed,
} from "./billing.js";

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
    priceCredits: env("STRIPE_PRICE_CREDITS"),
    creditsPerPack: Number(env("STRIPE_CREDITS_PER_PACK") || "20") || 20,
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

export function isCreditsPackConfigured() {
  const { secretKey, priceCredits } = getStripeConfig();
  return Boolean(secretKey && priceCredits);
}

let stripeSingleton = null;

/** @returns {import('stripe').default} */
export function getStripe() {
  const { secretKey } = getStripeConfig();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY manquant");
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(secretKey);
  }
  return stripeSingleton;
}

/** @param {'pro' | 'publish_plus' | 'credits'} plan */
export function priceIdForPlan(plan) {
  const { pricePro, pricePublishPlus, priceCredits } = getStripeConfig();
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
  if (plan === "credits") {
    if (!priceCredits) throw new Error("STRIPE_PRICE_CREDITS manquant");
    return priceCredits;
  }
  throw new Error(`Plan inconnu: ${plan}`);
}

/**
 * @param {{ plan: 'pro' | 'publish_plus' | 'credits', customerEmail: string, clientReferenceId?: string, stripeCustomerId?: string | null }} opts
 */
export async function createCheckoutSession({
  plan,
  customerEmail,
  clientReferenceId,
  stripeCustomerId = null,
}) {
  const stripe = getStripe();
  const base = getBillingBaseUrl();
  const price = priceIdForPlan(plan);
  const mode = plan === "credits" ? "payment" : "subscription";
  const email = String(customerEmail || "").trim().toLowerCase();
  if (!email) throw new Error("Email client requis");

  const params = {
    mode,
    line_items: [{ price, quantity: 1 }],
    success_url: `${base}/billing?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing?billing=cancel`,
    client_reference_id: clientReferenceId || email,
    metadata: {
      sonozz_plan: plan,
      sonozz_email: email,
    },
    // Tag for Dashboard comparisons (API ≥ 2026-03-25); ignored by older accounts.
    integration_identifier: `sonozz_checkout_${plan}_xqkwlmnr`,
  };

  if (stripeCustomerId) {
    params.customer = stripeCustomerId;
  } else {
    params.customer_email = email;
  }

  if (mode === "subscription") {
    params.subscription_data = {
      metadata: {
        sonozz_plan: plan,
        sonozz_email: email,
      },
    };
  } else {
    params.payment_intent_data = {
      metadata: {
        sonozz_plan: plan,
        sonozz_email: email,
      },
    };
  }

  try {
    return await stripe.checkout.sessions.create(params);
  } catch (e) {
    // Older Stripe accounts may reject unknown params
    if (String(e?.message || "").includes("integration_identifier")) {
      delete params.integration_identifier;
      return await stripe.checkout.sessions.create(params);
    }
    throw e;
  }
}

/**
 * @param {{ customerId: string, returnUrl?: string }} opts
 */
export async function createPortalSession({ customerId, returnUrl }) {
  const stripe = getStripe();
  const base = getBillingBaseUrl();
  if (!customerId) throw new Error("stripe_customer_id requis");
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || `${base}/billing`,
  });
}

/**
 * @param {Buffer|Uint8Array|string} rawBody
 * @param {string} signatureHeader
 */
export function constructWebhookEvent(rawBody, signatureHeader) {
  const stripe = getStripe();
  const { webhookSecret } = getStripeConfig();
  if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET manquant");
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
}

/**
 * @param {import('stripe').Stripe.Event} event
 */
export async function handleBillingWebhookEvent(event) {
  const type = event?.type || "";
  const id = event?.id || "";
  if (id && (await wasStripeEventProcessed(id))) {
    return { ok: true, duplicate: true, type };
  }

  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object;
      await applyCheckoutCompleted(session, getStripeConfig());
    } else if (
      type === "customer.subscription.created" ||
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      await applySubscriptionEvent(event.data.object, type);
    } else if (type === "invoice.paid") {
      // Renewal signal — subscription.updated usually covers plan; keep as no-op log
      console.info("[stripe-webhook] invoice.paid", event.data?.object?.id);
    } else {
      console.info("[stripe-webhook] ignored", type);
      if (id) await markStripeEventProcessed(id, type);
      return { ok: true, ignored: true, type };
    }

    if (id) await markStripeEventProcessed(id, type);
    return { ok: true, type };
  } catch (e) {
    console.error("[stripe-webhook] handler", type, e?.message || e);
    throw e;
  }
}

