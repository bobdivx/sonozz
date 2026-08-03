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
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("audio")) return "wav";
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
    try {
      url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: cfg.bucket, Key: objectKey }),
        { expiresIn: 60 * 60 * 24 * 7 },
      );
    } catch {
      /* garde l’URL construite */
    }
  }

  return {
    key: objectKey,
    url,
    mimeType,
    byteLength: buffer.length,
    bucket: cfg.bucket,
  };
}

export async function downloadClipBuffer(keyOrUrl) {
  if (!keyOrUrl) throw new Error("Clé / URL S3 manquante");

  // URL http(s) directe (publique ou déjà signée)
  if (/^https?:\/\//i.test(keyOrUrl)) {
    const res = await fetch(keyOrUrl);
    if (!res.ok) throw new Error(`Téléchargement clip HTTP ${res.status}`);
    const mimeType = res.headers.get("content-type") || "video/webm";
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mimeType };
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
    mimeType: out.ContentType || "video/webm",
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
