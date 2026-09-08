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
 * Note: the `stripe` npm package is temporarily omitted from package.json until
 * package-lock.json is synced (npm ci). Checkout stays stubbed until then.
 *
 * Default public base when unset: https://sonozz.briseteia.me
 */

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
  // Package removed temporarily — treat as not configured so UI can soft-fail.
  return false;
}

/**
 * Stripe Node SDK client — unavailable until `stripe` is back in package-lock.
 */
export function getStripe() {
  throw new Error(
    "SDK Stripe temporairement désactivé (dépendance retirée le temps de synchroniser package-lock).",
  );
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
  void plan;
  void customerEmail;
  void clientReferenceId;
  getStripe();
}

/**
 * Verify Stripe webhook signature and return the Event.
 * @param {Buffer|Uint8Array|string} rawBody
 * @param {string} signatureHeader
 */
export function constructWebhookEvent(rawBody, signatureHeader) {
  void rawBody;
  void signatureHeader;
  getStripe();
}

/**
 * Minimal handler: log + stub plan update (DB wiring later).
 * @param {any} event
 */
export async function handleBillingWebhookEvent(event) {
  const type = event?.type || "";
  console.info("[stripe-webhook] stub (SDK offline)", type);
  return { ok: true, ignored: true, type, stub: true };
}
