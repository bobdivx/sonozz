/**
 * Exécute les items d’agenda carrière « promote » dus (clip prêt → TikTok / YouTube / webhook).
 */
import { getArtistBySlug } from "./artists.js";
import { getDb, getProject, ensureSchema } from "./db.js";
import { downloadClipBuffer, isS3Configured } from "./s3.js";
import { publishShortEverywhere } from "./socialPublish.js";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function scheduleItemKey(item = {}) {
  return `${item.date || ""}|${item.type || ""}|${item.title || ""}`;
}

function isDue(item, today = todayISO()) {
  if (!item || item.status === "done") return false;
  if (item.type !== "promote") return false;
  if (item.status === "active") return true;
  return String(item.date || "") <= today;
}

function pickClip(project = {}) {
  const clips = Array.isArray(project.clips) ? project.clips : [];
  const activeId = project.activeClipId;
  const active = activeId ? clips.find((c) => c?.id === activeId) : null;
  const candidates = [active, project.clip, ...clips].filter(Boolean);

  for (const c of candidates) {
    const s3Key = c.s3Key || null;
    const videoUrl =
      typeof c.videoUrl === "string" && /^https?:\/\//i.test(c.videoUrl) ? c.videoUrl : null;
    const mime =
      c.publishMimeType ||
      c.mimeType ||
      (videoUrl && /\.mp4(\?|$)/i.test(videoUrl) ? "video/mp4" : null) ||
      "video/mp4";
    // TikTok exige MP4 — ignorer WebM
    if (/webm/i.test(mime) && !/mp4/i.test(mime)) continue;
    if (s3Key || videoUrl) {
      return { s3Key, videoUrl, mimeType: mime, clipId: c.id || null, kind: c.kind || null };
    }
  }
  return null;
}

function buildSocialPack(project = {}, item = {}) {
  const social = project.social || {};
  const title = project.track?.title || project.lyrics?.title || "Nouveau single";
  const artistName = project.artist?.name || "";
  const hashtags = Array.isArray(social.hashtags) && social.hashtags.length
    ? social.hashtags
    : ["newmusic", "sonozz", String(artistName || "music").replace(/\s+/g, "")].filter(Boolean);

  const caption =
    social.caption?.trim() ||
    [
      item.title || "Out now",
      title,
      artistName ? `— ${artistName}` : "",
      social.hook || "",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 400);

  return {
    ...social,
    caption,
    hashtags,
    scheduleItem: item.title || null,
  };
}

async function loadProjectLite(projectId) {
  // getProject strip base64 but keeps s3Key / https videoUrl
  return getProject(projectId);
}

/**
 * Prévisualise ce qui peut tourner aujourd’hui (sans publier).
 */
export async function previewCareerSchedule(slug) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");
  const career = artist.stats?.career || null;
  const schedule = Array.isArray(career?.schedule) ? career.schedule : [];
  const today = todayISO();
  const due = schedule.filter((item) => isDue(item, today));

  const focusId = career?.releaseFocus?.id || null;
  let clip = null;
  let project = null;
  if (focusId) {
    project = await loadProjectLite(focusId);
    if (project?.project) clip = pickClip(project.project);
  }

  return {
    today,
    due,
    focusProjectId: focusId,
    hasClip: Boolean(clip),
    clip,
    canRun:
      due.length > 0 &&
      Boolean(clip) &&
      (Boolean(clip.s3Key) || Boolean(clip.videoUrl)),
    blockers: [
      due.length === 0 ? "Aucun item promo dû aujourd’hui" : null,
      !focusId ? "Pas de release focus" : null,
      focusId && !clip ? "Pas de clip MP4 (S3/URL) sur le projet focus — génère un short Veo" : null,
    ].filter(Boolean),
  };
}

/**
 * Publie les items promote dus via TikTok / YouTube / webhook social.
 */
