import fs from "fs";
import { createClient } from "@libsql/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const r = await db.execute({
  sql: `SELECT id, title, status, updated_at, project_json FROM projects ORDER BY updated_at DESC LIMIT 8`,
  args: [],
});

const out = [];
for (const row of r.rows) {
  const p = JSON.parse(row.project_json || "{}");
  const t = p.track || {};
  out.push({
    id: row.id,
    title: row.title || t.title,
    status: row.status || t.status,
    updated_at: row.updated_at,
    audioUrl: t.audioUrl || null,
    audioKey: t.audioKey || null,
    model: t.aceStepModel || t.model || p.aceStepModel || null,
    provider: t.musicProvider || p.musicProvider || null,
    feat: t.artist?.featArtist?.name || t.featArtist?.name || null,
    stylePreview: String(t.stylePrompt || t.prompt || "").slice(0, 180),
    lyricsPreview: String(t.lyrics || "").slice(0, 200),
  });
}
console.log(JSON.stringify(out, null, 2));

const latest = out.find((x) => x.audioUrl || x.audioKey) || out[0];
if (!latest) process.exit(0);

const key =
  latest.audioKey ||
  String(latest.audioUrl || "").replace(/^https?:\/\/[^/]+\//, "").split("?")[0];

if (key && process.env.S3_ACCESS_KEY) {
  const s3 = new S3Client({
    region: process.env.S3_REGION || "fr-par",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
  const bucket = process.env.S3_BUCKET || "sonozz";
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const dest = `C:/Users/auber/AppData/Local/Temp/latest-sonozz.mp3`;
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  fs.writeFileSync(dest, Buffer.concat(chunks));
  console.log(JSON.stringify({ downloaded: dest, key, bytes: fs.statSync(dest).size, project: latest.id }));
}
