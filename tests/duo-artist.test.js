import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVocalists,
  mergeDuoVocals,
  duoChorusMode,
  vocalistTimbreLine,
  applyDuoToProfile,
  withDuoPartner,
  isDuoArtist,
} from "../src/lib/duoVocals.js";
import { buildCloneSoundPatch } from "../src/lib/styleFidelity.js";
import { buildAceStepDuoStyle } from "../src/lib/featArtist/aceStepStyle.js";
import { ensureAceStepDuoSingerTags } from "../src/lib/featArtist/aceStepLyrics.js";
import { duoLyricsInstruction } from "../src/lib/featArtist/duoLyrics.js";
import { normalizeFeatArtist, displayArtistCredit } from "../src/lib/featArtist/index.js";

const HEARD = [
  {
    vocalists: [
      { gender: "female", range: "mezzo, strong chest belt", texture: "bright, slightly raspy", delivery: "powerful sung lead", effects: "plate reverb", share: "lead" },
      { gender: "male", range: "baritone", texture: "gritty", delivery: "shouted chant", effects: "double-tracked", share: "co-lead" },
    ],
    vocalInteraction: "female sings verses, male shouts the pre-chorus, both harmonise the chorus",
  },
  {
    vocalists: [{ gender: "female", range: "mezzo", texture: "bright", delivery: "sung", share: "lead" }],
  },
];

const LOCK = {
  genreSummary: "Nordic electro-rock",
  genres: ["Electro", "Rock"],
  instruments: ["distorted guitars", "analog synths", "war drums"],
  mood: "epic",
  bpm: 128,
};

describe("duo : écoute", () => {
  it("détecte femme + homme et garde la description la plus riche", () => {
    const dv = mergeDuoVocals(HEARD);
    assert.ok(dv);
    assert.equal(dv.female.range, "mezzo, strong chest belt");
    assert.equal(dv.male.delivery, "shouted chant");
    assert.equal(dv.female.heardIn, 2);
    assert.equal(dv.chorus, "both");
    assert.match(dv.interaction, /pre-chorus/);
  });

  it("pas de duo si une seule voix (ou chœur en backing)", () => {
    assert.equal(mergeDuoVocals([HEARD[1]]), null);
    assert.equal(
      mergeDuoVocals([{ vocalists: [{ gender: "female", share: "lead" }, { gender: "male", share: "backing" }] }]),
      null,
    );
  });

  it("modes de refrain", () => {
    assert.equal(duoChorusMode("call-and-response between them"), "call-and-response");
    assert.equal(duoChorusMode("both harmonise the chorus"), "both");
    assert.equal(duoChorusMode("female sings the chorus alone"), "female");
    assert.equal(normalizeVocalists([{ gender: "x" }])[0].gender, "unknown");
    assert.equal(vocalistTimbreLine({ range: "baritone", texture: "gritty", delivery: "shouted chant" }), "baritone, gritty, shouted chant");
  });
});

describe("duo : profil + génération", () => {
  const base = { name: "Frostbloom", slug: "frostbloom", genre: "Nordic electro-rock", language: "en", styleLock: LOCK };
  const duo = applyDuoToProfile(base, {
    duoVocals: mergeDuoVocals(HEARD),
    members: [{ name: "Liv Ash", gender: "female" }, { name: "Ragn Holt", gender: "male" }],
  });

  it("profil duo : deux profils vocaux, partenaire singer 2", () => {
    assert.equal(duo.duo, true);
    assert.equal(duo.gender, "female");
    assert.equal(duo.vocalProfiles.length, 2);
    assert.equal(duo.duoPartner.name, "Ragn Holt");
    assert.equal(duo.duoPartner.gender, "male");
    assert.match(duo.duoPartner.styleLock.timbre, /gritty/);
    assert.match(duo.styleLock.timbre, /mezzo/);
    assert.equal(isDuoArtist(duo), true);
  });

  it("génère toujours avec les deux voix, sans crédit « feat. »", () => {
    const withFeat = withDuoPartner({ ...duo, featArtist: null });
    const feat = normalizeFeatArtist(withFeat.featArtist);
    assert.equal(feat.name, "Ragn Holt");
    assert.equal(feat.duoMember, true);
    assert.equal(displayArtistCredit(duo, feat), "Frostbloom");
    // feat explicite choisi par l'utilisateur : respecté
    const other = withDuoPartner({ ...duo, featArtist: { name: "Guest", gender: "male" } });
    assert.equal(other.featArtist.name, "Guest");
  });

  it("style ACE : deux timbres + instruments du DNA + interaction", () => {
    const feat = normalizeFeatArtist(withDuoPartner(duo).featArtist);
    const style = buildAceStepDuoStyle(duo, feat, { styleLock: duo.styleLock });
    assert.match(style, /singer 1 Liv Ash \(female\): .*mezzo/i);
    assert.match(style, /singer 2 Ragn Holt \(male\): .*gritty/i);
    assert.match(style, /distorted guitars/);
    assert.ok(style.length <= 380, `trop long ${style.length}`);
  });

  it("paroles : tags [singer 1: female]/[singer 2: male], refrain à deux", () => {
    const feat = normalizeFeatArtist(withDuoPartner(duo).featArtist);
    const out = ensureAceStepDuoSingerTags(
      "[Verse]\nIce on the oar\n[Chorus]\nRaise the fire\nRaise the fire\n[Verse]\nIron and salt",
      duo,
      feat,
    );
    assert.match(out, /\[Verse\]\n\[singer 1: female\]/);
    assert.match(out, /\[Chorus\]\n\[singer 1: female\]\n\[singer 2: male\]/);
    assert.match(out, /\[Verse\]\n\[singer 2: male\]\nIron/);
    const block = duoLyricsInstruction(duo, feat);
    assert.match(block, /UN groupe/);
    assert.match(block, /ENSEMBLE/);
  });

  it("refrain question-réponse si l'interaction le dit", () => {
    const cr = { ...duo, duoInteraction: { summary: "call-and-response", chorus: "call-and-response" } };
    const feat = normalizeFeatArtist(withDuoPartner(cr).featArtist);
    const out = ensureAceStepDuoSingerTags("[Chorus]\nRaise the fire\nHold the line", cr, feat);
    assert.match(out, /\[singer 1: female\]\nRaise the fire\n\[singer 2: male\]\nHold the line/);
  });

  it("clone : copie les deux profils vocaux", () => {
    const patch = buildCloneSoundPatch(duo);
    assert.equal(patch.duo, true);
    assert.equal(patch.vocalProfiles.length, 2);
    assert.equal(patch.duoPartner.name, "Ragn Holt");
    assert.deepEqual(patch.duoInteraction, duo.duoInteraction);
  });
});