export async function runCareerSchedule(slug, { keys, dryRun = false } = {}) {
  const artist = await getArtistBySlug(slug);
  if (!artist) throw new Error("Artiste introuvable");

  const preview = await previewCareerSchedule(slug);
  if (dryRun) {
    return { dryRun: true, ...preview, results: [] };
  }

  if (!preview.due.length) {
    return {
      ok: true,
      skipped: true,
      message: "Rien à publier aujourd’hui",
      ...preview,
      results: [],
    };
  }

  if (!preview.hasClip || !preview.focusProjectId) {
    return {
      ok: false,
      skipped: true,
      message: preview.blockers.join(" · ") || "Clip manquant",
      ...preview,
      results: [],
    };
  }

  const full = await loadProjectLite(preview.focusProjectId);
  const project = full?.project || {};
  const clip = pickClip(project);
  if (!clip) {
    return {
      ok: false,
      skipped: true,
      message: "Clip MP4 introuvable (évite WebM promo)",
      ...preview,
      results: [],
    };
  }

  let videoBuffer = null;
  let mimeType = clip.mimeType || "video/mp4";
  try {
    const ref = clip.s3Key || clip.videoUrl;
    const downloaded = await downloadClipBuffer(ref);
    videoBuffer = downloaded.buffer;
    mimeType = downloaded.mimeType || mimeType;
  } catch (e) {
    if (!isS3Configured() && clip.s3Key && !clip.videoUrl) {
      throw new Error("S3 non configuré pour lire le clip");
    }
    throw new Error(e.message || "Téléchargement clip impossible");
  }

  const social = buildSocialPack(project, preview.due[0]);
  const publish = await publishShortEverywhere({
    keys: keys || {},
    videoBuffer,
    mimeType,
    videoUrl: clip.videoUrl,
    social,
    artist: project.artist || { name: artist.name, ...artist.profile },
    track: project.track || { title: full?.trackTitle },
    targets: { tiktok: true, youtube: true, webhook: true },
  });

  const ok = publish.status === "published" || publish.status === "partial";
  const now = new Date().toISOString();
  const runEntries = preview.due.map((item) => ({
    key: scheduleItemKey(item),
    date: item.date,
    type: item.type,
    title: item.title,
    at: now,
    ok,
    status: publish.status,
    message:
      (publish.results || []).map((r) => `${r.platform}: ${r.message || r.status || ""}`).join(" · ") ||
      publish.status,
  }));

  // Marque les items promote dus comme done si au moins un canal OK
  const prevCareer = artist.stats?.career || {};
  const nextSchedule = (prevCareer.schedule || []).map((item) => {
    if (!isDue(item, preview.today)) return item;
    if (item.type !== "promote") return item;
    return ok ? { ...item, status: "done", doneAt: now } : item;
  });

  const career = {
    ...prevCareer,
    schedule: nextSchedule,
    scheduleRuns: [...runEntries, ...(prevCareer.scheduleRuns || [])].slice(0, 40),
    updatedAt: now,
  };

  const nextStats = {
    ...(artist.stats || {}),
    career,
    updatedAt: now,
  };

  await ensureSchema();
  const db = getDb();
  await db.execute({
    sql: `UPDATE artists SET stats_json = ?, updated_at = ? WHERE slug = ?`,
    args: [JSON.stringify(nextStats), now, slug],
  });

  // Trace sur le projet
  try {
    const { saveProject } = await import("./db.js");
    await saveProject({
      id: preview.focusProjectId,
      project: {
        ...project,
        social: {
          ...social,
          publish,
          publishedAt: ok ? now : social.publishedAt,
          publishedVia: "career-schedule",
        },
      },
      seed: full?.seed || {},
      event: {
        stepKey: "social",
        eventType: "career-schedule-publish",
        message: ok ? "Promo agenda publiée" : "Promo agenda échouée",
        payload: { runs: runEntries, status: publish.status },
      },
    });
  } catch {
    /* non bloquant */
  }

  return {
    ok,
    status: publish.status,
    publish,
    runs: runEntries,
    career,
    tiktokTokens: publish.tiktokTokens || null,
    youtubeTokens: publish.youtubeTokens || null,
    focusProjectId: preview.focusProjectId,
    clip,
  };
}
