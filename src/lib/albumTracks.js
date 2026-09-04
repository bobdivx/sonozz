import { emptyProject, studioHref } from "./studio.js";
import { api } from "./apiClient.js";
import { appendVersion } from "./versionsModel.js";

export function albumHasWorkLeft(album) {
  return (album?.tracks || []).some(
    (t) =>
      t.role !== "lead" &&
      (t.status === "pending" ||
        t.status === "error" ||
        t.status === "lyrics" ||
        t.status === "audio"),
  );
}

export function albumDoneCount(album) {
  return (album?.tracks || []).filter((t) => t.status === "done").length;
}

export function albumNeedsCover(album) {
  return Boolean(album) && !String(album?.cover?.imageUrl || "").trim();
}

export function pickAlbumArtwork(leadProject) {
  return leadProject?.album?.cover || leadProject?.cover || null;
}

export function buildAlbumCoverRequest({ artist, album, leadTrack, featArtist } = {}) {
  const title = String(album?.title || leadTrack?.title || "Album").trim() || "Album";
  const concept = String(album?.concept || "").trim();
  const feat = featArtist ?? artist?.featArtist ?? null;
  return {
    artist: feat ? { ...artist, featArtist: feat } : artist,
    album: { title, concept },
    track: {
      title,
      mood: concept || leadTrack?.mood || artist?.mood,
    },
  };
}

/** Pose la jaquette album sur un projet (lead ou piste enfant) sans écraser une image déjà là. */
export function attachCoverToProject(project, cover, { asAlbumCover = false } = {}) {
  if (!project || !cover?.imageUrl) return project;
  let next = project;
  if (project.cover?.imageUrl !== cover.imageUrl) {
    try {
      next = appendVersion(project, "cover", cover);
    } catch {
      next = { ...project, cover };
    }
  }
  if (asAlbumCover && next.album) {
    next = {
      ...next,
      album: { ...next.album, cover, coverError: undefined },
    };
  }
  return next;
}

/** Album marqué « running » mais plus d’activité persistée — onglet fermé / hang ACE. */
export function isAlbumStale(album, maxMs = 90_000) {
  if (album?.status !== "running") return false;
  const t = Date.parse(album?.updatedAt || "");
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > maxMs;
}

export function cancelledAlbumState(album) {
  return {
    ...album,
    status: "cancelled",
    live: {
      percent: 100,
      message: "Album arrêté",
      label: album?.live?.label || album?.title || "Album",
    },
    tracks: (album?.tracks || []).map((t) =>
      t.status === "lyrics" || t.status === "audio"
        ? { ...t, status: "pending", error: undefined }
        : t,
    ),
    updatedAt: new Date().toISOString(),
  };
}

export function resumeAlbumTracks(tracks) {
  return (tracks || []).map((t) => {
    if (t.role === "lead" || t.status === "done") return t;
    return { ...t, status: "pending", error: undefined };
  });
}

export function albumStudioHref(entry, leadProjectId) {
  const id = entry?.role === "lead" ? leadProjectId : entry?.projectId || leadProjectId;
  return studioHref(id, "tracks");
}

export function buildAlbumMemberProject({ leadProject, entry, leadProjectId }) {
  const base = {
    ...emptyProject(),
    trends: leadProject?.trends || null,
    artist: leadProject?.artist || null,
    lyrics: entry?.lyrics || null,
    track: entry?.track || null,
    musicArrange: entry?.musicArrange || leadProject?.musicArrange || null,
    sonicRole: entry?.sonicRole || entry?.trackRole || null,
    albumMeta: {
      albumId: leadProject?.album?.id || null,
      albumTitle: leadProject?.album?.title || "",
      leadProjectId: leadProjectId || null,
      trackId: entry?.id || null,
      index: entry?.index || null,
      theme: entry?.theme || "",
      trackRole: entry?.sonicRole || entry?.trackRole || null,
    },
  };
  const artwork = pickAlbumArtwork(leadProject);
  return artwork?.imageUrl ? attachCoverToProject(base, artwork) : base;
}

export function isProviderUnreachableError(message) {
  return /injoignable|ECONNREFUSED|délai dépassé|fetch failed|moteur (ACE-Step|Python)|HTTP 5\d\d/i.test(
    String(message || ""),
  );
}

/**
 * Crée (ou réutilise) un projet Studio pour un titre d’album, pour que « Ouvrir »
 * n’envoie plus toujours vers le lead.
 */
export async function ensureAlbumTrackProject(entry, { leadProject, seed, leadProjectId }) {
  if (!entry || entry.role === "lead") return { ...entry, projectId: leadProjectId };
  if (!entry.lyrics && !entry.track) return entry;
  if (entry.projectId) return entry;

  const data = await api.saveProject({
    project: buildAlbumMemberProject({ leadProject, entry, leadProjectId }),
    seed: {
      ...(seed || {}),
      theme: entry.theme || entry.workingTitle || "",
      albumId: leadProject?.album?.id,
      albumTitle: leadProject?.album?.title,
    },
    event: {
      stepKey: "album",
      eventType: "album-track",
      message: `Album · ${entry.lyrics?.title || entry.workingTitle || "titre"}`,
    },
  });
  const id = data?.project?.id;
  return id ? { ...entry, projectId: id } : entry;
}

/**
 * Sépare le catalogue artiste : albums (lead + pistes enfants) vs singles.
 * Utilise maintenant les données albums de la table dédiée.
 */
export function organizeArtistReleases(releases = [], albumsData = []) {
  if (albumsData && albumsData.length > 0) {
    const albumMap = new Map(albumsData.map((a) => [a.id, a]));
    const singles = [];
    const organizedAlbums = [];

    for (const album of albumsData) {
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
        doneCount: album.doneCount || 0,
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

  const childrenByLead = new Map();
  const leads = [];
  const singles = [];

  for (const r of releases) {
    const leadId = String(r.albumLeadId || r.albumMeta?.leadProjectId || "").trim();
    if (r.albumStatus) {
      leads.push(r);
      continue;
    }
    if (leadId && leadId !== String(r.id || "")) {
      const list = childrenByLead.get(leadId) || [];
      list.push(r);
      childrenByLead.set(leadId, list);
      continue;
    }
    singles.push(r);
  }

  const albums = leads.map((lead) => {
    const extras = childrenByLead.get(lead.id) || [];
    childrenByLead.delete(lead.id);
    const tracks = [lead, ...extras].sort(
      (a, b) => (Number(a.albumIndex) || 999) - (Number(b.albumIndex) || 999),
    );
    return {
      id: lead.id,
      title: lead.albumTitle || "Album",
      status: lead.albumStatus,
      targetCount: lead.albumTargetCount || tracks.length,
      coverUrl: lead.coverUrl || extras.find((t) => t.coverUrl)?.coverUrl || null,
      lead,
      tracks,
    };
  });

  for (const [leadId, extras] of childrenByLead) {
    const tracks = extras
      .slice()
      .sort((a, b) => (Number(a.albumIndex) || 999) - (Number(b.albumIndex) || 999));
    albums.push({
      id: leadId,
      title: extras[0]?.albumTitle || "Album",
      status: extras[0]?.albumStatus || "done",
      targetCount: extras.length,
      coverUrl: extras.find((t) => t.coverUrl)?.coverUrl || null,
      lead: extras[0],
      tracks,
    });
  }

  return { albums, singles };
}
