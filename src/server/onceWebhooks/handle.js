/**
 * ONCE webhooks — delivery handling + career sync.
 */
import { ensureSchema, getDb, getAppMeta, setAppMeta } from "../db.js";
import { normalizeOnceDelivery, extractOnceIdentifiers, publishingReadiness, onceReleaseMeta } from "../once.js";
import { META } from "./verify.js";

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

export function deliveryFromWebhookPayload(payload = {}) {
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
    const { computeArtistStats, adviseArtistCareer } = await import("../artists.js");
    // Merge delivery patch into stats via full refresh of this release path
    await computeArtistStats(slug, { onceToken });
    // Overlay webhook delivery (fresher than poll)
    const { getArtistBySlug } = await import("../artists.js");
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
