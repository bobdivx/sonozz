import { createClient } from "@libsql/client";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const t0 = Date.now();
const artists = await db.execute({
  sql: `SELECT slug, name, length(profile_json) as plen, length(stats_json) as slen FROM artists WHERE slug = ?`,
  args: ["kaelen"],
});
console.log("artist", artists.rows[0], "ms", Date.now() - t0);

const t1 = Date.now();
const projects = await db.execute({
  sql: `SELECT id, title, length(project_json) as jlen, artist_slug, artist_name
        FROM projects
        WHERE artist_slug = ? OR lower(artist_name) LIKE ?
        ORDER BY updated_at DESC LIMIT 10`,
  args: ["kaelen", "%kaelen%"],
});
console.log(
  "projects",
  projects.rows.map((r) => ({
    id: r.id,
    title: r.title,
    jlen: Number(r.jlen),
    mb: (Number(r.jlen) / 1e6).toFixed(2),
    slug: r.artist_slug,
  })),
  "ms",
  Date.now() - t1,
);

for (const row of projects.rows.slice(0, 3)) {
  const t = Date.now();
  const full = await db.execute({
    sql: `SELECT project_json FROM projects WHERE id = ?`,
    args: [row.id],
  });
  const raw = full.rows[0]?.project_json || "";
  console.log("fetch", row.id, "chars", raw.length, "ms", Date.now() - t);
  const t2 = Date.now();
  const p = JSON.parse(raw);
  console.log("parse ms", Date.now() - t2, {
    hasClip: Boolean(p.clip?.videoBase64 || p.clip?.videoUrl),
    clipLen: String(p.clip?.videoBase64 || p.clip?.videoUrl || "").length,
    audioLen: String(p.track?.audioUrl || "").length,
    coverLen: String(p.cover?.imageUrl || "").length,
    portraitLen: String(p.artist?.imageUrl || "").length,
  });
}
