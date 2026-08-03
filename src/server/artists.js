import { ensureSchema, getDb, uid, saveProject } from "./db.js";

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

/**
 * Importe les artistes depuis les projets existants (historique avant la table artists).
 */
export async function syncArtistsFromProjects() {
  await ensureArtistSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `
      SELECT id, artist_name, artist_slug, project_json, updated_at
      FROM projects
      ORDER BY updated_at DESC
      LIMIT 200
    `,
  });

  const synced = [];
  const seen = new Set();

  for (const row of res.rows) {
    let project = {};
    try {
      project = JSON.parse(row.project_json || "{}");
    } catch {
      continue;
    }

    const artist =
      project.artist && project.artist.name
        ? project.artist
        : row.artist_name
          ? { name: row.artist_name }
          : null;

    if (!artist?.name) continue;

    const preferredSlug = row.artist_slug || artist.slug || slugify(artist.aka || artist.name);
    if (seen.has(preferredSlug)) {
      // Lier le projet même si déjà sync
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

  return res.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    profile: row.profile_json ? JSON.parse(row.profile_json) : {},
    stats: row.stats_json ? JSON.parse(row.stats_json) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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

  // Par slug dédié OU nom artiste (projets anciens)
  const artist = await getArtistBySlug(slug);
  const name = artist?.name || slug;

  const res = await db.execute({
    sql: `
      SELECT id, title, artist_name, track_title, status, artist_slug, project_json, created_at, updated_at
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `,
    args: [slug, name, limit],
  });

  return res.rows.map((row) => {
    let project = {};
    try {
      project = JSON.parse(row.project_json || "{}");
    } catch {
      project = {};
    }
    return {
      id: row.id,
      title: row.title,
      artistName: row.artist_name,
      trackTitle: row.track_title || project.track?.title || project.lyrics?.title || null,
      status: row.status,
      slug: row.artist_slug || slug,
      hasAudio: Boolean(project.track?.audioUrl),
      hasCover: Boolean(project.cover?.imageUrl),
      distributed: Boolean(
        project.distrokid?.status === "submitted" || project.distrokid?.provider === "once",
      ),
      onceStatus: project.distrokid?.status || null,
      releaseId: project.distrokid?.releaseId || null,
      coverUrl: project.cover?.imageUrl || null,
      audioUrl: project.track?.audioUrl || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}

export async function computeArtistStats(slug) {
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
    })),
    streamsNote:
      "Les streams Spotify/Apple se voient dans Spotify for Artists / ONCE après livraison stores (24–72 h+).",
    updatedAt: new Date().toISOString(),
  };

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
  const stats = await computeArtistStats(slug);
  return { ...artist, stats, releases };
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
