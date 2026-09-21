import { ensureSchema, getDb, uid } from "./client.js";

/** Aligné sur lightAssetUrl (artists/schema) — évite import circulaire db ↔ artists. */
function playableAssetUrl(url) {
  if (!url || typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (/s3\.|scw\.cloud|r2\.cloudflare|sonozz/i.test(u.hostname)) {
        const hasAmz = [...u.searchParams.keys()].some((k) => /^X-Amz-/i.test(k));
        if (hasAmz) {
          u.search = "";
          u.hash = "";
          return u.toString();
        }
      }
    } catch {
      /* ignore */
    }
    return url;
  }
  if (url.startsWith("/api/")) return url;
  return null;
}

function summarize(project = {}, seed = {}) {
  const artistName = project.artist?.name || seed.name || null;
  const trackTitle = project.track?.title || project.lyrics?.title || seed.theme || null;
  const title = [artistName, trackTitle].filter(Boolean).join(" — ") || "Projet SONOZZ";

  let status = "draft";
  if (project.social?.publishedAt || project.social?.publish) status = "published";
  else if (
    project.clip?.videoBase64 ||
    project.clip?.videoUrl ||
    (Array.isArray(project.clips) &&
      project.clips.some((c) => c?.videoUrl || c?.s3Key || c?.storedRemote || c?.storedLocally))
  )
    status = "clip";
  else if (project.social) status = "shorts";
  else if (project.distrokid) status = "distribution";
  else if (project.cover) status = "cover";
  else if (
    project.track?.audioUrl &&
    project.track?.status !== "pending-review" &&
    project.track?.status !== "preview-ready" &&
    !project.track?.isPreview
  )
    status = "audio";
  else if (project.track) status = "track";
  else if (project.lyrics) status = "lyrics";
  else if (project.artist) status = "artist";
  else if (project.trends) status = "trends";

  return { title, artistName, trackTitle, status };
}

/** Colonnes indexables pour /play et /api/library (évite scan json_extract). */
export function libraryColumnsFromProject(project = {}) {
  const trackStatus = project?.track?.status || null;
  const pending =
    trackStatus === "pending-review" ||
    trackStatus === "preview-ready" ||
    Boolean(project?.track?.isPreview);
  const audioUrl = playableAssetUrl(project?.track?.audioUrl);
  const coverUrl =
    playableAssetUrl(project?.cover?.imageUrl) ||
    playableAssetUrl(project?.album?.cover?.imageUrl);
  const duration =
    project?.track?.duration != null && project?.track?.duration !== ""
      ? String(project.track.duration)
      : null;
  return {
    audioUrl: audioUrl || null,
    trackStatus,
    coverUrl: coverUrl || null,
    trackDuration: duration,
    hasAudio: audioUrl && !pending ? 1 : 0,
  };
}

export function stripHeavyProjectPayload(project = {}) {
  if (!project || typeof project !== "object") return project;
  const next = { ...project };

  if (next.clip && typeof next.clip === "object") {
    const { videoBase64, videoUrl, ...meta } = next.clip;
    const remote = typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined;
    next.clip = {
      ...meta,
      videoUrl: remote,
      videoBase64: undefined,
      storedRemote: Boolean(remote || meta.s3Key || meta.storedRemote),
      storedLocally: Boolean(meta.storedLocally && !remote),
    };
  }

  if (Array.isArray(next.clips)) {
    next.clips = next.clips.map((c) => {
      if (!c || typeof c !== "object") return c;
      const { videoBase64, videoUrl, ...meta } = c;
      const remote =
        typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined;
      return {
        ...meta,
        videoUrl: remote,
        videoBase64: undefined,
        storedRemote: Boolean(remote || meta.s3Key || meta.storedRemote),
        storedLocally: Boolean(meta.storedLocally && !remote),
      };
    });
  }

  const stripHeavyAudio = (trackObj) => {
    if (!trackObj || typeof trackObj !== "object") return trackObj;
    const audio = trackObj.audioUrl;
    if (typeof audio === "string" && audio.startsWith("data:") && audio.length > 500_000) {
      return {
        ...trackObj,
        audioUrl: null,
        localAsset: true,
        assetMissingReason: "audio-data-stripped",
      };
    }
    return trackObj;
  };

  if (next.track) next.track = stripHeavyAudio(next.track);
  if (Array.isArray(next.trackVersions)) {
    next.trackVersions = next.trackVersions.map(stripHeavyAudio);
  }

  return next;
}

