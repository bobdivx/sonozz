import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildArtistDraftPatch,
  isUnchangedArtistDraft,
  lockHasSonicDna,
  artistPatchFromStyleLock,
} from "../src/lib/artistDraft.js";

describe("buildArtistDraftPatch", () => {
  it("enregistre le passage fiction → c’est moi sans perdre le DNA style", () => {
    const prev = {
      mode: "fiction",
      name: "Nova",
      styleLock: { timbre: "dark", bpm: 140, matchedName: "Old" },
    };
    const patch = buildArtistDraftPatch(
      {
        mode: "self",
        name: "Alex",
        age: "24",
        gender: "male",
        city: "Lyon",
        language: "fr",
        bioHint: "vibe nocturne",
        styleArtistPicks: [
          { source: "deezer", id: "42", name: "SebastiAn", genres: ["electro"] },
        ],
      },
      prev,
    );
    assert.equal(patch.mode, "self");
    assert.equal(patch.name, "Alex");
    assert.equal(patch.age, 24);
    assert.equal(patch.gender, "male");
    assert.equal(patch.city, "Lyon");
    assert.equal(patch.bioHint, "vibe nocturne");
    assert.equal(patch.styleLock.timbre, "dark");
    assert.equal(patch.styleLock.bpm, 140);
    assert.equal(patch.styleLock.source, "deezer");
    assert.equal(patch.styleLock.refs[0].matchedName, "SebastiAn");
  });

  it("ne pose pas un âge hors bornes", () => {
    const patch = buildArtistDraftPatch({ mode: "self", age: "9" }, {});
    assert.equal(patch.age, undefined);
    assert.equal(patch.mode, "self");
  });

  it("retire le titre de référence quand le pick est null", () => {
    const patch = buildArtistDraftPatch(
      { mode: "fiction", styleTrackPick: null },
      { styleLock: { seedTrack: { title: "X", source: "deezer", sourceId: "1" } } },
    );
    assert.equal(patch.styleLock?.seedTrack, undefined);
  });

  it("change de titre de référence sans garder le DNA de l’ancien", () => {
    const patch = buildArtistDraftPatch(
      {
        mode: "fiction",
        styleTrackPick: {
          source: "deezer",
          id: "99",
          name: "Hammer Smashed Face",
          artistName: "Cannibal Corpse",
        },
      },
      {
        styleLock: {
          query: "Nothing Else Matters — Metallica",
          matchedName: "Metallica",
          genreSummary: "American thrash and heavy metal",
          musicPrompt: "Hetfield barked vocals",
          vocalStyle: "raspy baritone",
          seedTrack: { title: "Nothing Else Matters", source: "deezer", sourceId: "1" },
        },
      },
    );
    assert.equal(patch.styleLock.seedTrack.artistName, "Cannibal Corpse");
    assert.equal(patch.styleLock.matchedName, "Cannibal Corpse");
    assert.equal(patch.styleLock.query, undefined);
    assert.equal(patch.styleLock.genreSummary, undefined);
    assert.equal(patch.styleLock.musicPrompt, undefined);
    assert.equal(patch.styleLock.vocalStyle, undefined);
    assert.equal(patch.styleLock.timbre, undefined);
    assert.equal(patch.styleLock.rhythmFeel, undefined);
    assert.equal(patch.styleLock.bpm, undefined);
    assert.equal(patch.styleLock.instruments, undefined);
    assert.equal(patch.styleLock.energy, undefined);
    assert.equal(patch.styleLock.production, undefined);
  });

  it("remplace tout le DNA Metallica (ballade) au changement de titre", () => {
    const patch = buildArtistDraftPatch(
      {
        mode: "fiction",
        styleTrackPick: {
          source: "deezer",
          id: "99",
          name: "Hammer Smashed Face",
          artistName: "Cannibal Corpse",
        },
      },
      {
        styleLock: {
          timbre: "deep, resonant baritone",
          rhythmFeel: "slow, deliberate rock ballad",
          bpm: 70,
          energy: "low",
          instruments: ["acoustic guitar", "electric guitar", "bass guitar", "drums"],
          production: "arena rock ballad",
          seedTrack: { title: "Nothing Else Matters", source: "deezer", sourceId: "1" },
        },
      },
    );
    assert.equal(lockHasSonicDna(patch.styleLock), false);
    assert.equal(patch.styleLock.seedTrack.title, "Hammer Smashed Face");
  });

  it("fusionne un lock résolu sans perdre les refs artistes", () => {
    const patch = artistPatchFromStyleLock(
      {
        matchedName: "Cannibal Corpse",
        timbre: "guttural",
        bpm: 180,
        genres: ["Death Metal"],
        genreSummary: "brutal death metal",
        seedTrack: { title: "Hammer Smashed Face", artistName: "Cannibal Corpse" },
      },
      {
        styleLock: {
          refs: [{ source: "deezer", sourceId: "7", matchedName: "Cannibal Corpse" }],
        },
      },
    );
    assert.equal(patch.styleLock.timbre, "guttural");
    assert.equal(patch.styleLock.refs[0].matchedName, "Cannibal Corpse");
    assert.equal(patch.genre, "brutal death metal");
  });

  it("détecte un brouillon déjà identique au profil sauvé", () => {
    const prev = {
      mode: "self",
      name: "Alex",
      age: 24,
      gender: "male",
      city: "Lyon",
      language: "fr",
      bioHint: "vibe",
      styleArtist: "SebastiAn",
      genres: ["electro"],
      styleLock: {
        refs: [{ source: "deezer", sourceId: "42" }],
        seedTrack: { source: "deezer", sourceId: "9" },
      },
    };
    const patch = buildArtistDraftPatch(
      {
        mode: "self",
        name: "Alex",
        age: "24",
        gender: "male",
        city: "Lyon",
        language: "fr",
        bioHint: "vibe",
        resolvedGenres: ["electro"],
        styleArtistPicks: [{ source: "deezer", id: "42", name: "SebastiAn" }],
        styleTrackPick: { source: "deezer", id: "9", name: "T" },
      },
      prev,
    );
    assert.equal(isUnchangedArtistDraft(patch, prev), true);
    assert.equal(isUnchangedArtistDraft({ ...patch, mode: "fiction" }, prev), false);
  });
});
