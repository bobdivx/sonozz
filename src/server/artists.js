import { ensureSchema, getDb, uid, saveProject, getProject, getUserKeys } from "./db.js";
import { runCareerAgent } from "./careerAgent.js";
import { resolveArtistGender, withResolvedArtistGender } from "../lib/artistGender.js";
import { applyArtistPhotoPatch, listArtistImageUrl, normalizeArtistPhotos } from "../lib/artistPhotos.js";
import { generateVisual } from "./images.js";

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

/** Évite qu’un sync partiel écrase gender / voice / genderLock avec `undefined`. */
function omitUndefined(obj = {}) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function hasVoiceSample(sample) {
  return Boolean(sample && (sample.s3Key || sample.url || sample.dataUrl));
}

/** Score pour choisir le profil studio le plus complet (style, voix, genre…). */
function profileRichness(artist = {}) {
  let score = 0;
  if (resolveArtistGender(artist)) score += 6;
  if (artist.styleLock && typeof artist.styleLock === "object") score += 12;
  if (hasVoiceSample(artist.voiceSample)) score += 10;
  if (artist.genre || (Array.isArray(artist.genres) && artist.genres.length)) score += 4;
  if (artist.voice) score += 2;
  if (artist.mood) score += 1;
  if (artist.language) score += 1;
  if (artist.styleArtist || (Array.isArray(artist.styleArtists) && artist.styleArtists.length)) {
    score += 3;
  }
  if (artist.visualIdentity?.genderLock || artist.visualIdentity?.portraitPrompt) score += 3;
  if (artist.portraitPrompt) score += 2;
  if (artist.imageUrl) score += 1;
  if (artist.influences?.length) score += 1;
  if (artist.age) score += 1;
  return score;
}

