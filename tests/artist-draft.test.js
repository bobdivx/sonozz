import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildArtistDraftPatch, isUnchangedArtistDraft } from "../src/lib/artistDraft.js";

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
