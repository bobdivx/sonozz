import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, getS3Config, isS3Configured } from "./client.js";
import { buildClipObjectKey, publicUrlForKey, tryParseS3ObjectKey } from "./keys.js";

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

/**
 * Supprime une liste de clés objet (audio/… ou clips/…).
 * Ignore silencieusement si S3 n’est pas configuré.
 * @returns {{ deleted: number, skipped: boolean }}
 */
export async function deleteS3Keys(keys = []) {
  const clean = [
    ...new Set(
      (Array.isArray(keys) ? keys : [])
        .map((k) => String(k || "").trim().replace(/^\//, ""))
        .filter((k) => k && !k.includes("..") && /^(audio|clips)\//i.test(k)),
    ),
  ];
  if (!clean.length) return { deleted: 0, skipped: false };
  if (!isS3Configured()) return { deleted: 0, skipped: true };

  const s3 = getS3Client();
  const cfg = getS3Config();
  let deleted = 0;
  for (let i = 0; i < clean.length; i += 1000) {
    const chunk = clean.slice(i, i + 1000);
    const out = await s3.send(
      new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
    deleted += chunk.length - (out.Errors?.length || 0);
  }
  return { deleted, skipped: false };
}

/**
 * Liste puis supprime tous les objets sous un préfixe (ex. `audio/proj_xxx/`).
 * @returns {{ deleted: number, skipped: boolean }}
 */
export async function deleteS3Prefix(prefix = "") {
  const clean = String(prefix || "")
    .trim()
    .replace(/^\//, "")
    .replace(/\.\./g, "");
  if (!clean || !/^(audio|clips)\//i.test(clean)) {
    return { deleted: 0, skipped: false };
  }
  if (!isS3Configured()) return { deleted: 0, skipped: true };

  const s3 = getS3Client();
  const cfg = getS3Config();
  const keys = [];
  let token;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: clean.endsWith("/") ? clean : `${clean}/`,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const obj of listed.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);

  return deleteS3Keys(keys);
}
