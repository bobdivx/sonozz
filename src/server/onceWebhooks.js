/**
 * ONCE release.status_changed webhooks — register, verify HMAC, sync carrière.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppMeta, setAppMeta, deleteAppMeta, ensureSchema, getDb } from "./db.js";
import { normalizeOnceDelivery, extractOnceIdentifiers, publishingReadiness, onceReleaseMeta } from "./once.js";

const META = {
  webhookId: "once_webhook_id",
  webhookSecret: "once_webhook_secret",
  webhookUrl: "once_webhook_url",
  onceToken: "once_api_token",
  lastEvent: "once_webhook_last_event",
};

async function onceFetch(token, path, options = {}) {
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
    registered: Boolean(id && secret),
    webhookId: id || null,
    url: url || null,
    hasSecret: Boolean(secret),
    lastEvent: last,
  };
}

export async function listOnceWebhooks(token) {
  return onceFetch(token, "/webhooks");
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

  const existingId = await getAppMeta(META.webhookId);
  if (existingId) {
    try {
      await onceFetch(token.trim(), `/webhooks/${encodeURIComponent(existingId)}`, {
        method: "DELETE",
      });
    } catch {
      /* déjà supprimé côté ONCE */
    }
  }

  const created = await onceFetch(token.trim(), "/webhooks", {
    method: "POST",
    body: JSON.stringify({
      url,
      description: description || "SONOZZ career agent",
    }),
  });

  const webhookId = created.id || created.webhookId || created.endpointId;
  const secret =
    created.signingSecret ||
    created.signing_secret ||
    created.secret ||
    created.webhookSecret;

  if (!webhookId || !secret) {
    throw new Error(
      "ONCE a créé le webhook mais n’a pas renvoyé le secret — vérifie Settings → Developer sur once.app",
    );
  }

  await setAppMeta(META.webhookId, webhookId);
  await setAppMeta(META.webhookSecret, secret);
  await setAppMeta(META.webhookUrl, url);
  await setAppMeta(META.onceToken, token.trim());

  return {
    webhookId,
    url,
    registered: true,
    secretShownOnce: true,
  };
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

export async function findProjectByOnceReleaseId(releaseId) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        id,
        artist_slug,
        artist_name,
        track_title,
        json_extract(project_json, '$.distrokid.releaseId') AS release_id,
        json_extract(project_json, '$.artist.slug') AS artist_slug_json
      FROM projects
      WHERE json_extract(project_json, '$.distrokid.releaseId') = ?
      LIMIT 1
    `,
    args: [releaseId],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    projectId: row.id,
    releaseId: row.release_id || releaseId,
    artistSlug: row.artist_slug || row.artist_slug_json || null,
    artistName: row.artist_name || null,
    trackTitle: row.track_title || null,
  };
}

function deliveryFromWebhookPayload(payload = {}) {
  const storesRaw = payload.storeStatuses || [];
  const fakeStatus = {
    aggregateStatus: payload.status || null,
    storeStatuses: storesRaw,
  };
  return normalizeOnceDelivery(fakeStatus);
}

/**
 * Traite un event signé : maj delivery + ISRC + conseil carrière.
 */
export async function handleOnceStatusChanged(payload = {}) {
  const releaseId = payload.releaseId || payload.release_id;
  if (!releaseId) {
    return { ok: false, skipped: true, reason: "releaseId manquant" };
  }

  const matched = await findProjectByOnceReleaseId(releaseId);
  const deliveryPatch = deliveryFromWebhookPayload(payload);

  let identifiers = { upc: null, isrc: null, tracks: [], upcPending: true, isrcPending: true };
  const onceToken = await getAppMeta(META.onceToken);
  if (onceToken) {
    try {
      const meta = await onceReleaseMeta(onceToken, releaseId);
      identifiers = extractOnceIdentifiers(meta);
    } catch {
      /* payload seul suffit pour le statut stores */
    }
  }

  const publishing = publishingReadiness({
    delivery: deliveryPatch,
    identifiers,
  });

  const enrichedDelivery = {
    ...deliveryPatch,
    identifiers,
    publishing,
    dashboardUrl: `https://beta.once.app/releases/${releaseId}`,
    publishingUrl: `https://beta.once.app/releases/${releaseId}`,
    webhookAt: payload.occurredAt || new Date().toISOString(),
    previousStatus: payload.previousStatus || null,
  };

  let career = null;
  let slug = matched?.artistSlug || null;

  if (slug && onceToken) {
    const { computeArtistStats, adviseArtistCareer } = await import("./artists.js");
    // Merge delivery patch into stats via full refresh of this release path
    await computeArtistStats(slug, { onceToken });
    // Overlay webhook delivery (fresher than poll)
    const { getArtistBySlug } = await import("./artists.js");
    const artist = await getArtistBySlug(slug);
    if (artist?.stats) {
      const stats = {
        ...artist.stats,
        delivery: {
          ...(artist.stats.delivery || {}),
          [releaseId]: {
            ...(artist.stats.delivery?.[releaseId] || {}),
            ...enrichedDelivery,
          },
        },
        updatedAt: new Date().toISOString(),
      };
      const unisonReady = Object.values(stats.delivery).filter(
        (d) => d?.publishing?.canSubmitUnison,
      ).length;
      stats.unisonReady = unisonReady;
      const db = getDb();
      await db.execute({
        sql: `UPDATE artists SET stats_json = ?, updated_at = ? WHERE slug = ?`,
        args: [JSON.stringify(stats), stats.updatedAt, slug],
      });
    }
    const advice = await adviseArtistCareer(slug, {
      keys: { onceApiToken: onceToken },
      force: true,
    });
    career = advice.career;
  } else if (matched?.projectId) {
    // Pas de slug artiste — log seulement
  }

  const summary = {
    event: payload.event || "release.status_changed",
    releaseId,
    status: payload.status || null,
    previousStatus: payload.previousStatus || null,
    projectId: matched?.projectId || null,
    artistSlug: slug,
    publishing: publishing.status,
    canSubmitUnison: publishing.canSubmitUnison,
    careerVerdict: career?.verdict || null,
    at: new Date().toISOString(),
  };

  await setAppMeta(META.lastEvent, JSON.stringify(summary));

  return {
    ok: true,
    ...summary,
    career,
  };
}

export async function getStoredWebhookSecret() {
  return getAppMeta(META.webhookSecret);
}
