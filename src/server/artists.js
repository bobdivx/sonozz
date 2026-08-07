import { ensureSchema, getDb, uid, saveProject } from "./db.js";
import { runCareerAgent } from "./careerAgent.js";

export function slugify(input = "") {
  return String(input)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `artiste-${Date.now().toString(36)}`;
}

async function ensureArtistSchema() {
  await ensureSchema();
  const db = getDb();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      stats_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_artists_slug ON artists(slug)
  `);

  // Colonne optionnelle sur projects (ignore si déjà présente)
  try {
    await db.execute(`ALTER TABLE projects ADD COLUMN artist_slug TEXT`);
  } catch {
    /* already exists */
  }

  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_artist_slug ON projects(artist_slug)`);
  } catch {
    /* ok */
  }
}

function stripHeavyProfile(artist = {}) {
  const clone = { ...artist };
  // garder portrait si raster raisonnable ; sinon URL seulement
  if (typeof clone.imageUrl === "string" && clone.imageUrl.startsWith("data:image/svg")) {
    clone.imageUrl = null;
  }
  if (typeof clone.imageUrl === "string" && clone.imageUrl.length > 2_500_000) {
    clone.imageUrl = null;
    clone.localAsset = true;
  }
  if (clone.voiceSample?.dataUrl) {
    const { dataUrl, ...rest } = clone.voiceSample;
    clone.voiceSample = rest;
  }
  return clone;
}

