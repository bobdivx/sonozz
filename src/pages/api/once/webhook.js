import { json, error } from "../../../server/http.js";
import {
  verifyOnceWebhookSignature,
  getStoredWebhookSecret,
  handleOnceStatusChanged,
} from "../../../server/onceWebhooks.js";

export const prerender = false;

/**
 * Récepteur ONCE release.status_changed (HMAC sha256=…).
 * Doit être HTTPS public — enregistré via POST /api/once/webhooks.
 */
export async function POST({ request }) {
  try {
    const raw = Buffer.from(await request.arrayBuffer());
    const signature =
      request.headers.get("x-once-signature") ||
      request.headers.get("X-Once-Signature") ||
      "";
    const eventHeader =
      request.headers.get("x-once-event") ||
      request.headers.get("X-Once-Event") ||
      "";

    const secret = await getStoredWebhookSecret();
    if (!secret) {
      return error("Webhook ONCE non configuré (secret manquant)", 503);
    }
    if (!verifyOnceWebhookSignature(raw, signature, secret)) {
      return error("Signature ONCE invalide", 401);
    }

    let payload = {};
    try {
      payload = JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return error("Body JSON invalide", 400);
    }

    const event = payload.event || eventHeader;
    if (event && event !== "release.status_changed") {
      return json({ ok: true, ignored: true, event });
    }

    const result = await handleOnceStatusChanged(payload);
    return json(result);
  } catch (e) {
    console.error("[once-webhook]", e);
    return error(e.message || "Webhook ONCE échoué", 500);
  }
}

/** Health / découverte (ONCE peut ping). */
export async function GET() {
  return json({
    ok: true,
    endpoint: "/api/once/webhook",
    events: ["release.status_changed"],
  });
}
