import fs from "fs";
const p = JSON.parse(fs.readFileSync("C:/Users/auber/AppData/Local/Temp/proj_full.json", "utf8"));
const lyr = p.lyrics;
console.log("lyrics type", typeof lyr, Array.isArray(lyr));
if (lyr && typeof lyr === "object") {
  console.log("lyrics keys", Object.keys(lyr));
  for (const [k, v] of Object.entries(lyr)) {
    if (typeof v === "string") console.log(k, v.length, v.slice(0, 150).replace(/\n/g, "|"));
    else console.log(k, typeof v, Array.isArray(v) ? v.length : "");
  }
}
if (Array.isArray(p.lyricsVersions)) {
  console.log(
    "versions",
    p.lyricsVersions.map((v) => ({
      id: v.id,
      keys: Object.keys(v),
      textLen: String(v.text || v.lyrics || v.content || "").length,
    })),
  );
}
console.log("activeLyricsId", p.activeLyricsId);
console.log("featArtist.voice", p.featArtist?.voice);
console.log("track.sunoPrompt len", String(p.track?.sunoPrompt || "").length);
