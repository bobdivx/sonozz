/**
 * ONCE release.status_changed webhooks — verify HMAC + secret storage.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppMeta, setAppMeta } from "../db.js";

export const META = {
  webhookId: "once_webhook_id",
  webhookSecret: "once_webhook_secret",
  webhookUrl: "once_webhook_url",
  onceToken: "once_api_token",
  lastEvent: "once_webhook_last_event",
};

export function verifyOnceWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expectedHex = createHmac("sha256", secret).update(raw).digest("hex");
  const expected = `sha256=${expectedHex}`;
  const provided = String(signatureHeader).trim();
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function getOnceWebhookConfig() {
  const [id, url, secret, lastEvent] = await Promise.all([
    getAppMeta(META.webhookId),
    getAppMeta(META.webhookUrl),
    getAppMeta(META.webhookSecret),
    getAppMeta(META.lastEvent),
  ]);
  let last = null;
  try {
    last = lastEvent ? JSON.parse(lastEvent) : null;
  } catch {
    last = null;
  }
  return {
    registered: Boolean(secret && (id || url)),
    webhookId: id || null,
    url: url || null,
    hasSecret: Boolean(secret),
    lastEvent: last,
  };
}

export async function getStoredWebhookSecret() {
  return getAppMeta(META.webhookSecret);
}
