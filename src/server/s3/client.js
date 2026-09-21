/**
 * Stockage objet S3-compatible (AWS S3, Cloudflare R2, MinIO, Garage, Coolify…).
 *
 * Important : Vite/Astro n’injecte que les `import.meta.env.*` en accès STATIQUE.
 * `import.meta.env[name]` dynamique reste toujours vide.
 *
 * Prod DevForge : souvent SCW_* (Scaleway) plutôt que S3_*.
 */

import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function readS3Env() {
  const meta = import.meta.env || {};
  const proc = typeof process !== "undefined" ? process.env || {} : {};

  // Accès statiques pour le bundler Vite (ne pas factoriser en meta[name])
  const bucket = firstNonEmpty(
    meta.S3_BUCKET,
    proc.S3_BUCKET,
    meta.SCW_BUCKET,
    proc.SCW_BUCKET,
  );
  const accessKeyId = firstNonEmpty(
    meta.S3_ACCESS_KEY_ID,
    proc.S3_ACCESS_KEY_ID,
    meta.SCW_ACCESS_KEY,
    proc.SCW_ACCESS_KEY,
    meta.AWS_ACCESS_KEY_ID,
    proc.AWS_ACCESS_KEY_ID,
  );
  const secretAccessKey = firstNonEmpty(
    meta.S3_SECRET_ACCESS_KEY,
    proc.S3_SECRET_ACCESS_KEY,
    meta.SCW_SECRET_KEY,
    proc.SCW_SECRET_KEY,
    meta.AWS_SECRET_ACCESS_KEY,
    proc.AWS_SECRET_ACCESS_KEY,
  );
  const region =
    firstNonEmpty(meta.S3_REGION, proc.S3_REGION, meta.SCW_REGION, proc.SCW_REGION) ||
    "auto";

  let endpoint =
    firstNonEmpty(meta.S3_ENDPOINT, proc.S3_ENDPOINT) || undefined;
  // Scaleway : dériver l’endpoint si seul SCW_REGION est fourni
  if (!endpoint && region && region !== "auto" && (bucket || accessKeyId)) {
    const looksScw = Boolean(
      firstNonEmpty(meta.SCW_BUCKET, proc.SCW_BUCKET, meta.SCW_ACCESS_KEY, proc.SCW_ACCESS_KEY),
    );
    if (looksScw || /^(fr-par|nl-ams|pl-waw)$/i.test(region)) {
      endpoint = `https://s3.${region}.scw.cloud`;
    }
  }

  const publicBase = firstNonEmpty(
    meta.S3_PUBLIC_URL,
    proc.S3_PUBLIC_URL,
    meta.PUBLIC_OBJECT_STORAGE_URL,
    proc.PUBLIC_OBJECT_STORAGE_URL,
  ).replace(/\/$/, "");

  const forcePathStyleRaw = firstNonEmpty(
    meta.S3_FORCE_PATH_STYLE,
    proc.S3_FORCE_PATH_STYLE,
  );

  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    endpoint,
    publicBase,
    forcePathStyle: forcePathStyleRaw === "1" || forcePathStyleRaw === "true",
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
      "S3 non configuré. Ajoute S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY (ou SCW_BUCKET + SCW_ACCESS_KEY + SCW_SECRET_KEY) dans l’env.",
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
    // Scaleway / R2 / MinIO : les checksums flexibles AWS (SDK ≥ 3.729) cassent GetObject
    // et injectent x-amz-checksum-mode=ENABLED dans les URL signées → 403.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

/** Ping config (bucket accessible) + nombre d’objets. */
export async function testS3Connection() {
  if (!isS3Configured()) {
    return { ok: false, message: "Variables S3 / SCW manquantes", configured: false };
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
