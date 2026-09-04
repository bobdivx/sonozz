import { getDb, uid, saveProject } from "../db.js";
import { withResolvedArtistGender, resolveArtistGender } from "../../lib/artistGender.js";
import { listArtistImageUrl } from "../../lib/artistPhotos.js";
import { tryParseS3ObjectKey, deleteS3Keys, deleteS3Prefix } from "../s3.js";
import {
  slugify,
  ensureArtistSchema,
  stripHeavyProfile,
  omitUndefined,
  mergeArtistProfile,
  lightAssetUrl,
  safeS3Segment,
  profileRichness,
} from "./schema.js";

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

/** Collecte les clés S3 référencées dans un project_json / profil. */
export function collectS3KeysFromProject(project = {}) {
  const keys = new Set();
  const add = (value) => {
    if (!value || typeof value !== "string") return;
    const parsed = tryParseS3ObjectKey(value);
    if (parsed) keys.add(parsed);
  };

  const walkTrack = (t) => {
    if (!t || typeof t !== "object") return;
    add(t.audioS3Key);
    add(t.audioUrl);
  };
  walkTrack(project.track);
  for (const v of project.trackVersions || []) walkTrack(v);

  const walkClip = (c) => {
    if (!c || typeof c !== "object") return;
    add(c.s3Key);
    add(c.videoUrl);
  };
  walkClip(project.clip);
  for (const c of project.clips || []) walkClip(c);

  const walkVoice = (sample) => {
    if (!sample || typeof sample !== "object") return;
    add(sample.s3Key);
    add(sample.url);
  };
  walkVoice(project.artist?.voiceSample);
  walkVoice(project.featArtist?.voiceSample);
  walkVoice(project.voiceSample);

  add(project.cover?.s3Key);
  add(project.cover?.imageUrl);
  add(project.album?.cover?.s3Key);
  add(project.album?.cover?.imageUrl);

  return [...keys];
}

/**
 * Supprime un artiste + projets liés + albums + objets S3 (audio/clips).
 * Ne retire pas les releases ONCE / stores.
 */
export async function deleteArtist(slug) {
  await ensureArtistSchema();
  const cleanSlug = String(slug || "").trim();
  if (!cleanSlug) throw new Error("Slug artiste manquant");

  const artist = await getArtistBySlug(cleanSlug);
  if (!artist) throw new Error("Artiste introuvable");

  const db = getDb();
  const name = artist.name || cleanSlug;

  const projectsRes = await db.execute({
    sql: `
      SELECT id, project_json
      FROM projects
      WHERE artist_slug = ? OR artist_name = ?
    `,
    args: [cleanSlug, name],
  });

  const projectIds = projectsRes.rows.map((r) => r.id);
  const keySet = new Set();

  for (const row of projectsRes.rows) {
    let project = {};
    try {
      project = row.project_json ? JSON.parse(row.project_json) : {};
    } catch {
      project = {};
    }
    for (const k of collectS3KeysFromProject(project)) keySet.add(k);
  }

  for (const k of collectS3KeysFromProject({
    artist: artist.profile,
    voiceSample: artist.profile?.voiceSample,
  })) {
    keySet.add(k);
  }

  let s3Deleted = 0;
  const s3KeysResult = await deleteS3Keys([...keySet]);
  s3Deleted += s3KeysResult.deleted || 0;

  for (const id of projectIds) {
    const seg = safeS3Segment(id);
    if (!seg) continue;
    for (const prefix of [`audio/${seg}`, `clips/${seg}`]) {
      const r = await deleteS3Prefix(prefix);
      s3Deleted += r.deleted || 0;
    }
  }
  const voiceSeg = safeS3Segment(cleanSlug);
  if (voiceSeg) {
    const r = await deleteS3Prefix(`audio/voice/${voiceSeg}`);
    s3Deleted += r.deleted || 0;
  }

  if (projectIds.length) {
    const placeholders = projectIds.map(() => "?").join(",");
    await db.execute({
      sql: `DELETE FROM album_tracks WHERE project_id IN (${placeholders})`,
      args: projectIds,
    });
  }

  const albumsRes = await db.execute({
    sql: `SELECT id FROM albums WHERE artist_slug = ?`,
    args: [cleanSlug],
  });
  for (const row of albumsRes.rows) {
    await db.execute({
      sql: `DELETE FROM album_tracks WHERE album_id = ?`,
      args: [row.id],
    });
    await db.execute({
      sql: `DELETE FROM albums WHERE id = ?`,
      args: [row.id],
    });
  }

  for (const id of projectIds) {
    await db.execute({
      sql: `DELETE FROM project_events WHERE project_id = ?`,
      args: [id],
    });
    await db.execute({
      sql: `DELETE FROM projects WHERE id = ?`,
      args: [id],
    });
  }

  await db.execute({
    sql: `DELETE FROM artists WHERE slug = ?`,
    args: [cleanSlug],
  });

  return {
    ok: true,
    slug: cleanSlug,
    name,
    projectsDeleted: projectIds.length,
    albumsDeleted: albumsRes.rows.length,
    s3ObjectsDeleted: s3Deleted,
    s3Skipped: Boolean(s3KeysResult.skipped),
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
  const { resolveArtistProfileForRelease } = await import("./profile.js");
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
