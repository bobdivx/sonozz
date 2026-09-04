/**
 * ONCE webhooks — register / unregister endpoints.
 */
import { getAppMeta, setAppMeta, deleteAppMeta } from "../db.js";
import { META } from "./verify.js";
import { getOnceWebhookConfig } from "./verify.js";

export async function onceFetch(token, path, options = {}) {
  const res = await fetch(`https://once.app/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Once-Provenance": "SONOZZ",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || data.code || `ONCE HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function listOnceWebhooks(token) {
  return onceFetch(token, "/webhooks");
}

function webhookListItems(remote) {
  if (Array.isArray(remote)) return remote;
  if (Array.isArray(remote?.endpoints)) return remote.endpoints;
  if (Array.isArray(remote?.webhooks)) return remote.webhooks;
  if (Array.isArray(remote?.data)) return remote.data;
  return [];
}

function extractCreatedWebhook(created = {}) {
  const bags = [
    created,
    created.endpoint,
    created.webhook,
    created.data,
    created.result,
    created.record,
  ].filter((x) => x && typeof x === "object" && !Array.isArray(x));

  for (const bag of bags) {
    const webhookId = bag.id || bag.webhookId || bag.endpointId || bag.uuid || null;
    const secret =
      bag.signingSecret ||
      bag.signing_secret ||
      bag.secret ||
      bag.webhookSecret ||
      bag.webhook_secret ||
      bag.signingKey ||
      bag.signing_key ||
      null;
    if (webhookId || secret) {
      return {
        webhookId: webhookId ? String(webhookId) : null,
        secret: secret ? String(secret) : null,
        keys: Object.keys(bag),
      };
    }
  }
  return { webhookId: null, secret: null, keys: Object.keys(created || {}) };
}

export async function deleteRemoteWebhook(token, id) {
  if (!id) return;
  try {
    await onceFetch(token, `/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    /* déjà supprimé / inconnu */
  }
}

/**
 * Enregistre (ou remplace) l’endpoint SONOZZ auprès d’ONCE.
 * Le signing secret n’est renvoyé qu’à la création — on le stocke dans Turso.
 */
export async function registerOnceWebhook({ token, publicBaseUrl, description }) {
  if (!token?.trim()) throw new Error("Token ONCE requis");
  const base = String(publicBaseUrl || "").replace(/\/$/, "");
  if (!/^https:\/\//i.test(base)) {
    throw new Error("URL publique HTTPS requise (ONCE refuse localhost / http).");
  }
  const url = `${base}/api/once/webhook`;
  const pat = token.trim();

  const existingId = await getAppMeta(META.webhookId);
  if (existingId) await deleteRemoteWebhook(pat, existingId);

  // Nettoie les orphelins SONOZZ déjà listés côté ONCE (tunnel + prod, etc.)
  try {
    const remote = await listOnceWebhooks(pat);
    for (const item of webhookListItems(remote)) {
      const itemUrl = String(item.url || item.endpointUrl || "");
      const itemId = item.id || item.webhookId || item.endpointId;
      if (itemId && (itemUrl.includes("/api/once/webhook") || itemUrl === url)) {
        await deleteRemoteWebhook(pat, itemId);
      }
    }
  } catch {
    /* list KO — on tente quand même le POST */
  }

  // Fetch brut : le secret one-shot peut être dans le body OU un header
  const createRes = await fetch("https://once.app/v1/webhooks", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      "X-Once-Provenance": "SONOZZ",
    },
    body: JSON.stringify({
      url,
      description: description || "SONOZZ career agent",
    }),
  });
  const created = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const msg =
      created.message || created.error || created.code || `ONCE HTTP ${createRes.status}`;
    const err = new Error(msg);
    err.status = createRes.status;
    err.data = created;
    throw err;
  }

  let { webhookId, secret, keys } = extractCreatedWebhook(created);
  if (!secret) {
    const headerSecret =
      createRes.headers.get("x-once-signing-secret") ||
      createRes.headers.get("x-once-webhook-secret") ||
      createRes.headers.get("x-webhook-secret") ||
      createRes.headers.get("x-signing-secret");
    if (headerSecret) secret = headerSecret.trim();
  }

  if (!webhookId) {
    try {
      const listed = await listOnceWebhooks(pat);
      const match = webhookListItems(listed).find(
        (item) => String(item.url || item.endpointUrl || "") === url,
      );
      if (match) {
        webhookId = String(match.id || match.webhookId || match.endpointId || "") || null;
      }
    } catch {
      /* ignore */
    }
  }

  if (webhookId) await setAppMeta(META.webhookId, webhookId);
  await setAppMeta(META.webhookUrl, url);
  await setAppMeta(META.onceToken, pat);

  if (!secret) {
    // Endpoint créé côté ONCE mais secret perdu pour nous — UI peut coller le secret
    // si encore visible à la création, sinon supprimer + réactiver.
    const err = new Error(
      "ONCE a créé le webhook mais n’a pas renvoyé le secret. Copie-le immédiatement dans Paramètres (champ secret), ou supprime l’endpoint dans once.app → Settings → Developer puis réactive ici.",
    );
    err.code = "ONCE_WEBHOOK_SECRET_MISSING";
    err.webhookId = webhookId;
    err.url = url;
    err.responseKeys = keys;
    throw err;
  }

  await setAppMeta(META.webhookSecret, secret);

  return {
    webhookId,
    url,
    registered: true,
    hasSecret: true,
    secretShownOnce: true,
  };
}

/**
 * Branche un secret déjà affiché une fois (création UI ONCE ou réponse API ratée).
 */
export async function setOnceWebhookSecret({ secret, webhookId, url, token } = {}) {
  const value = String(secret || "").trim();
  if (!value) throw new Error("Secret webhook requis");
  if (webhookId?.trim()) await setAppMeta(META.webhookId, webhookId.trim());
  if (url?.trim()) await setAppMeta(META.webhookUrl, url.trim());
  if (token?.trim()) await setAppMeta(META.onceToken, token.trim());
  await setAppMeta(META.webhookSecret, value);
  return getOnceWebhookConfig();
}

export async function unregisterOnceWebhook({ token } = {}) {
  const id = await getAppMeta(META.webhookId);
  const storedToken = token?.trim() || (await getAppMeta(META.onceToken));
  if (id && storedToken) {
    try {
      await onceFetch(storedToken, `/webhooks/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* ignore */
    }
  }
  await deleteAppMeta(META.webhookId);
  await deleteAppMeta(META.webhookSecret);
  await deleteAppMeta(META.webhookUrl);
  return { ok: true };
}
