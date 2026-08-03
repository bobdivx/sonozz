/**
 * Purge les videoBase64 / data URL géantes des project_json Turso.
 * Usage: node scripts/purge-heavy-clips.mjs
 */
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

const list = await db.execute({
  sql: `SELECT id, title, length(project_json) AS jlen FROM projects ORDER BY jlen DESC LIMIT 30`,
});

console.log(
  "Top projets:",
  list.rows.map((r) => ({ id: r.id, title: r.title, mb: (Number(r.jlen) / 1e6).toFixed(2) })),
);

for (const row of list.rows) {
  const jlen = Number(row.jlen);
  if (jlen < 2_000_000) continue;

  console.log("Purge", row.id, `(${(jlen / 1e6).toFixed(2)} Mo)…`);
  const full = await db.execute({
    sql: `SELECT project_json FROM projects WHERE id = ?`,
    args: [row.id],
  });
  let project;
  try {
    project = JSON.parse(full.rows[0].project_json);
  } catch (e) {
    console.error("  JSON KO", e.message);
    continue;
  }

  let changed = false;
  if (project.clip) {
    const { videoBase64, videoUrl, ...meta } = project.clip;
    const remote =
      typeof videoUrl === "string" && /^https?:\/\//i.test(videoUrl) ? videoUrl : undefined;
    const heavy =
      (typeof videoBase64 === "string" && videoBase64.length > 1000) ||
      (typeof videoUrl === "string" && videoUrl.startsWith("data:"));
    if (heavy || videoBase64) {
      project.clip = {
        ...meta,
        videoUrl: remote,
        storedRemote: Boolean(remote || meta.s3Key),
        storedLocally: false,
        purgedAt: new Date().toISOString(),
      };
      changed = true;
    }
  }

  for (const path of [
    ["track", "audioUrl"],
    ["cover", "imageUrl"],
    ["artist", "imageUrl"],
  ]) {
    const [ent, field] = path;
    const url = project[ent]?.[field];
    if (typeof url === "string" && url.startsWith("data:") && url.length > 2_500_000) {
      project[ent] = { ...project[ent], [field]: null, localAsset: true, purgedAt: new Date().toISOString() };
      changed = true;
    }
  }

  if (!changed) {
    console.log("  rien à purger");
    continue;
  }

  const next = JSON.stringify(project);
  await db.execute({
    sql: `UPDATE projects SET project_json = ?, updated_at = ? WHERE id = ?`,
    args: [next, new Date().toISOString(), row.id],
  });
  console.log(`  OK ${(jlen / 1e6).toFixed(2)} Mo → ${(next.length / 1e6).toFixed(2)} Mo`);
}

console.log("Done.");
