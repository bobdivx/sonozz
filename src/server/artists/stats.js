import { getDb, saveProject, getProject, getUserKeys } from "../db.js";
import { getArtistBySlug } from "./crud.js";
import { listArtistReleases } from "./releases.js";

export function needsOnceEnrich(stats = {}, releases = []) {
  const withIds = (releases || []).filter((r) => r.releaseId);
  if (!withIds.length) return false;
  const delivery = stats?.delivery || {};
  return withIds.some((r) => {
    const d = delivery[r.releaseId];
    return !d || d.error;
  });
}

async function persistReleaseDelivery(projectId, releaseId, delivery) {
  if (!projectId || !releaseId || !delivery || delivery.error) return;
  try {
    const row = await getProject(projectId);
    if (!row?.project) return;
    const prev = row.project.distrokid || {};
    if (prev.releaseId && String(prev.releaseId) !== String(releaseId)) return;
    const live = /live|distributed|delivered|success/i.test(
      `${delivery.spotifyStatus || ""} ${delivery.aggregateStatus || ""}`,
    );
    await saveProject({
      id: projectId,
      seed: row.seed || {},
      project: {
        ...row.project,
        distrokid: {
          ...prev,
          releaseId,
          delivery,
          spotifyUrl: delivery.spotifyUrl || prev.spotifyUrl || null,
          status: live ? "live" : prev.status,
        },
      },
    });
  } catch {
    /* non bloquant */
  }
}

async function enrichStatsFromOnce(stats, releases, onceToken, { keys } = {}) {
  const {
    onceReleaseStatus,
    onceReleaseMeta,
    oncePerformanceSummary,
    onceReleasePerformance,
    normalizeOnceDelivery,
    normalizeOncePerformance,
    extractOnceIdentifiers,
    publishingReadiness,
  } = await import("../once.js");

  const withIds = releases.filter((r) => r.releaseId);
  const delivery = {};
  const releaseStreams = {};

  await Promise.all(
    withIds.slice(0, 20).map(async (r) => {
      try {
        const [rawStatus, rawMeta] = await Promise.all([
          onceReleaseStatus(onceToken, r.releaseId),
          onceReleaseMeta(onceToken, r.releaseId).catch(() => null),
        ]);
        const normalized = normalizeOnceDelivery(rawStatus);
        if (!normalized.spotifyUrl && keys) {
          try {
            const { findSpotifyCatalogMatch } = await import("../spotify.js");
            const found = await findSpotifyCatalogMatch(keys, {
              artistName: r.artistName || "",
              trackTitle: r.trackTitle || r.title || "",
            });
            if (found?.url) {
              normalized.spotifyUrl = found.url;
              if (!normalized.spotifyStatus) normalized.spotifyStatus = "Live";
              const already = (normalized.stores || []).some((s) => /spotify/i.test(s.name));
              if (!already) {
                normalized.stores = [
                  ...(normalized.stores || []),
                  { name: "Spotify", status: "Live", url: found.url, storeId: "spotify-search" },
                ];
              } else {
                normalized.stores = (normalized.stores || []).map((s) =>
                  /spotify/i.test(s.name)
                    ? { ...s, url: s.url || found.url, status: s.status || "Live" }
                    : s,
                );
              }
            }
          } catch {
            /* Spotify optionnel */
          }
        }
        const identifiers = rawMeta
          ? extractOnceIdentifiers(rawMeta)
          : { upc: null, isrc: null, tracks: [], upcPending: true, isrcPending: true };
        const publishing = publishingReadiness({
          delivery: normalized,
          identifiers,
        });
        delivery[r.releaseId] = {
          ...normalized,
          identifiers,
          publishing,
          dashboardUrl: `https://beta.once.app/releases/${r.releaseId}`,
          publishingUrl: `https://beta.once.app/releases/${r.releaseId}`,
        };
        await persistReleaseDelivery(r.id, r.releaseId, delivery[r.releaseId]);
      } catch (e) {
        delivery[r.releaseId] = { error: e.message || "Statut ONCE indisponible" };
      }
    }),
  );

  let streams = null;
  try {
    const rawSummary = await oncePerformanceSummary(onceToken);
    const summary = normalizeOncePerformance(rawSummary);
    streams = {
      ...summary,
      topReleases: rawSummary?.topReleases || [],
      catalogReleases: rawSummary?.releases || null,
      source: summary.source || "once-mcp",
    };
  } catch (e) {
    streams = {
      error: e.message || "Analytics ONCE indisponibles",
      source: "once-mcp",
    };
  }

  // Per-release streams for hub catalogue (cap to avoid rate limits)
  await Promise.all(
    withIds.slice(0, 8).map(async (r) => {
      try {
        releaseStreams[r.releaseId] = normalizeOncePerformance(
          await onceReleasePerformance(onceToken, r.releaseId, {
            includeTracks: true,
          }),
        );
      } catch (e) {
        releaseStreams[r.releaseId] = { error: e.message || "Streams KO" };
      }
    }),
  );

  const liveOnSpotify = Object.values(delivery).filter(
    (d) =>
      /live|distributed|delivered|success/i.test(
        `${d.spotifyStatus || ""} ${d.aggregateStatus || ""}`,
      ) || Boolean(d.spotifyUrl),
  ).length;

  const unisonReady = Object.values(delivery).filter((d) => d.publishing?.canSubmitUnison).length;

  stats.delivery = delivery;
  stats.releaseStreams = releaseStreams;
  stats.streams = streams;
  stats.liveOnSpotify = liveOnSpotify;
  stats.unisonReady = unisonReady;
  stats.releases = (stats.releases || []).map((r) => ({
    ...r,
    delivery: r.releaseId ? delivery[r.releaseId] || null : null,
    streams: r.releaseId ? releaseStreams[r.releaseId] || null : null,
  }));

  if (streams && !streams.error) {
    const change =
      streams.periodChangePct == null
        ? ""
        : ` (${streams.periodChangePct > 0 ? "+" : ""}${streams.periodChangePct}% vs période préc.)`;
    const unisonBit =
      unisonReady > 0 ? ` · ${unisonReady} titre(s) prêt(s) Unison` : "";
    stats.streamsNote = `ONCE · ${streams.totalStreams ?? 0} streams (30 j)${change}${unisonBit}. Revenus via ONCE / Spotify for Artists.`;
  } else if (streams?.error) {
    stats.streamsNote = `Stats catalogue OK. Streams ONCE : ${streams.error}. Vérifie le token ONCE ou ouvre Spotify for Artists.`;
  }

  return stats;
}