export async function upsertArtistFromProject(artist, { preferredSlug } = {}) {
  if (!artist?.name) return null;
  await ensureArtistSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const baseSlug = preferredSlug || artist.slug || slugify(artist.aka || artist.name);
  let slug = baseSlug;

  // Si le slug existe pour un autre nom, suffixer
  const existing = await db.execute({
    sql: `SELECT id, slug, name, profile_json, created_at FROM artists WHERE slug = ? LIMIT 1`,
    args: [slug],
  });

  const profile = stripHeavyProfile({ ...artist, slug });

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const prev = row.profile_json ? JSON.parse(row.profile_json) : {};
    const merged = {
      ...prev,
      ...profile,
      imageUrl: profile.imageUrl || prev.imageUrl || null,
      slug,
    };
    await db.execute({
      sql: `UPDATE artists SET name = ?, profile_json = ?, updated_at = ? WHERE slug = ?`,
      args: [merged.name || artist.name, JSON.stringify(merged), now, slug],
    });
    return { id: row.id, slug, name: merged.name, profile: merged, createdAt: row.created_at, updatedAt: now };
  }

  // collision rare: slug libre
  const id = uid("art");
  await db.execute({
    sql: `
      INSERT INTO artists (id, slug, name, profile_json, stats_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    args: [id, slug, artist.name, JSON.stringify(profile), JSON.stringify({}), now, now],
  });

  return { id, slug, name: artist.name, profile, createdAt: now, updatedAt: now };
}

function lightAssetUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("data:") && url.length <= 500_000) return url;
  return null;
}

/**
 * Importe les artistes depuis les projets existants (historique avant la table artists).
 */
export async function syncArtistsFromProjects() {
  await ensureArtistSchema();
  const db = getDb();
  // Pas de project_json entier — extraction légère uniquement
  const res = await db.execute({
    sql: `
      SELECT
        id,
        artist_name,
        artist_slug,
        updated_at,
        json_extract(project_json, '$.artist.name') AS artist_name_json,
        json_extract(project_json, '$.artist.aka') AS artist_aka,
        json_extract(project_json, '$.artist.slug') AS artist_slug_json,
        json_extract(project_json, '$.artist.bio') AS artist_bio,
        json_extract(project_json, '$.artist.genre') AS artist_genre,
        json_extract(project_json, '$.artist.city') AS artist_city,
        json_extract(project_json, '$.artist.mood') AS artist_mood,
        json_extract(project_json, '$.artist.imageUrl') AS artist_image
      FROM projects
      ORDER BY updated_at DESC
      LIMIT 200
    `,
  });

  const synced = [];
  const seen = new Set();

  for (const row of res.rows) {
    const name = row.artist_name_json || row.artist_name;
    if (!name) continue;

    const imageUrl = lightAssetUrl(row.artist_image);
    const artist = {
      name,
      aka: row.artist_aka || undefined,
      slug: row.artist_slug_json || undefined,
      bio: row.artist_bio || undefined,
      genre: row.artist_genre || undefined,
      city: row.artist_city || undefined,
      mood: row.artist_mood || undefined,
      imageUrl: imageUrl || undefined,
    };

    const preferredSlug = row.artist_slug || artist.slug || slugify(artist.aka || artist.name);
    if (seen.has(preferredSlug)) {
      await db.execute({
        sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
        args: [preferredSlug, row.id],
      });
      continue;
    }
    seen.add(preferredSlug);

    const upserted = await upsertArtistFromProject(artist, { preferredSlug });
    if (!upserted) continue;

    await db.execute({
      sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
      args: [upserted.slug, row.id],
    });
    synced.push(upserted);
  }

  return synced;
}

export async function listArtists(limit = 50) {
  await ensureArtistSchema();
  const db = getDb();

  let res = await db.execute({
    sql: `
      SELECT id, slug, name, profile_json, stats_json, created_at, updated_at
      FROM artists
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [limit],
  });

  // Auto-sync si table vide mais des projets existent
  if (res.rows.length === 0) {
    await syncArtistsFromProjects();
    res = await db.execute({
      sql: `
        SELECT id, slug, name, profile_json, stats_json, created_at, updated_at
        FROM artists
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      args: [limit],
    });
  }

  return res.rows.map((row) => {
    const profile = row.profile_json ? JSON.parse(row.profile_json) : {};
    // Index : pas de data URL lourdes (thumb http ou rien)
    if (profile.imageUrl && String(profile.imageUrl).startsWith("data:")) {
      profile.imageUrl =
        String(profile.imageUrl).length <= 200_000 ? profile.imageUrl : null;
    }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      profile,
      stats: row.stats_json ? JSON.parse(row.stats_json) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function getArtistBySlug(slug) {
  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM artists WHERE slug = ? LIMIT 1`,
    args: [slug],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    profile: row.profile_json ? JSON.parse(row.profile_json) : {},
    stats: row.stats_json ? JSON.parse(row.stats_json) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listArtistReleases(slug, limit = 40) {
  await ensureArtistSchema();
  const db = getDb();

  const artist = await getArtistBySlug(slug);
  const name = artist?.name || slug;

  // Ne jamais SELECT project_json entier (peut peser des dizaines de Mo : clip base64).
  // json_extract côté Turso ne renvoie que les champs utiles.
  const res = await db.execute({
    sql: `
      SELECT
        id,
        title,
        artist_name,
        track_title,
        status,
        artist_slug,
        created_at,
        updated_at,
        json_extract(project_json, '$.track.title') AS track_title_json,
        json_extract(project_json, '$.lyrics.title') AS lyrics_title,
        json_extract(project_json, '$.lyrics.theme') AS lyrics_theme,
        json_extract(project_json, '$.track.audioUrl') AS audio_url,
        json_extract(project_json, '$.cover.imageUrl') AS cover_url,
        json_extract(project_json, '$.distrokid.status') AS once_status,
        json_extract(project_json, '$.distrokid.provider') AS once_provider,
        json_extract(project_json, '$.distrokid.releaseId') AS release_id,
        json_extract(project_json, '$.album.status') AS album_status,
        json_extract(project_json, '$.album.title') AS album_title,
        json_extract(project_json, '$.album.targetCount') AS album_target
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [slug, name, limit],
  });

  return res.rows.map((row) => {
    const audioUrl = lightAssetUrl(row.audio_url);
    const coverUrl = lightAssetUrl(row.cover_url);
    const onceStatus = row.once_status || null;
    const hasLyrics = Boolean(row.lyrics_title || row.lyrics_theme);
    return {
      id: row.id,
      title: row.title,
      artistName: row.artist_name,
      trackTitle:
        row.track_title || row.track_title_json || row.lyrics_title || null,
      status: row.status,
      slug: row.artist_slug || slug,
      hasAudio: Boolean(row.audio_url),
      hasLyrics,
      hasCover: Boolean(row.cover_url),
      albumStatus: row.album_status || null,
      albumTitle: row.album_title || null,
      albumTargetCount: row.album_target ? Number(row.album_target) : null,
      distributed: Boolean(
        onceStatus === "submitted" || row.once_provider === "once",
      ),
      onceStatus,
      releaseId: row.release_id || null,
      coverUrl,
      audioUrl,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

/**
 * Catalogue jouable : tous les projets avec audioUrl (léger, sans project_json entier).
 */
export async function listLibraryTracks(limit = 200) {
  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        id,
        title,
        artist_name,
        track_title,
        status,
        artist_slug,
        created_at,
        updated_at,
        json_extract(project_json, '$.track.title') AS track_title_json,
        json_extract(project_json, '$.lyrics.title') AS lyrics_title,
        json_extract(project_json, '$.track.audioUrl') AS audio_url,
        json_extract(project_json, '$.cover.imageUrl') AS cover_url,
        json_extract(project_json, '$.track.duration') AS duration,
        json_extract(project_json, '$.artist.imageUrl') AS artist_image
      FROM projects
      WHERE json_extract(project_json, '$.track.audioUrl') IS NOT NULL
        AND length(json_extract(project_json, '$.track.audioUrl')) > 8
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [limit],
  });

  return res.rows
    .map((row) => {
      const audioUrl = lightAssetUrl(row.audio_url);
      if (!audioUrl) return null;
      const coverUrl = lightAssetUrl(row.cover_url);
      const artistImage = lightAssetUrl(row.artist_image);
      return {
        id: row.id,
        title: row.title,
        artistName: row.artist_name || "Artiste inconnu",
        trackTitle:
          row.track_title || row.track_title_json || row.lyrics_title || row.title || "Sans titre",
        slug: row.artist_slug || null,
        status: row.status,
        coverUrl,
        artistImage,
        audioUrl,
        duration: row.duration || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
    .filter(Boolean);
}

async function enrichStatsFromOnce(stats, releases, onceToken) {
  const {
    onceReleaseStatus,
    onceReleaseMeta,
    oncePerformanceSummary,
    onceReleasePerformance,
    normalizeOnceDelivery,
    extractOnceIdentifiers,
    publishingReadiness,
  } = await import("./once.js");

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
      } catch (e) {
        delivery[r.releaseId] = { error: e.message || "Statut ONCE indisponible" };
      }
    }),
  );

  let streams = null;
  try {
    const summary = await oncePerformanceSummary(onceToken);
    const kpis = summary?.kpis || {};
    streams = {
      fromDate: summary?.fromDate || null,
      toDate: summary?.toDate || null,
      totalStreams: kpis.totalStreams ?? 0,
      avgDailyStreams: kpis.avgDailyStreams ?? null,
      periodChangePct: kpis.periodChangePct ?? null,
      topStore: kpis.topStore || null,
      topStores: summary?.topStores || [],
      topReleases: summary?.topReleases || [],
      catalogReleases: summary?.releases || null,
      source: "once-mcp",
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
        const perf = await onceReleasePerformance(onceToken, r.releaseId, {
          includeTracks: true,
        });
        const kpis = perf?.kpis || {};
        releaseStreams[r.releaseId] = {
          fromDate: perf?.fromDate || null,
          toDate: perf?.toDate || null,
          totalStreams: kpis.totalStreams ?? 0,
          avgDailyStreams: kpis.avgDailyStreams ?? null,
          periodChangePct: kpis.periodChangePct ?? null,
          topStore: kpis.topStore || null,
          topStores: perf?.topStores || [],
          distributors: perf?.distributors || [],
          tracks: Array.isArray(perf?.tracks) ? perf.tracks : [],
          source: perf?.source || "once-mcp",
        };
      } catch (e) {
        releaseStreams[r.releaseId] = { error: e.message || "Streams KO" };
      }
    }),
  );

  const liveOnSpotify = Object.values(delivery).filter((d) =>
    /live|distributed|delivered/i.test(
      `${d.spotifyStatus || ""} ${d.aggregateStatus || ""}`,
    ),
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

export async function computeArtistStats(slug, { onceToken } = {}) {
  const artist = await getArtistBySlug(slug);
  const prev = artist?.stats || {};
  const releases = await listArtistReleases(slug, 100);
  const stats = {
    tracks: releases.length,
    withAudio: releases.filter((r) => r.hasAudio).length,
    withCover: releases.filter((r) => r.hasCover).length,
    distributed: releases.filter((r) => r.distributed || r.onceStatus === "submitted").length,
    submitted: releases.filter((r) => r.onceStatus === "submitted").length,
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
      "Rafraîchis avec ton token ONCE pour sync statut stores + streams. Sinon : Spotify for Artists / ONCE (24–72 h+ après livraison).",
    updatedAt: new Date().toISOString(),
  };

  // Sans token : ne pas écraser le dernier sync ONCE (streams / delivery)
  if (!onceToken?.trim()) {
    if (prev.streams) stats.streams = prev.streams;
    if (prev.delivery) stats.delivery = prev.delivery;
    if (prev.releaseStreams) stats.releaseStreams = prev.releaseStreams;
    if (prev.liveOnSpotify != null) stats.liveOnSpotify = prev.liveOnSpotify;
  } else {
    try {
      await enrichStatsFromOnce(stats, releases, onceToken.trim());
    } catch (e) {
      stats.streamsNote = `Enrichissement ONCE échoué : ${e.message}`;
      stats.streams = { error: e.message, source: "once-mcp" };
      // garder l’ancien delivery si le sync partiel échoue tôt
      if (prev.delivery) stats.delivery = prev.delivery;
      if (prev.releaseStreams) stats.releaseStreams = prev.releaseStreams;
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
  const releases = await listArtistReleases(slug);

  // Stats fraîches (< 10 min) : pas de recalcul (évite écritures Turso inutiles)
  const cachedAt = artist.stats?.updatedAt ? Date.parse(artist.stats.updatedAt) : 0;
  const fresh = cachedAt && Date.now() - cachedAt < 10 * 60 * 1000;
  const stats = fresh
    ? {
        ...artist.stats,
        tracks: releases.length,
        withAudio: releases.filter((r) => r.hasAudio).length,
        withCover: releases.filter((r) => r.hasCover).length,
      }
    : await computeArtistStats(slug);

  return {
    ...artist,
    stats,
    releases,
    career: artist.stats?.career || null,
  };
}

/**
 * Agent carrière (Analytics → prochain single). Persiste dans stats.career.
 */
export async function adviseArtistCareer(slug, { keys, force = false } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const prevCareer = artist.stats?.career;
  const cachedAt = prevCareer?.updatedAt ? Date.parse(prevCareer.updatedAt) : 0;
  if (!force && cachedAt && Date.now() - cachedAt < 6 * 60 * 60 * 1000) {
    return { career: prevCareer, cached: true };
  }

  const releases = await listArtistReleases(slug, 40);
  // Utilise stats déjà sync (ONCE) si présentes — pas de re-fetch obligatoire
  let stats = artist.stats || {};
  if (!stats.updatedAt) {
    stats = await computeArtistStats(slug, {
      onceToken: keys?.onceApiToken?.trim() || "",
    });
  }

  const career = await runCareerAgent({ keys, artist, releases, stats });
  const nextStats = {
    ...stats,
    career,
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET stats_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(nextStats), nextStats.updatedAt, slug],
  });

  return { career, cached: false, stats: nextStats };
}

/**
 * Nouveau projet / morceau pour un artiste existant (garde le profil).
 */
export async function createArtistRelease(slug, { theme = "", variantOf = null } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const themeHint =
    theme?.trim() ||
    (variantOf ? `Suite / variante de « ${variantOf} »` : "Nouveau single");

  const project = {
    trends: null,
    artist: { ...artist.profile, slug: artist.slug, name: artist.name },
    lyrics: null,
    track: null,
    cover: null,
    distrokid: null,
    social: null,
    clip: null,
    clips: [],
    activeClipId: null,
  };

  const seed = {
    name: artist.name,
    bioHint: artist.profile?.bio || "",
    theme: themeHint,
    market: "FR",
    artistSlug: artist.slug,
  };

  const saved = await saveProject({
    project,
    seed,
    event: {
      stepKey: "artist",
      eventType: "new-release",
      message: `Nouveau morceau pour ${artist.name}`,
      payload: { slug: artist.slug, theme: themeHint, variantOf },
    },
  });

  // Lier le slug
  const db = getDb();
  await db.execute({
    sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
    args: [artist.slug, saved.id],
  });

  return {
    projectId: saved.id,
    slug: artist.slug,
    theme: themeHint,
    studioUrl: `/?project=${saved.id}&step=3`,
  };
}

export async function linkProjectToArtist(projectId, artist) {
  if (!projectId || !artist?.name) return null;
  const upserted = await upsertArtistFromProject(artist);
  if (!upserted) return null;
  const db = getDb();
  await db.execute({
    sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
    args: [upserted.slug, projectId],
  });
  return upserted;
}

/**
 * Force le label / copyright global sur tous les profils artistes existants.
 * Utilisé quand Paramètres → Label / copyright est enregistré.
 */
export async function applyRecordLabelToAllArtists(label) {
  const value = String(label || "").trim().slice(0, 120);
  if (!value) {
    return { updated: 0, label: null };
  }

  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id, slug, name, profile_json FROM artists`,
  });
  const now = new Date().toISOString();
  let updated = 0;

  for (const row of res.rows) {
    let profile = {};
    try {
      profile = row.profile_json ? JSON.parse(row.profile_json) : {};
    } catch {
      profile = {};
    }
    if (profile.recordLabel === value) continue;
    const merged = { ...profile, recordLabel: value, slug: row.slug };
    await db.execute({
      sql: `UPDATE artists SET profile_json = ?, updated_at = ? WHERE id = ?`,
      args: [JSON.stringify(stripHeavyProfile(merged)), now, row.id],
    });
    updated += 1;
  }

  return { updated, label: value, total: res.rows.length };
}
