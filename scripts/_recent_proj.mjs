import fs from "fs";
import { createClient } from "@libsql/client";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const r = await db.execute("SELECT id, title, updated_at, project_json FROM projects ORDER BY updated_at DESC LIMIT 6");
for (const row of r.rows) {
  const p = JSON.parse(row.project_json);
  const t = p.track || {};
  const feat = p.featArtist || p.artist?.featArtist;
  console.log(row.updated_at, row.id.slice(0, 22), String(row.title).slice(0, 50));
  console.log(" ", t.provider, t.aceStepModel || "-", t.status, "feat=", feat?.name || "-", "s3=", Boolean(t.audioS3Key));
}