function mergeArtistProfile(prev = {}, incoming = {}) {
  const profile = omitUndefined(incoming);
  const photos = applyArtistPhotoPatch(prev, incoming);
  const merged = {
    ...prev,
    ...profile,
    imageUrl: photos.imageUrl,
    photos: photos.photos,
    slug: profile.slug || prev.slug,
    name: profile.name || prev.name,
  };
  // Ne jamais perdre l’identité vocale / style d’un sync partiel
  if (!merged.gender && prev.gender) merged.gender = prev.gender;
  if (!merged.voice && prev.voice) merged.voice = prev.voice;
  if (!merged.mood && prev.mood) merged.mood = prev.mood;
  if (!merged.language && prev.language) merged.language = prev.language;
  if (!merged.genre && prev.genre) merged.genre = prev.genre;
  if (
    !(Array.isArray(merged.genres) && merged.genres.length) &&
    Array.isArray(prev.genres) &&
    prev.genres.length
  ) {
    merged.genres = prev.genres;
  }
  if (!merged.styleLock && prev.styleLock) merged.styleLock = prev.styleLock;
  if (!merged.styleArtist && prev.styleArtist) merged.styleArtist = prev.styleArtist;
  if (
    !(Array.isArray(merged.styleArtists) && merged.styleArtists.length) &&
    Array.isArray(prev.styleArtists) &&
    prev.styleArtists.length
  ) {
    merged.styleArtists = prev.styleArtists;
  }
  if (!hasVoiceSample(merged.voiceSample) && hasVoiceSample(prev.voiceSample)) {
    merged.voiceSample = prev.voiceSample;
  }
  if (!merged.portraitPrompt && prev.portraitPrompt) {
    merged.portraitPrompt = prev.portraitPrompt;
  }
  merged.visualIdentity = {
    ...(prev.visualIdentity || {}),
    ...(profile.visualIdentity || {}),
  };
  if (!merged.visualIdentity.genderLock && prev.visualIdentity?.genderLock) {
    merged.visualIdentity.genderLock = prev.visualIdentity.genderLock;
  }
  if (!merged.visualIdentity.portraitPrompt && prev.visualIdentity?.portraitPrompt) {
    merged.visualIdentity.portraitPrompt = prev.visualIdentity.portraitPrompt;
  }
  if (!Object.keys(merged.visualIdentity).length) delete merged.visualIdentity;
  return withResolvedArtistGender(merged);
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

  const incoming = stripHeavyProfile(withResolvedArtistGender({ ...artist, slug }));

  if (existing.rows[0]) {
    const row = existing.rows[0];
    const prev = row.profile_json ? JSON.parse(row.profile_json) : {};
    const merged = mergeArtistProfile(prev, incoming);
    await db.execute({
      sql: `UPDATE artists SET name = ?, profile_json = ?, updated_at = ? WHERE slug = ?`,
      args: [merged.name || artist.name, JSON.stringify(merged), now, slug],
    });
    return { id: row.id, slug, name: merged.name, profile: merged, createdAt: row.created_at, updatedAt: now };
  }

  // collision rare: slug libre
  const id = uid("art");
  const profile = incoming;
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
        json_extract(project_json, '$.artist.gender') AS artist_gender,
        json_extract(project_json, '$.artist.voice') AS artist_voice,
        json_extract(project_json, '$.artist.age') AS artist_age,
        json_extract(project_json, '$.artist.language') AS artist_language,
        json_extract(project_json, '$.artist.visualIdentity.genderLock') AS artist_gender_lock,
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
    const artist = omitUndefined({
      name,
      aka: row.artist_aka || undefined,
      slug: row.artist_slug_json || undefined,
      bio: row.artist_bio || undefined,
      genre: row.artist_genre || undefined,
      city: row.artist_city || undefined,
      mood: row.artist_mood || undefined,
      gender: row.artist_gender || undefined,
      voice: row.artist_voice || undefined,
      age: row.artist_age != null ? row.artist_age : undefined,
      language: row.artist_language || undefined,
      visualIdentity: row.artist_gender_lock
        ? { genderLock: row.artist_gender_lock }
        : undefined,
      imageUrl: imageUrl || undefined,
    });

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
    profile.imageUrl = listArtistImageUrl(row.slug, profile, row.updated_at);
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
        json_extract(project_json, '$.track.status') AS track_status,
        json_extract(project_json, '$.cover.imageUrl') AS cover_url,
        json_extract(project_json, '$.album.cover.imageUrl') AS album_cover_url,
        json_extract(project_json, '$.distrokid.status') AS once_status,
        json_extract(project_json, '$.distrokid.provider') AS once_provider,
        json_extract(project_json, '$.distrokid.releaseId') AS release_id,
        json_extract(project_json, '$.album.status') AS album_status,
        json_extract(project_json, '$.album.title') AS album_title,
        json_extract(project_json, '$.album.id') AS album_id,
        json_extract(project_json, '$.album.targetCount') AS album_target,
        json_extract(project_json, '$.albumMeta.leadProjectId') AS album_lead_id,
        json_extract(project_json, '$.albumMeta.albumTitle') AS album_meta_title,
        json_extract(project_json, '$.albumMeta.index') AS album_index
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [slug, name, limit],
  });

  return res.rows.map((row) => {
    const pendingReview =
      String(row.track_status || "") === "pending-review" ||
      String(row.track_status || "") === "preview-ready";
    const audioUrl = pendingReview ? null : lightAssetUrl(row.audio_url);
    const coverUrl = lightAssetUrl(row.cover_url) || lightAssetUrl(row.album_cover_url);
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
      hasAudio: Boolean(audioUrl),
      hasLyrics,
      hasCover: Boolean(row.cover_url || row.album_cover_url),
      albumStatus: row.album_status || null,
      albumTitle: row.album_title || row.album_meta_title || null,
      albumTargetCount: row.album_target ? Number(row.album_target) : null,
      albumId: row.album_id || null,
      albumLeadId: row.album_lead_id || (row.album_status ? row.id : null),
      albumIndex: row.album_index != null ? Number(row.album_index) : row.album_status ? 1 : null,
      distributed: Boolean(
        onceStatus === "submitted" ||
          onceStatus === "live" ||
          row.once_provider === "once",
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
        json_extract(project_json, '$.track.status') AS track_status,
        json_extract(project_json, '$.cover.imageUrl') AS cover_url,
        json_extract(project_json, '$.album.cover.imageUrl') AS album_cover_url,
        json_extract(project_json, '$.track.duration') AS duration,
        json_extract(project_json, '$.artist.imageUrl') AS artist_image
      FROM projects
      WHERE json_extract(project_json, '$.track.audioUrl') IS NOT NULL
        AND length(json_extract(project_json, '$.track.audioUrl')) > 8
        AND (
          json_extract(project_json, '$.track.status') IS NULL
          OR (
            json_extract(project_json, '$.track.status') != 'pending-review'
            AND json_extract(project_json, '$.track.status') != 'preview-ready'
          )
        )
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [limit],
  });

  return res.rows
    .map((row) => {
      if (
        String(row.track_status || "") === "pending-review" ||
        String(row.track_status || "") === "preview-ready"
      )
        return null;
      const audioUrl = lightAssetUrl(row.audio_url);
      if (!audioUrl) return null;
      const coverUrl = lightAssetUrl(row.cover_url) || lightAssetUrl(row.album_cover_url);
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
        if (!normalized.spotifyUrl && keys) {
          try {
            const { findSpotifyCatalogMatch } = await import("./spotify.js");
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

export async function computeArtistStats(slug, { onceToken, keys } = {}) {
  const artist = await getArtistBySlug(slug);
  const prev = artist?.stats || {};
  const releases = await listArtistReleases(slug, 100);
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

  // Sans token : ne pas écraser le dernier sync ONCE (streams / delivery)
  if (!token) {
    if (prev.streams) stats.streams = prev.streams;
    if (prev.delivery) stats.delivery = prev.delivery;
    if (prev.releaseStreams) stats.releaseStreams = prev.releaseStreams;
    if (prev.liveOnSpotify != null) stats.liveOnSpotify = prev.liveOnSpotify;
  } else {
    try {
      await enrichStatsFromOnce(stats, releases, token, { keys: storedKeys });
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

  const cachedAt = artist.stats?.updatedAt ? Date.parse(artist.stats.updatedAt) : 0;
  const fresh = cachedAt && Date.now() - cachedAt < 10 * 60 * 1000;
  const storedKeys = (await getUserKeys()) || {};
  const onceToken = String(storedKeys.onceApiToken || "").trim();
  const missingOnce = Boolean(onceToken) && needsOnceEnrich(artist.stats, releases);
  const stats =
    fresh && !missingOnce
      ? {
          ...artist.stats,
          tracks: releases.length,
          withAudio: releases.filter((r) => r.hasAudio).length,
          withCover: releases.filter((r) => r.hasCover).length,
        }
      : await computeArtistStats(slug, { keys: storedKeys, onceToken });

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
      keys,
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
 * Charge le profil artiste le plus riche : hub + meilleurs projets studio.
 * Garantit gender / styleLock / voice / voiceSample réutilisables pour un nouveau morceau.
 */
export async function resolveArtistProfileForRelease(slug, nameHint = "") {
  const artist = await getArtistBySlug(slug);
  if (!artist && !nameHint) return null;

  const name = nameHint || artist?.name || slug;
  let profile = withResolvedArtistGender({
    ...(artist?.profile || {}),
    slug: artist?.slug || slug,
    name,
  });

  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        json_extract(project_json, '$.artist') AS artist_json,
        updated_at
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    args: [artist?.slug || slug, name],
  });

  let bestFromProjects = null;
  let bestScore = -1;
  for (const row of res.rows) {
    if (!row.artist_json) continue;
    let a;
    try {
      a = typeof row.artist_json === "string" ? JSON.parse(row.artist_json) : row.artist_json;
    } catch {
      continue;
    }
    if (!a || typeof a !== "object") continue;
    const score = profileRichness(a);
    if (score > bestScore) {
      bestScore = score;
      bestFromProjects = a;
    }
  }

  if (bestFromProjects) {
    // Hub = base, projet riche = prioritaire sur style / voix / genres (merge préserve les trous)
    profile = mergeArtistProfile(profile, bestFromProjects);
  }

  profile = withResolvedArtistGender({
    ...profile,
    slug: artist?.slug || slug,
    name,
  });

  return profile;
}

/**
 * Récupère sexe / voix depuis un projet studio déjà généré (hub parfois incomplet).
 */
async function recoverArtistGenderFromProjects(slug, name) {
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT
        json_extract(project_json, '$.artist.gender') AS gender,
        json_extract(project_json, '$.artist.voice') AS voice,
        json_extract(project_json, '$.artist.visualIdentity.gender') AS vi_gender,
        json_extract(project_json, '$.artist.visualIdentity.genderLock') AS gender_lock,
        json_extract(project_json, '$.artist.portraitPrompt') AS portrait_prompt,
        json_extract(project_json, '$.artist.visualIdentity.portraitPrompt') AS vi_portrait
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT 12
    `,
    args: [slug, name],
  });

  for (const row of res.rows) {
    const recovered = {
      gender: row.gender || undefined,
      voice: row.voice || undefined,
      portraitPrompt: row.portrait_prompt || undefined,
      visualIdentity: {
        ...(row.vi_gender ? { gender: row.vi_gender } : {}),
        ...(row.gender_lock ? { genderLock: row.gender_lock } : {}),
        ...(row.vi_portrait ? { portraitPrompt: row.vi_portrait } : {}),
      },
    };
    if (!Object.keys(recovered.visualIdentity).length) delete recovered.visualIdentity;
    if (resolveArtistGender(recovered)) return omitUndefined(recovered);
  }
  return null;
}

/**
 * Rétablit `artist.gender` sur un projet déjà sauvé (hub / snapshot incomplet).
 */
export async function hydrateProjectArtistGender(saved) {
  const project = saved?.project;
  const original = project?.artist;
  if (!original) return saved;

  let artist = withResolvedArtistGender({ ...original });
  const slug = artist.slug || saved.seed?.artistSlug || "";
  const name = artist.name || saved.artistName || "";

  if (!resolveArtistGender(artist) && slug) {
    try {
      const hub = await getArtistBySlug(slug);
      if (hub?.profile) {
        artist = withResolvedArtistGender({
          ...hub.profile,
          ...artist,
          slug: slug || artist.slug,
          name: name || artist.name,
          gender: artist.gender || hub.profile.gender,
          voice: artist.voice || hub.profile.voice,
          visualIdentity: {
            ...(hub.profile.visualIdentity || {}),
            ...(artist.visualIdentity || {}),
          },
          portraitPrompt:
            artist.portraitPrompt ||
            artist.visualIdentity?.portraitPrompt ||
            hub.profile.portraitPrompt ||
            hub.profile.visualIdentity?.portraitPrompt,
        });
      }
    } catch {
      /* hub optionnel */
    }
  }

  if (!resolveArtistGender(artist) && (slug || name)) {
    const recovered = await recoverArtistGenderFromProjects(slug, name);
    if (recovered) {
      artist = withResolvedArtistGender({
        ...artist,
        ...recovered,
        gender: recovered.gender || artist.gender,
        voice: recovered.voice || artist.voice,
        visualIdentity: {
          ...(artist.visualIdentity || {}),
          ...(recovered.visualIdentity || {}),
        },
      });
    }
  }

  artist = withResolvedArtistGender(artist);
  const resolved = resolveArtistGender(artist);
  if (!resolved) return saved;
  if (original.gender === resolved.code && artist.gender === original.gender) {
    return saved;
  }

  artist = { ...artist, gender: resolved.code };
  const nextProject = { ...project, artist };
  try {
    await saveProject({
      id: saved.id,
      project: nextProject,
      seed: saved.seed,
      event: {
        stepKey: "artist",
        eventType: "backfill",
        message: "Voix artiste rétablie depuis le profil",
      },
    });
  } catch {
    /* lecture toujours possible même si la persistance échoue */
  }

  if (slug) {
    try {
      await upsertArtistFromProject(artist, { preferredSlug: slug });
    } catch {
      /* hub optionnel */
    }
  }

  return { ...saved, project: nextProject };
}

/**
 * Nouveau projet / morceau pour un artiste existant (garde le profil).
 * Réutilise gender, timbre (voice / voiceSample), styleLock, genres du hub + meilleurs projets.
 */
export async function createArtistRelease(slug, { theme = "", variantOf = null } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const themeHint =
    theme?.trim() ||
    (variantOf ? `Suite / variante de « ${variantOf} »` : "");

  let profile = await resolveArtistProfileForRelease(artist.slug, artist.name);
  if (!profile) throw new Error("Profil artiste introuvable");

  if (!resolveArtistGender(profile)) {
    const recovered = await recoverArtistGenderFromProjects(artist.slug, artist.name);
    if (recovered) {
      profile = withResolvedArtistGender({
        ...profile,
        ...recovered,
        gender: recovered.gender || profile.gender,
        voice: recovered.voice || profile.voice,
        visualIdentity: {
          ...(profile.visualIdentity || {}),
          ...(recovered.visualIdentity || {}),
        },
      });
    }
  }

  // Persiste le profil enrichi sur le hub pour les prochains singles
  await upsertArtistFromProject(profile, { preferredSlug: artist.slug });

  const language = profile.language || artist.profile?.language || "fr";

  const project = {
    trends: null,
    artist: profile,
    // Préremplit l’étape paroles quand un thème vient de l’agent carrière
    lyrics: themeHint
      ? { theme: themeHint, language }
      : null,
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
    bioHint: profile.bio || artist.profile?.bio || "",
    theme: themeHint || "Nouveau single",
    market: "FR",
    genre: profile.genre || "",
    genres: Array.isArray(profile.genres) ? profile.genres : [],
    language,
    styleArtist: profile.styleArtist || "",
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
    theme: themeHint || "Nouveau single",
    studioUrl: `/?project=${saved.id}&step=2`,
  };
}

/**
 * Page d’édition du profil (hors Studio).
 */
export async function openArtistStyleEditor(slug) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");
  return {
    slug,
    editorUrl: `/artiste/${encodeURIComponent(slug)}/editer`,
  };
}

export async function linkProjectToArtist(projectId, artist) {
  if (!projectId || !artist?.name) return null;
  const upserted = await upsertArtistFromProject(withResolvedArtistGender(artist));
  if (!upserted) return null;
  const db = getDb();
  await db.execute({
    sql: `UPDATE projects SET artist_slug = ? WHERE id = ?`,
    args: [upserted.slug, projectId],
  });
  return upserted;
}

/**
 * Backfill : enrichit tous les hubs + projets (gender, style, voix) depuis le plus riche profil.
 */
export async function backfillAllArtistProfiles() {
  await ensureArtistSchema();
  const db = getDb();
  const artists = await db.execute({
    sql: `SELECT slug, name FROM artists ORDER BY updated_at DESC`,
  });

  const report = {
    artists: 0,
    artistsFixedGender: 0,
    artistsEnriched: 0,
    projects: 0,
    projectsFixedGender: 0,
    stillMissingGender: [],
  };

  for (const row of artists.rows) {
    report.artists += 1;
    const before = await getArtistBySlug(row.slug);
    const beforeGender = Boolean(resolveArtistGender(before?.profile));
    const beforeScore = profileRichness(before?.profile || {});

    const profile = await resolveArtistProfileForRelease(row.slug, row.name);
    if (!profile) continue;

    await upsertArtistFromProject(profile, { preferredSlug: row.slug });
    const afterGender = Boolean(resolveArtistGender(profile));
    const afterScore = profileRichness(profile);
    if (!beforeGender && afterGender) report.artistsFixedGender += 1;
    if (afterScore > beforeScore) report.artistsEnriched += 1;
    if (!afterGender) report.stillMissingGender.push(row.slug);

    const projects = await db.execute({
      sql: `
        SELECT id, project_json, seed_json
        FROM projects
        WHERE artist_slug = ? OR artist_name = ?
      `,
      args: [row.slug, row.name],
    });

    for (const prow of projects.rows) {
      report.projects += 1;
      let project;
      try {
        project = JSON.parse(prow.project_json);
      } catch {
        continue;
      }
      const original = project.artist;
      if (!original) continue;
      const hadGender = Boolean(resolveArtistGender(original));
      const merged = mergeArtistProfile(original, profile);
      if (!resolveArtistGender(merged) && !hadGender) continue;
      if (
        hadGender &&
        original.gender === merged.gender &&
        profileRichness(original) >= profileRichness(merged)
      ) {
        continue;
      }
      project.artist = merged;
      let seed = {};
      try {
        seed = prow.seed_json ? JSON.parse(prow.seed_json) : {};
      } catch {
        seed = {};
      }
      await saveProject({
        id: prow.id,
        project,
        seed,
        event: {
          stepKey: "artist",
          eventType: "backfill",
          message: "Profil artiste enrichi (voix / style / gender)",
        },
      });
      if (!hadGender && resolveArtistGender(merged)) report.projectsFixedGender += 1;
    }
  }

  return report;
}

/**
 * Recadre les photos d’un artiste « c’est moi » sur son identity visuelle actuelle
 * (garde le visage, change garde-robe / lumière / décor).
 */
export async function restyleArtistPortraits(slug, { keys, prompt } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");
  const storedKeys = keys && typeof keys === "object" ? keys : (await getUserKeys()) || {};
  const photos = normalizeArtistPhotos(artist.profile?.photos, artist.profile?.imageUrl);
  if (!photos.length) {
    throw new Error("Aucune photo à restyler — ajoute un portrait d’abord.");
  }

  const vi = artist.profile?.visualIdentity || {};
  const restylePrompt =
    String(prompt || "").trim() ||
    [
      `39-year-old adult man, clearly masculine face, same person as the reference photo`,
      `hardcore hip hop artist portrait`,
      vi.wardrobe || "dark hoodie, baggy streetwear, utilitarian jacket",
      vi.photographyStyle || "gritty urban high-contrast industrial photography",
      `${artist.profile?.mood || "tense, determined"} mood`,
      "photorealistic, square, no text",
    ].join(", ");

  const restyled = [];
  let provider = null;
  for (let i = 0; i < photos.length; i += 1) {
    const visual = await generateVisual({
      keys: storedKeys,
      prompt: restylePrompt,
      kind: "portrait",
      referenceImageUrl: photos[i],
    });
    restyled.push(visual.imageUrl);
    provider = visual.provider || provider;
  }

  const now = new Date().toISOString();
  const profile = stripHeavyProfile({
    ...artist.profile,
    imageUrl: restyled[0],
    photos: restyled,
    imageProvider: provider || "restyle",
    imageFallback: false,
    imageWarning: undefined,
    portraitPrompt: restylePrompt,
    visualIdentity: {
      ...vi,
      portraitPrompt: restylePrompt,
    },
    slug: artist.slug,
    name: artist.name,
  });

  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET profile_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(profile), now, slug],
  });

  return {
    slug,
    count: restyled.length,
    provider,
    profile,
  };
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
