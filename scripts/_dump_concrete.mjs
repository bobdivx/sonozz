import fs from "fs";
import { createClient } from "@libsql/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const id = process.argv[2] || "proj_mtkrhz36_ty1zlb";
const r = await db.execute({
  sql: `SELECT project_json FROM projects WHERE id = ?`,
  args: [id],
});
const p = JSON.parse(r.rows[0].project_json);
const t = p.track || p;
const summary = {
  id,
  title: t.title,
  model: t.aceStepModel,
  bpm: t.bpm,
  coverUrl: t.referenceAudioUrl || t.coverUrl || t.styleReferenceUrl || null,
  audioCoverStrength: t.audioCoverStrength,
  feat: t.artist?.featArtist || t.featArtist || null,
  style: String(t.stylePrompt || t.prompt || t.style || "").slice(0, 600),
  lyrics: String(t.lyrics || "").slice(0, 1200),
  audioUrl: t.audioUrl,
};
fs.writeFileSync(
  "C:/Users/auber/AppData/Local/Temp/proj_dump.json",
  JSON.stringify({ trackKeys: Object.keys(t), summary, track: t }, null, 2),
);
console.log(JSON.stringify(summary, null, 2));

const url = String(t.audioUrl || "");
const key = url.replace(/^https?:\/\/[^/]+\//, "").split("?")[0];
if (key) {
  const s3 = new S3Client({
    region: process.env.S3_REGION || "fr-par",
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });
  const res = await s3.send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET || "sonozz", Key: key }),
  );
  const chunks = [];
  for await (const c of res.Body) chunks.push(c);
  const dest = "C:/Users/auber/AppData/Local/Temp/concrete-latest.mp3";
  fs.writeFileSync(dest, Buffer.concat(chunks));
  console.log(JSON.stringify({ downloaded: dest, key, bytes: Buffer.concat(chunks).length }));
}
