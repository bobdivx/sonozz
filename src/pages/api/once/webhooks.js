import { json, error, readBody } from "../../../server/http.js";
import {
  registerOnceWebhook,
  unregisterOnceWebhook,
  getOnceWebhookConfig,
  listOnceWebhooks,
  setOnceWebhookSecret,
} from "../../../server/onceWebhooks.js";

export const prerender = false;

export async function GET({ request }) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token") || "";
    const config = await getOnceWebhookConfig();
    let remote = null;
    if (token.trim()) {
      try {
        remote = await listOnceWebhooks(token.trim());
      } catch (e) {
        remote = { error: e.message };
      }
    }
    return json({ config, remote });
  } catch (e) {
    return error(e.message || "Lecture webhooks KO", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const action = body.action || "register";
    const token = body.keys?.onceApiToken?.trim() || body.onceApiToken?.trim() || "";

    if (action === "status") {
      return json({ config: await getOnceWebhookConfig() });
    }

    if (action === "unregister") {
      await unregisterOnceWebhook({ token });
      return json({ ok: true, config: await getOnceWebhookConfig() });
    }

    if (action === "set_secret") {
      const config = await setOnceWebhookSecret({
        secret: body.secret || body.signingSecret || "",
        webhookId: body.webhookId || "",
        url: body.webhookUrl || body.url || "",
        token,
      });
      return json({
        ok: true,
        config,
        note: "Secret enregistré. Les prochains release.status_changed seront vérifiés en HMAC.",
      });
    }

    if (action === "register") {
      if (!token) return error("Token ONCE manquant", 400);
      const publicBaseUrl =
        body.publicBaseUrl ||
        body.url ||
        request.headers.get("origin") ||
        "";
      const result = await registerOnceWebhook({
        token,
        publicBaseUrl,
        description: body.description || "SONOZZ career agent",
      });
      return json({
        ok: true,
        ...result,
        config: await getOnceWebhookConfig(),
        note: "Secret stocké côté serveur (Turso). ONCE poussera release.status_changed ici.",
      });
    }

    return error("Action inconnue", 400);
  } catch (e) {
    if (e.code === "ONCE_WEBHOOK_SECRET_MISSING") {
      return json(
        {
          error: e.message || "Secret manquant",
          code: e.code,
          webhookId: e.webhookId || null,
          url: e.url || null,
          responseKeys: e.responseKeys || [],
          config: await getOnceWebhookConfig(),
        },
        422,
      );
    }
    return error(e.message || "Webhook ONCE KO", 500);
  }
}
