import { json, error, readBody } from "../../../server/http.js";
import { listProjects, saveProject } from "../../../server/db.js";
import { linkProjectToArtist, slugify } from "../../../server/artists.js";
import {
  isEphemeralImageUrl,
  materializeImageForStorage,
} from "../../../server/imagePersist.js";
import {
  isAudioDataUrl,
  isEphemeralAudioUrl,
  materializeAudioForStorage,
} from "../../../server/audioPersist.js";
import { isS3Configured } from "../../../server/s3.js";

export const prerender = false;

/** ~2.5 Mo — portraits/jaquettes JPEG base64 persistables sur Turso */
const MAX_DATA_URL_CHARS = 2_500_000;

function isBlobUrl(value = "") {
  return typeof value === "string" && value.startsWith("blob:");
}

function isSvgDataUrl(value = "") {
  return typeof value === "string" && /^data:image\/svg\+xml/i.test(value);
}

function isRasterDataUrl(value = "") {
  return typeof value === "string" && /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value);
}

function isHttpUrl(value = "") {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/**
 * Persiste une image en JPEG data URL durable.
 * Les URL Replicate (replicate.delivery) meurent en ~1 h — on les matérialise à la sauvegarde.
 */
async function sanitizeImageField(entity, field = "imageUrl") {
  if (!entity || typeof entity !== "object") return entity;
  const url = entity[field];
  if (!url || typeof url !== "string") return entity;

  if (isHttpUrl(url)) {
    try {
      const persisted = await materializeImageForStorage(url);
      if (persisted) {
        return { ...entity, [field]: persisted, localAsset: false, ephemeralFixed: true };
      }
    } catch {
      /* URL déjà morte */
    }
    // Ne jamais garder une URL éphémère morte en base
    if (isEphemeralImageUrl(url)) {
      return {
        ...entity,
        [field]: null,
        localAsset: true,
        assetMissingReason: "ephemeral-url-expired",
      };
    }
    // Autre HTTP (CDN stable) : on garde, mais on préfère data URL
    return { ...entity, localAsset: false };
  }

  if (isRasterDataUrl(url) && url.length <= MAX_DATA_URL_CHARS) {
    return { ...entity, localAsset: false };
  }

  // Data URL trop lourde → recompresser
  if (isRasterDataUrl(url) && url.length > MAX_DATA_URL_CHARS) {
    try {
      const persisted = await materializeImageForStorage(url);
      if (persisted) return { ...entity, [field]: persisted, localAsset: false };
    } catch {
      /* fallthrough */
    }
    return {
      ...entity,
      [field]: null,
      localAsset: true,
      assetMissingReason: "data-url-too-large",
    };
  }

  if (isSvgDataUrl(url) || isBlobUrl(url) || url.startsWith("data:")) {
    return {
      ...entity,
      [field]: null,
      localAsset: true,
      assetMissingReason: isSvgDataUrl(url)
        ? "svg-not-persisted"
        : isBlobUrl(url)
          ? "blob-not-persisted"
          : "data-url-too-large",
    };
  }

  return entity;
}

async function sanitizeProject(project = {}, { projectId } = {}) {
  const clone = structuredClone(project);

  if (clone.artist) {
    clone.artist = await sanitizeImageField(clone.artist, "imageUrl");
    if (!clone.artist.slug && clone.artist.name) {
      clone.artist.slug = slugify(clone.artist.aka || clone.artist.name);
    }
  }

  if (clone.cover) {
    clone.cover = await sanitizeImageField(clone.cover, "imageUrl");
  }

  async function sanitizeTrackAudio(trackObj) {
    if (!trackObj || typeof trackObj !== "object") return trackObj;
    const audio = trackObj.audioUrl;
    if (typeof audio !== "string" || audio.length === 0) return trackObj;

    const needsPersist =
      isAudioDataUrl(audio) ||
      isEphemeralAudioUrl(audio) ||
      audio.startsWith("blob:");

    if (audio.startsWith("blob:")) {
      return {
        ...trackObj,
        audioUrl: null,
        localAsset: true,
        status: "audio-was-local",
        assetMissingReason: "blob-not-persisted",
        warning: "Audio blob perdu — réimporte le fichier mp3.",
      };
    }
    if (!needsPersist) return trackObj;

    try {
      if (!isS3Configured()) {
        let next = {
          ...trackObj,
          audioEphemeral: isEphemeralAudioUrl(audio),
          warning: isAudioDataUrl(audio)
            ? "Audio data: trop lourd pour Turso sans S3 — configure S3 sinon perte au reload."
            : "Audio Replicate non persisté (expire ~1 h) — configure S3.",
        };
        if (isAudioDataUrl(audio)) {
          next = {
            ...next,
            audioUrl: null,
            localAsset: true,
            status: "audio-was-local",
            assetMissingReason: "audio-data-not-persisted-no-s3",
          };
        }
        return next;
      }
      const saved = await materializeAudioForStorage(audio, {
        projectId: projectId || clone.id || clone.artist?.slug || "anon",
      });
      if (saved?.url) {
        return {
          ...trackObj,
          audioUrl: saved.url,
          audioS3Key: saved.s3Key || trackObj.audioS3Key,
          localAsset: false,
          audioEphemeral: false,
          status: "audio-ready",
          warning: undefined,
          assetMissingReason: undefined,
        };
      }
    } catch (e) {
      console.warn("[projects] persist audio:", e.message);
      if (isEphemeralAudioUrl(audio) || isAudioDataUrl(audio)) {
        return {
          ...trackObj,
          audioUrl: isEphemeralAudioUrl(audio) ? audio : null,
          audioEphemeral: true,
          warning: e.message || "Persistance audio échouée",
          assetMissingReason: "audio-persist-failed",
        };
      }
    }
    return trackObj;
  }

  if (clone.track) {
    clone.track = await sanitizeTrackAudio(clone.track);
  }

  // Album autonome : chaque piste doit être matérialisée (sinon URL Replicate expire)
  if (clone.album && Array.isArray(clone.album.tracks)) {
    clone.album = {
      ...clone.album,
      tracks: await Promise.all(
        clone.album.tracks.map(async (entry) => {
          if (!entry?.track) return entry;
          return { ...entry, track: await sanitizeTrackAudio(entry.track) };
        }),
      ),
    };
  }

  // Clip : garder URL S3/http ; strip uniquement data: / blob: (trop lourds pour Turso)
  function sanitizeClipMeta(clip) {
    if (!clip || typeof clip !== "object") return clip;
    const { videoBase64, videoUrl, ...meta } = clip;
    const remoteUrl =
      typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : null;
    const heavyData =
      (typeof videoBase64 === "string" && videoBase64.startsWith("data:")) ||
      (typeof videoUrl === "string" && videoUrl.startsWith("data:"));

    const light = {
      ...meta,
      videoBase64: undefined,
      videoUrl: remoteUrl || undefined,
      s3Key: meta.s3Key || undefined,
      storedRemote: Boolean(remoteUrl || meta.s3Key || meta.storedRemote),
      storedLocally: Boolean(meta.storedLocally && !remoteUrl),
      mimeType: meta.mimeType || "video/webm",
    };

    if (!remoteUrl && (heavyData || meta.storedLocally)) {
      light.storedLocally = true;
    }
    return light;
  }

  if (clone.clip && typeof clone.clip === "object") {
    clone.clip = sanitizeClipMeta(clone.clip);
  }
  if (Array.isArray(clone.clips)) {
    clone.clips = clone.clips.map(sanitizeClipMeta);
  }

  return clone;
}

export async function GET() {
  try {
    const projects = await listProjects(80);
    return json({ projects });
  } catch (e) {
    return error(e.message || "Erreur liste projets", 500);
  }
}

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const project = await sanitizeProject(body.project || {}, { projectId: body.id });
    const saved = await saveProject({
      id: body.id || null,
      project,
      seed: body.seed || {},
      event: body.event || {
        eventType: "save",
        stepKey: body.stepKey || null,
        message: body.message || "Projet sauvegardé",
      },
    });

    let artistHub = null;
    if (project.artist?.name) {
      try {
        artistHub = await linkProjectToArtist(saved.id, project.artist);
        if (artistHub?.slug && saved.project?.artist) {
          saved.project.artist = { ...saved.project.artist, slug: artistHub.slug };
        }
      } catch {
        /* hub optionnel */
      }
    }

    return json({ project: saved, artist: artistHub });
  } catch (e) {
    return error(e.message || "Erreur sauvegarde", 500);
  }
}