export async function computeArtistStats(slug, { onceToken, keys, syncOnce = true } = {}) {
  const artist = await getArtistBySlug(slug);
  const prev = artist?.stats || {};
  const releases = await listArtistReleases(slug, 100, { artistName: artist?.name });
  const storedKeys = keys && typeof keys === "object" ? keys : (await getUserKeys()) || {};
  const token = String(onceToken || storedKeys.onceApiToken || "").trim();
  const stats = {
    tracks: releases.length,
    withAudio: releases.filter((r) => r.hasAudio).length,
    withCover: releases.filter((r) => r.hasCover).length,
    distributed: releases.filter((r) => r.distributed || r.onceStatus === "submitted" || r.onceStatus === "live").length,
    submitted: releases.filter((r) => r.onceStatus === "submitted" || r.onceStatus === "live").length,
    draftOnly: releases.filter((r) => r.onceStatus === "draft-only").length,
    lastReleaseAt: releases[0]?.updatedAt || null,
    releases: releases.slice(0, 12).map((r) => ({
      id: r.id,
      title: r.trackTitle || r.title,
      status: r.onceStatus || r.status,
      releaseId: r.releaseId,
      delivery: r.releaseId && prev.delivery?.[r.releaseId] ? prev.delivery[r.releaseId] : null,
      streams: r.releaseId && prev.releaseStreams?.[r.releaseId] ? prev.releaseStreams[r.releaseId] : null,
    })),
    links: {
      once: "https://once.app/",
      spotifyForArtists: "https://artists.spotify.com/",
    },
    streamsNote:
      prev.streamsNote ||
      "Statut stores et streams ONCE se synchronisent automatiquement (token dans Paramètres). Sinon : Spotify for Artists / ONCE (24–72 h+ après livraison).",
    updatedAt: new Date().toISOString(),
  };

  // Sans token / syncOnce=false : ne pas écraser le dernier sync ONCE (streams / delivery)
  if (!syncOnce || !token) {
    if (prev.streams) stats.streams = prev.streams;
    if (prev.delivery) stats.delivery = prev.delivery;
    if (prev.releaseStreams) stats.releaseStreams = prev.releaseStreams;
    if (prev.liveOnSpotify != null) stats.liveOnSpotify = prev.liveOnSpotify;
    if (prev.career) stats.career = prev.career;
    if (prev.unisonReady != null) stats.unisonReady = prev.unisonReady;
  } else {
    try {
      await enrichStatsFromOnce(stats, releases, token, { keys: storedKeys });
    } catch (e) {
      stats.streamsNote = `Enrichissement ONCE échoué : ${e.message}`;
      stats.streams = { error: e.message, source: "once-mcp" };
      // garder l’ancien delivery si le sync partiel échoue tôt
      if (prev.delivery) stats.delivery = prev.delivery;
      if (prev.releaseStreams) stats.releaseStreams = prev.releaseStreams;
      if (prev.career) stats.career = prev.career;
    }
  }

  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET stats_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(stats), stats.updatedAt, slug],
  });

  return stats;
}

export async function getArtistHub(slug) {
  const artist = await getArtistBySlug(slug);
  if (!artist) return null;
  const releases = await listArtistReleases(slug, 40, { artistName: artist.name });

  const cachedAt = artist.stats?.updatedAt ? Date.parse(artist.stats.updatedAt) : 0;
  const fresh = cachedAt && Date.now() - cachedAt < 10 * 60 * 1000;

  // GET hub : jamais de sync ONCE réseau (bloque 2–20 s). Stats locales / cache seulement.
  const stats = fresh
    ? {
        ...artist.stats,
        tracks: releases.length,
        withAudio: releases.filter((r) => r.hasAudio).length,
        withCover: releases.filter((r) => r.hasCover).length,
      }
    : await computeArtistStats(slug, { syncOnce: false });

  const { listAlbumsByArtist } = await import("../db.js");
  const albums = await listAlbumsByArtist(slug);
  const storedKeys = (await getUserKeys()) || {};
  const onceToken = String(storedKeys.onceApiToken || "").trim();
  const statsNeedSync = Boolean(onceToken) && needsOnceEnrich(stats, releases);

  return {
    ...artist,
    stats,
    releases,
    albums,
    career: stats?.career || artist.stats?.career || null,
    statsNeedSync,
  };
}
