import {
  ensureSchema,
  getDb,
  createAlbum,
  getAlbum,
  updateAlbum,
  listAlbumsByArtist,
  addAlbumTrack,
  updateAlbumTrack,
  deleteAlbumTrack,
  deleteAlbum,
  getProject,
  saveProject,
} from "./db.js";

/**
 * Migre les albums depuis project_json.album vers la table albums.
 * Scan tous les projets qui ont un album et crée les enregistrements correspondants.
 */
export async function migrateAlbumsFromProjects() {
  await ensureSchema();
  const db = getDb();

  const res = await db.execute({
    sql: `
      SELECT 
        id, 
        artist_slug,
        project_json,
        created_at,
        updated_at
      FROM projects 
      WHERE json_extract(project_json, '$.album') IS NOT NULL
      ORDER BY created_at ASC
    `,
    args: [],
  });

  const migrated = [];
  const errors = [];

  for (const row of res.rows) {
    try {
      const projectId = row.id;
      const artistSlug = row.artist_slug;
      const projectData = JSON.parse(row.project_json);
      const oldAlbum = projectData.album;

      if (!oldAlbum || !artistSlug) continue;

      const albumId = oldAlbum.id || `alb_migrated_${projectId}`;
      const existing = await db.execute({
        sql: `SELECT id FROM albums WHERE id = ? LIMIT 1`,
        args: [albumId],
      });

      let newAlbum;
      if (existing.rows[0]) {
        newAlbum = await getAlbum(albumId);
      } else {
        newAlbum = await createAlbum({
          artistSlug,
          title: oldAlbum.title || "Album",
          concept: oldAlbum.concept || "",
          targetCount: oldAlbum.targetCount || 8,
          status: oldAlbum.status || "draft",
        });

        await db.execute({
          sql: `UPDATE albums SET id = ?, created_at = ?, updated_at = ? WHERE id = ?`,
          args: [albumId, row.created_at, row.updated_at, newAlbum.id],
        });
      }

      if (oldAlbum.cover?.imageUrl) {
        await updateAlbum(albumId, { coverUrl: oldAlbum.cover.imageUrl });
      }
      if (oldAlbum.jobId) {
        await updateAlbum(albumId, { jobId: oldAlbum.jobId });
      }
      if (oldAlbum.live) {
        await updateAlbum(albumId, { live: oldAlbum.live });
      }

      if (Array.isArray(oldAlbum.tracks)) {
        for (const track of oldAlbum.tracks) {
          const existingTrack = await db.execute({
            sql: `SELECT id FROM album_tracks WHERE id = ? LIMIT 1`,
            args: [track.id],
          });

          if (!existingTrack.rows[0]) {
            await db.execute({
              sql: `
                INSERT INTO album_tracks 
                  (id, album_id, project_id, role, index_position, working_title, theme, status, error, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              args: [
                track.id,
                albumId,
                track.projectId || null,
                track.role || "member",
                track.index || 1,
                track.workingTitle || "",
                track.theme || "",
                track.status || "pending",
                track.error || null,
                row.created_at,
                row.updated_at,
              ],
            });
          }
        }
      }

      migrated.push({ projectId, albumId, artistSlug });
    } catch (error) {
      errors.push({ projectId: row.id, error: error.message });
    }
  }

  return { migrated, errors };
}

/**
 * Récupère tous les albums d'un artiste avec leurs tracks enrichis des données projets.
 */
export async function getArtistAlbumsWithDetails(artistSlug) {
  const albums = await listAlbumsByArtist(artistSlug);
  const detailed = [];

  for (const album of albums) {
    const fullAlbum = await getAlbum(album.id);
    const tracksWithDetails = [];

    for (const track of fullAlbum.tracks || []) {
      let trackDetail = { ...track };

      if (track.projectId) {
        try {
          const projectData = await getProject(track.projectId);
          if (projectData) {
            trackDetail.lyrics = projectData.project?.lyrics || null;
            trackDetail.track = projectData.project?.track || null;
            trackDetail.cover = projectData.project?.cover || null;
          }
        } catch {
          // ignore
        }
      }

      tracksWithDetails.push(trackDetail);
    }

    detailed.push({
      ...fullAlbum,
      tracks: tracksWithDetails,
    });
  }

  return detailed;
}

/**
 * Crée un nouvel album avec un track lead basé sur un projet existant.
 */
export async function createAlbumFromLead({ artistSlug, leadProjectId, title, concept = "", targetCount = 8 }) {
  const leadProject = await getProject(leadProjectId);
  if (!leadProject) {
    throw new Error("Projet lead introuvable");
  }

  const albumTitle = title || leadProject.project?.lyrics?.title || "Album";
  const album = await createAlbum({
    artistSlug,
    title: albumTitle,
    concept,
    targetCount,
    status: "draft",
  });

  await addAlbumTrack({
    albumId: album.id,
    projectId: leadProjectId,
    role: "lead",
    index: 1,
    workingTitle: leadProject.project?.lyrics?.title || "",
    theme: leadProject.project?.lyrics?.theme || "",
    status: "done",
  });

  if (leadProject.project?.cover?.imageUrl) {
    await updateAlbum(album.id, { coverUrl: leadProject.project.cover.imageUrl });
  }

  return getAlbum(album.id);
}

/**
 * Convertit les releases (format actuel) en albums avec détails.
 */
export function organizeAlbumsFromReleases(releases = [], albums = []) {
  const albumMap = new Map(albums.map((a) => [a.id, a]));
  const singles = [];
  const organizedAlbums = [];

  for (const album of albums) {
    const albumTracks = album.tracks || [];
    const tracks = [];

    for (const albumTrack of albumTracks) {
      const release = releases.find((r) => r.id === albumTrack.projectId);
      if (release) {
        tracks.push({
          ...release,
          albumId: album.id,
          albumTitle: album.title,
          albumStatus: album.status,
          albumIndex: albumTrack.index,
          albumRole: albumTrack.role,
          albumTrackId: albumTrack.id,
        });
      }
    }

    tracks.sort((a, b) => (a.albumIndex || 999) - (b.albumIndex || 999));

    const leadTrack = tracks.find((t) => t.albumRole === "lead") || tracks[0];
    
    organizedAlbums.push({
      id: album.id,
      title: album.title,
      status: album.status,
      targetCount: album.targetCount,
      coverUrl: album.coverUrl || leadTrack?.coverUrl || null,
      lead: leadTrack || null,
      tracks,
    });
  }

  for (const release of releases) {
    const inAlbum = organizedAlbums.some((a) =>
      a.tracks.some((t) => t.id === release.id)
    );
    if (!inAlbum) {
      singles.push(release);
    }
  }

  return { albums: organizedAlbums, singles };
}
