import fs from "fs";
import { createClient } from "@libsql/client";

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
  sql: "SELECT project_json FROM projects WHERE id = ?",
  args: [id],
});
const p = JSON.parse(r.rows[0].project_json);
fs.writeFileSync("C:/Users/auber/AppData/Local/Temp/proj_full.json", JSON.stringify(p, null, 2));
const t = p.track || {};
console.log("top", Object.keys(p));
console.log("trackKeys", Object.keys(t));
for (const [k, v] of Object.entries({ ...p, ...t })) {
  if (typeof v === "string" && v.length > 60) {
    console.log(`STR ${k} len=${v.length}:`, v.slice(0, 200).replace(/\n/g, "|"));
  }
}
if (t.artist) console.log("artist", JSON.stringify(t.artist).slice(0, 500));
if (t.featArtist) console.log("featArtist", JSON.stringify(t.featArtist).slice(0, 500));
if (p.albums || p.tracks) console.log("albums/tracks present");
// nested album tracks?
if (Array.isArray(p.tracks)) {
  console.log(
    "tracks",
    p.tracks.map((x) => ({ title: x.title, audio: !!x.audioUrl, lyrics: String(x.lyrics || "").length })),
  );
}
