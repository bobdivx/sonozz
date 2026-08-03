/**
 * Restaure Rayon-de-Soleil (ou un autre audio) vers S3 + projet Turso Kaelen.
 *
 * Usage:
 *   node scripts/restore-audio.mjs
 *   node scripts/restore-audio.mjs ./mon-fichier.mp3
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve } from "path";
import { createClient } from "@libsql/client";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PROJECT_ID = "proj_msctf9ak_93331q";

function loadEnv() {
  const env = Object.fromEntries(
    readFileSync(".env", "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
}

function sniffMime(buf) {
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "audio/mpeg";
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "audio/mpeg";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return "audio/wav";
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79) return "audio/mp4";
  return "audio/mpeg";
}

loadEnv();

const inputPath = resolve(process.argv[2] || "./Rayon-de-Soleil.mpeg");
if (!existsSync(inputPath)) {
  console.error("Fichier introuvable:", inputPath);
  process.exit(1);
}

const size = statSync(inputPath).size;
console.log("Fichier:", inputPath, "·", size, "octets");
if (size < 50_000) {
  console.error(
    "Fichier trop petit / vide (" +
      size +
      " o). Recopie le vrai mp3 (souvent plusieurs Mo pour 2–4 min), puis relance.",
  );
  process.exit(1);
}

const buffer = readFileSync(inputPath);
const head = buffer.subarray(0, 32).toString("utf8").toLowerCase();
if (head.includes("<html") || head.includes("<!doctype") || head.startsWith("{")) {
  console.error("Ce n’est pas de l’audio (HTML/JSON).");
  process.exit(1);
}

const mimeType = sniffMime(buffer);
const ext = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "mp3";
const key = `audio/${PROJECT_ID}/rayon-de-soleil.${ext}`;

const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});

// Nettoie l’ancien faux upload JSON
try {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: "audio/proj_msctf9ak_93331q/rayon-de-soleil-restored.mp3",
    }),
  );
} catch {
  /* ignore */
}

await s3.send(
  new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: "public, max-age=31536000, immutable",
  }),
);

const audioUrl = await getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  { expiresIn: 60 * 60 * 24 * 7 },
);

const verify = await fetch(audioUrl);
const vbuf = Buffer.from(await verify.arrayBuffer());
console.log("S3 OK", key, "· verify", verify.status, vbuf.length, "bytes");

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const row = (
  await db.execute({
    sql: "SELECT project_json FROM projects WHERE id = ?",
    args: [PROJECT_ID],
  })
).rows[0];
if (!row) {
  console.error("Projet Turso introuvable:", PROJECT_ID);
  process.exit(1);
}

const p = JSON.parse(row.project_json);
p.track = {
  ...(p.track || {}),
  title: p.track?.title || p.lyrics?.title || "Rayon de Soleil",
  audioUrl,
  audioS3Key: key,
  audioEphemeral: false,
  status: "audio-ready",
  provider: p.track?.provider || "import-file",
  warning: undefined,
  assetMissingReason: undefined,
  note: "Audio restauré depuis fichier local → S3",
  restoredAt: new Date().toISOString(),
};

await db.execute({
  sql: "UPDATE projects SET project_json = ?, updated_at = ?, track_title = ? WHERE id = ?",
  args: [
    JSON.stringify(p),
    new Date().toISOString(),
    p.track.title,
    PROJECT_ID,
  ],
});

console.log("Turso mis à jour · projet", PROJECT_ID);
console.log("Recharge le projet Kaelen dans le Studio (Historique).");
