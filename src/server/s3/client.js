/**
 * Stockage objet S3-compatible (AWS S3, Cloudflare R2, MinIO, Garage, Coolify…).
 *
 * Important : Vite/Astro n’injecte que les `import.meta.env.S3_*` en accès STATIQUE.
 * `import.meta.env[name]` dynamique reste toujours vide.
 */

import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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
