import { json, error, readBody } from "../../../server/http.js";
import { listProjects, saveProject } from "../../../server/db.js";
import { linkProjectToArtist, slugify } from "../../../server/artists.js";
import {
  isEphemeralImageUrl,
  materializeImageForStorage,
} from "../../../server/imagePersist.js";

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

async function sanitizeProject(project = {}) {
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

  const audio = clone.track?.audioUrl;
  if (typeof audio === "string" && (audio.startsWith("data:") || audio.startsWith("blob:"))) {
    clone.track = {
      ...clone.track,
      audioUrl: null,
      localAsset: true,
      status: "audio-was-local",
      assetMissingReason: "audio-data-not-persisted",
    };
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
    const project = await sanitizeProject(body.project || {});
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
