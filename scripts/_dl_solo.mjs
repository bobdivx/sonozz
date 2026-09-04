import fs from "fs";
import { createClient } from "@libsql/client";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await db.execute({ sql: "SELECT project_json FROM projects WHERE id = ?", args: ["proj_mtmgw448_7quvdv"] });
const t = JSON.parse(r.rows[0].project_json).track;
console.log({ model: t.aceStepModel, key: t.audioS3Key, note: t.note });
const s3 = new S3Client({
  region: process.env.S3_REGION,
  endpoint: process.env.S3_ENDPOINT,
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
  forcePathStyle: true,
});
const out = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: t.audioS3Key }));
const bytes = Buffer.from(await out.Body.transformToByteArray());
fs.writeFileSync(process.env.TEMP + "/solo-sft.mp3", bytes);
console.log("bytes", bytes.length);
