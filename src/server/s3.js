/**
 * Stockage objet S3-compatible (AWS S3, Cloudflare R2, MinIO, Garage, Coolify…).
 *
 * Important : Vite/Astro n’injecte que les `import.meta.env.S3_*` en accès STATIQUE.
 * `import.meta.env[name]` dynamique reste toujours vide.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function readS3Env() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};
  const pick = (key) => String(meta[key] || proc[key] || "").trim();
  // Accès statiques pour le bundler Vite (ne pas factoriser en meta[name])
  const bucket = String(meta.S3_BUCKET || proc.S3_BUCKET || "").trim();
  const accessKeyId = String(meta.S3_ACCESS_KEY_ID || proc.S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(
    meta.S3_SECRET_ACCESS_KEY || proc.S3_SECRET_ACCESS_KEY || "",
  ).trim();
  const region = String(meta.S3_REGION || proc.S3_REGION || "auto").trim() || "auto";
  const endpoint = String(meta.S3_ENDPOINT || proc.S3_ENDPOINT || "").trim() || undefined;
  const publicBase = String(meta.S3_PUBLIC_URL || proc.S3_PUBLIC_URL || "")
    .trim()
    .replace(/\/$/, "");
  const forcePathStyleRaw = String(
    meta.S3_FORCE_PATH_STYLE || proc.S3_FORCE_PATH_STYLE || "",
  ).trim();
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    endpoint,
    publicBase,
    forcePathStyle: forcePathStyleRaw === "1" || forcePathStyleRaw === "true",
    // unused helper kept for clarity
    pick,
  };
}

let client;

export function isS3Configured() {
  const cfg = readS3Env();
  return Boolean(cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey);
}

export function getS3Config() {
  return readS3Env();
}

export function getS3Client() {
  if (client) return client;
  if (!isS3Configured()) {
    throw new Error(
      "S3 non configuré. Ajoute S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (et S3_ENDPOINT pour R2/MinIO) dans .env",
    );
  }
  const cfg = getS3Config();
  client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return client;
}

function extFromMime(mime = "") {
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

function publicUrlForKey(key) {
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

/**
 * Extrait une clé objet `audio/…` ou `clips/…` depuis une URL S3 sonozz / Scaleway.
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
    let path = decodeURIComponent(u.pathname.replace(/^\//, ""));
    // path-style : /bucket/audio/...
    if (cfg.bucket && path.startsWith(`${cfg.bucket}/`)) {
      path = path.slice(cfg.bucket.length + 1);
    }
    if (/^(audio|clips)\//i.test(path) && !path.includes("..")) return path;
    // virtual-host bucket.s3…/audio/...
    if (
      cfg.bucket &&
      (u.hostname === cfg.bucket ||
        u.hostname.startsWith(`${cfg.bucket}.`) ||
        /sonozz/i.test(u.hostname))
    ) {
      if (/^(audio|clips)\//i.test(path) && !path.includes("..")) return path;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isOurS3Url(url = "") {
  return Boolean(tryParseS3ObjectKey(url));
}

/**
 * Upload un buffer vidéo → retourne clé + URL publique (ou signée).
 */
export async function uploadClipBuffer(buffer, { projectId, mimeType = "video/webm", key } = {}) {
  if (!buffer?.length) throw new Error("Buffer vidéo vide");
  const s3 = getS3Client();
  const cfg = getS3Config();
  const objectKey = key || buildClipObjectKey({ projectId, mimeType });

  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  let url = publicUrlForKey(objectKey);
  // Bucket privé sans S3_PUBLIC_URL → URL signée longue durée (7 j)
  if (!cfg.publicBase) {
    url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }),
      { expiresIn: 60 * 60 * 24 * 7 },
    );
  }

  return {
    key: objectKey,
    url,
    mimeType,
    byteLength: buffer.length,
    bucket: cfg.bucket,
  };
}

/** URL signée GET pour un objet (bucket privé — ONCE / externes). */
export async function signedUrlForKey(key, expiresIn = 60 * 60 * 24 * 7) {
  const clean = String(key || "")
    .trim()
    .replace(/^\//, "");
  if (!clean || clean.includes("..") || !/^(audio|clips)\//i.test(clean)) {
    throw new Error("Clé S3 invalide pour signature");
  }
  const s3 = getS3Client();
  const cfg = getS3Config();
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: cfg.bucket, Key: clean }),
    { expiresIn: Math.max(60, Math.min(expiresIn, 60 * 60 * 24 * 7)) },
  );
}

export async function downloadClipBuffer(keyOrUrl) {
  if (!keyOrUrl) throw new Error("Clé / URL S3 manquante");

  const parsedKey = tryParseS3ObjectKey(keyOrUrl);
  if (parsedKey && isS3Configured()) {
    const s3 = getS3Client();
    const cfg = getS3Config();
    try {
      const out = await s3.send(
        new GetObjectCommand({ Bucket: cfg.bucket, Key: parsedKey }),
      );
      const bytes = await out.Body?.transformToByteArray?.();
      if (!bytes) throw new Error("Objet S3 vide");
      return {
        buffer: Buffer.from(bytes),
        mimeType: out.ContentType || "application/octet-stream",
        key: parsedKey,
      };
    } catch (e) {
      // Si la clé ne match pas / accès ko, tenter fetch HTTP (URL signée)
      if (!/^https?:\/\//i.test(keyOrUrl)) {
        throw new Error(`Lecture S3 « ${parsedKey} »: ${e.message || e}`);
      }
    }
  }

  // URL http(s) directe (publique ou déjà signée)
  if (/^https?:\/\//i.test(keyOrUrl)) {
    const res = await fetch(keyOrUrl);
    if (!res.ok) {
      throw new Error(
        `Téléchargement audio/clip HTTP ${res.status}${
          res.status === 403
            ? " — bucket privé : utilise la clé S3 (stream?key=) ou une URL signée"
            : ""
        }`,
      );
    }
    const mimeType = res.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType, key: parsedKey || null };
  }

  const s3 = getS3Client();
  const cfg = getS3Config();
  const out = await s3.send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: keyOrUrl }),
  );
  const bytes = await out.Body?.transformToByteArray?.();
  if (!bytes) throw new Error("Objet S3 vide");
  return {
    buffer: Buffer.from(bytes),
    mimeType: out.ContentType || "application/octet-stream",
    key: keyOrUrl,
  };
}

/** Ping config (bucket accessible) + nombre d’objets. */
export async function testS3Connection() {
  if (!isS3Configured()) {
    return { ok: false, message: "Variables S3 manquantes", configured: false };
  }
  try {
    const s3 = getS3Client();
    const cfg = getS3Config();
    await s3.send(new HeadBucketCommand({ Bucket: cfg.bucket }));
    let objectCount = 0;
    try {
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1000 }),
      );
      objectCount = listed.KeyCount ?? listed.Contents?.length ?? 0;
    } catch {
      /* list optionnelle */
    }
    return {
      ok: true,
      configured: true,
      message: `Bucket « ${cfg.bucket} » OK · ~${objectCount} objet(s)`,
      endpoint: cfg.endpoint || "AWS default",
      publicBase: cfg.publicBase || null,
      objectCount,
      bucket: cfg.bucket,
      region: cfg.region,
    };
  } catch (e) {
    return { ok: false, configured: true, message: e.message || "S3 inaccessible" };
  }
}