export async function listProjects(limit = 50, { ownerEmail = null, includeAll = false } = {}) {
  await ensureSchema();
  const db = getDb();
  const owner = ownerEmail ? String(ownerEmail).trim().toLowerCase() : null;

  if (!includeAll && !owner) return [];

  const res = includeAll
    ? await db.execute({
        sql: `
          SELECT id, title, artist_name, track_title, status, owner_email, created_at, updated_at
          FROM projects
          ORDER BY updated_at DESC
          LIMIT ?
        `,
        args: [limit],
      })
    : await db.execute({
        sql: `
          SELECT id, title, artist_name, track_title, status, owner_email, created_at, updated_at
          FROM projects
          WHERE lower(owner_email) = ?
          ORDER BY updated_at DESC
          LIMIT ?
        `,
        args: [owner, limit],
      });

  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    status: row.status,
    ownerEmail: row.owner_email || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getProject(id) {
  await ensureSchema();
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    args: [id],
  });
  const row = res.rows[0];
  if (!row) return null;

  const events = await db.execute({
    sql: `
      SELECT id, step_key, event_type, message, payload_json, created_at
      FROM project_events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `,
    args: [id],
  });

  return {
    id: row.id,
    title: row.title,
    artistName: row.artist_name,
    trackTitle: row.track_title,
    status: row.status,
    ownerEmail: row.owner_email || null,
    artistSlug: row.artist_slug || null,
    seed: row.seed_json ? JSON.parse(row.seed_json) : {},
    project: stripHeavyProjectPayload(JSON.parse(row.project_json)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: events.rows.map((e) => ({
      id: e.id,
      stepKey: e.step_key,
      eventType: e.event_type,
      message: e.message,
      payload: e.payload_json ? JSON.parse(e.payload_json) : null,
      createdAt: e.created_at,
    })),
  };
}

export async function saveProject({ id, project, seed = {}, event, ownerEmail = null } = {}) {
  await ensureSchema();
  const db = getDb();
  const now = new Date().toISOString();
  const lightProject = stripHeavyProjectPayload(project || {});
  const summary = summarize(lightProject, seed);
  const projectId = id || uid("proj");
  const owner = ownerEmail ? String(ownerEmail).trim().toLowerCase() : null;
  const artistSlug =
    lightProject?.artist?.slug ||
    seed?.artistSlug ||
    null;

  const library = libraryColumnsFromProject(lightProject);

  const existing = await db.execute({
    sql: `SELECT id, created_at, owner_email FROM projects WHERE id = ? LIMIT 1`,
    args: [projectId],
  });

  if (existing.rows[0]) {
    const prevOwner = existing.rows[0].owner_email
      ? String(existing.rows[0].owner_email).toLowerCase()
      : null;
    if (owner && prevOwner && prevOwner !== owner) {
      const err = new Error("Ce projet appartient à un autre compte");
      err.code = "FORBIDDEN_PROJECT";
      throw err;
    }
    await db.execute({
      sql: `
        UPDATE projects
        SET title = ?, artist_name = ?, track_title = ?, status = ?,
            seed_json = ?, project_json = ?, updated_at = ?,
            artist_slug = COALESCE(?, artist_slug),
            owner_email = COALESCE(owner_email, ?),
            audio_url = ?, track_status = ?, cover_url = ?,
            track_duration = ?, has_audio = ?
        WHERE id = ?
      `,
      args: [
        summary.title,
        summary.artistName,
        summary.trackTitle,
        summary.status,
        JSON.stringify(seed || {}),
        JSON.stringify(lightProject),
        now,
        artistSlug,
        owner,
        library.audioUrl,
        library.trackStatus,
        library.coverUrl,
        library.trackDuration,
        library.hasAudio,
        projectId,
      ],
    });
  } else {
    await db.execute({
      sql: `
        INSERT INTO projects
          (id, title, artist_name, track_title, status, seed_json, project_json,
           artist_slug, owner_email, audio_url, track_status, cover_url,
           track_duration, has_audio, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        projectId,
        summary.title,
        summary.artistName,
        summary.trackTitle,
        summary.status,
        JSON.stringify(seed || {}),
        JSON.stringify(lightProject),
        artistSlug,
        owner,
        library.audioUrl,
        library.trackStatus,
        library.coverUrl,
        library.trackDuration,
        library.hasAudio,
        now,
        now,
      ],
    });
  }

  if (event) {
    await db.execute({
      sql: `
        INSERT INTO project_events
          (id, project_id, step_key, event_type, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        uid("evt"),
        projectId,
        event.stepKey || null,
        event.eventType || "update",
        event.message || null,
        event.payload ? JSON.stringify(event.payload) : null,
        now,
      ],
    });
  }

  return getProject(projectId);
}

export async function deleteProject(id) {
  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `DELETE FROM project_events WHERE project_id = ?`,
    args: [id],
  });
  await db.execute({
    sql: `DELETE FROM projects WHERE id = ?`,
    args: [id],
  });
  return { ok: true };
}
