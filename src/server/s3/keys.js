import { getS3Config } from "./client.js";

export function extFromMime(mime = "") {
  const m = String(mime || "").toLowerCase();
  if (m.includes("flac")) return "flac";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return m.includes("audio") ? "m4a" : "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime")) return "mov";
  if (m.includes("wav")) return "wav";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("audio")) return "wav";
  return "webm";
}

export function buildClipObjectKey({ projectId, mimeType }) {
  const id = String(projectId || "anon")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  const stamp = Date.now();
  const ext = extFromMime(mimeType);
  return `clips/${id}/${stamp}.${ext}`;
}

export function publicUrlForKey(key) {
  const cfg = getS3Config();
  const cleanKey = key.replace(/^\//, "");
  if (cfg.publicBase) {
    return `${cfg.publicBase}/${cleanKey}`;
  }
  // Scaleway / virtual-host : https://bucket.s3.fr-par.scw.cloud/key
  if (cfg.endpoint && /scw\.cloud/i.test(cfg.endpoint)) {
    const host = cfg.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "");
    // endpoint régional s3.fr-par.scw.cloud → bucket.s3.fr-par.scw.cloud
    if (host.startsWith("s3.")) {
      return `https://${cfg.bucket}.${host}/${cleanKey}`;
    }
    return `https://${host}/${cleanKey}`;
  }
  if (cfg.endpoint) {
    const base = cfg.endpoint.replace(/\/$/, "");
    if (cfg.forcePathStyle) return `${base}/${cfg.bucket}/${cleanKey}`;
    const host = base.replace(/^https?:\/\//, "");
    return `https://${cfg.bucket}.${host}/${cleanKey}`;
  }
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${cleanKey}`;
}

export function hostnameOf(value = "") {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** True seulement pour notre bucket / CDN — pas ACE-Step ni un autre /audio/…. */
export function isOurS3Hostname(hostname, cfg = getS3Config()) {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  const bucket = String(cfg.bucket || "").toLowerCase();
  if (bucket && (host === bucket || host.startsWith(`${bucket}.`))) return true;
  if (/sonozz/i.test(host)) return true;
  const publicHost = hostnameOf(cfg.publicBase);
  if (publicHost && host === publicHost) return true;
  const endpointHost = hostnameOf(cfg.endpoint);
  if (endpointHost && (host === endpointHost || (bucket && host === `${bucket}.${endpointHost}`))) {
    return true;
  }
  const region = String(cfg.region || "").toLowerCase();
  if (bucket && region && host === `${bucket}.s3.${region}.amazonaws.com`) return true;
  return false;
}

/**
 * Extrait une clé objet `audio/…` ou `clips/…` depuis une URL S3 sonozz / Scaleway.
 * Ignore les hôtes étrangers (ACE-Step `/audio/…` n'est pas une clé bucket).
 * @returns {string|null}
 */
export function tryParseS3ObjectKey(urlOrKey = "") {
  const raw = String(urlOrKey || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) {
    const key = raw.replace(/^\//, "");
    return /^(audio|clips)\//i.test(key) && !key.includes("..") ? key : null;
  }
  try {
    const u = new URL(raw);
    const cfg = getS3Config();
    if (!isOurS3Hostname(u.hostname, cfg)) return null;
    let path = decodeURIComponent(u.pathname.replace(/^\//, ""));
    // path-style : /bucket/audio/...
    if (cfg.bucket && path.startsWith(`${cfg.bucket}/`)) {
      path = path.slice(cfg.bucket.length + 1);
    }
    if (/^(audio|clips)\//i.test(path) && !path.includes("..")) return path;
  } catch {
    /* ignore */
  }
  return null;
}

export function isOurS3Url(url = "") {
  return Boolean(tryParseS3ObjectKey(url));
}
