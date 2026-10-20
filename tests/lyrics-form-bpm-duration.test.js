import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLyricsForm } from "../src/lib/musicLane/lyricsForms.js";
import { resolveTrackBpm } from "../src/lib/trackBpm.js";
import { syncCaptionBpm } from "../src/server/aceStep/body.js";
import { estimateLyricsTiming, fitDurationToLyrics, lyricsDurationCheck } from "../src/lib/lyricsTiming.js";

const skarlLock = {
  genres: ["folk metal", "electronic", "alternative", "hip hop"],
  genreSummary: "dark folk metal with dubstep-tinged drops",
  bpm: 90,
  styleReference: { deezerTrackId: 4277012282, title: "Mantra — Bob Dominator", mode: "reference", strength: 1 },
};
const skarlArtist = { genre: "dark folk metal, electronic, viking-themed", genres: ["electro", "alternative", "rock"] };

test("référence de style → couplet/refrain/pont, jamais [Build]/[Drop] ni [Breakdown]", () => {
  const f = detectLyricsForm(skarlLock, skarlArtist);
  assert.equal(f.id, "indie_alt");
  assert.doesNotMatch(f.tagsArc, /Build|Drop|Breakdown/);
  assert.match(f.tagsArc, /Verse.*Chorus.*Bridge/);
});

test("mot « dubstep » dans le résumé ne suffit pas pour la forme EDM", () => {
  const f = detectLyricsForm({ genres: ["pop"], genreSummary: "pop with dubstep drops" }, { genre: "pop" });
  assert.notEqual(f.id, "edm");
});

test("genre principal vraiment EDM → forme EDM conservée", () => {
  assert.equal(detectLyricsForm({ genres: ["house"] }, { genre: "house" }).id, "edm");
  assert.equal(detectLyricsForm({ genres: ["techno"] }, null).id, "edm");
});

test("BPM : profil artiste prioritaire sur l'arrangement, caption réalignée", () => {
  assert.equal(resolveTrackBpm({ styleLock: { bpm: 90 }, arrangeBpm: 98 }), 90);
  assert.equal(resolveTrackBpm({ styleLock: {}, arrangeBpm: 98 }), 98);
  assert.equal(resolveTrackBpm({ styleLock: { qualityProfile: { style: { tempo: 121 } } } }), 121);
  assert.equal(resolveTrackBpm({ styleLock: {}, fallback: () => 100 }), 100);
  assert.equal(syncCaptionBpm("heavy drums, 90 BPM, call and response", 98), "heavy drums, 98 BPM, call and response");
});

const short = `[Intro]\n\n[Verse 1]\n${"On roule dans la nuit sans fin\n".repeat(6)}\n[Chorus]\n${"Jamais on ne s'arrête\n".repeat(4)}\n[Outro]`;

test("durée ajustée aux paroles : pas plus de 40 s de fin vide", () => {
  const t = estimateLyricsTiming(short);
  assert.ok(t.sungSec > 10);
  const fit = fitDurationToLyrics(short, { requestedSec: 220, min: 60, max: 480 });
  assert.ok(fit.adjusted);
  assert.ok(fit.durationSec < 220);
  assert.ok(lyricsDurationCheck(short, fit.durationSec).ok);
  assert.equal(lyricsDurationCheck(short, 240).ok, false);
});

import { checkDuoLanguages, detectLanguage } from "../src/lib/lyricsLanguage.js";

test("duo bilingue : détecte un couplet du chanteur anglais écrit en français", () => {
  const t = `[Verse]\n[singer 1: female]\nAsphalte craque sous le froid.\nOdeur essence, mon seul toit.\n\n[singer 2: male]\nRéservoir vide. Lumière crue.\nMer d'asphalte. Où irai-je ? Je ne sais pas.\n\n[Chorus]\n[singer 1: female]\nCiel gris. On ne repart pas.\n\n[singer 2: male]\nSky grey. We don't go back.\n`;
  const c = checkDuoLanguages(t, { singer1Lang: "fr", singer2Lang: "en" });
  assert.equal(c.ok, false);
  assert.equal(c.violations.length, 1);
  assert.equal(c.violations[0].singer, 2);
  assert.equal(detectLanguage("The night is on fire and we never stop", ["fr", "en"]), "en");
  assert.ok(checkDuoLanguages(t.replace("Réservoir vide. Lumière crue.\nMer d'asphalte. Où irai-je ? Je ne sais pas.", "Empty tank, the light is raw.\nWe don't know where to go."), { singer1Lang: "fr", singer2Lang: "en" }).ok);
});
