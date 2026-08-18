import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeArtistCandidatesByName,
  rankArtistTopTracks,
  pickStyleLockPreviewUrl,
} from "../src/server/styleReference.js";

describe("rankArtistTopTracks", () => {
  it("place le hit de l’artiste (avec preview) devant une collab", () => {
    const ranked = rankArtistTopTracks(
      [
        { id: "1", name: "Collab", artistName: "Other Feat", previewUrl: "http://a" },
        { id: "2", name: "Drop It Like It’s Hot", artistName: "Snoop Dogg", previewUrl: "http://b" },
        { id: "3", name: "Gin and Juice", artistName: "Snoop Dogg", previewUrl: null },
      ],
      "Snoop Dogg",
    );
    assert.equal(ranked[0].name, "Drop It Like It’s Hot");
    assert.equal(ranked[1].name, "Gin and Juice");
  });

  it("déduplique le même titre toutes sources confondues", () => {
    const ranked = rankArtistTopTracks(
      [
        { id: "dz", name: "Blinding Lights", artistName: "The Weeknd", previewUrl: "http://a" },
        { id: "it", name: "Blinding Lights", artistName: "The Weeknd", previewUrl: null },
        { id: "sp", name: "Save Your Tears", artistName: "The Weeknd", previewUrl: "http://c" },
      ],
      "The Weeknd",
    );
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].id, "dz");
    assert.equal(ranked[1].name, "Save Your Tears");
  });

  it("reprend le genre iTunes sur le titre Deezer dédupliqué", () => {
    const ranked = rankArtistTopTracks(
      [
        {
          id: "dz",
          name: "Young, Wild & Free",
          artistName: "Snoop Dogg",
          previewUrl: "http://a",
          genres: [],
        },
        {
          id: "it",
          name: "Young, Wild & Free",
          artistName: "Snoop Dogg",
          previewUrl: null,
          genres: ["Hip-Hop/Rap"],
        },
      ],
      "Snoop Dogg",
    );
    assert.equal(ranked.length, 1);
    assert.deepEqual(ranked[0].genres, ["Hip-Hop/Rap"]);
  });

  it("ignore un nom d’artiste vide sans tout jeter", () => {
    const ranked = rankArtistTopTracks(
      [{ id: "1", name: "Hit", artistName: "Anyone", previewUrl: "http://a" }],
      "",
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].name, "Hit");
  });
});

describe("mergeArtistCandidatesByName", () => {
  it("garde Deezer (fans) mais récupère le genre iTunes", () => {
    const merged = mergeArtistCandidatesByName([
      {
        source: "itunes",
        id: "10",
        name: "Snoop Dogg",
        genres: ["Hip-hop Rap"],
        matchScore: 1030,
        followers: null,
      },
      {
        source: "musicbrainz",
        id: "mb",
        name: "Snoop Dogg",
        genres: [],
        matchScore: 1000,
        country: "US",
        gender: "male",
      },
      {
        source: "deezer",
        id: "20",
        name: "Snoop Dogg",
        genres: [],
        matchScore: 1099,
        followers: 7_900_000,
      },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, "deezer");
    assert.equal(merged[0].followers, 7_900_000);
    assert.deepEqual(merged[0].genres, ["Hip-hop Rap"]);
    assert.equal(merged[0].country, "US");
    assert.equal(merged[0].gender, "male");
  });

  it("récupère pays + sexe MusicBrainz même si iTunes n’en a pas", () => {
    const merged = mergeArtistCandidatesByName([
      {
        source: "itunes",
        id: "1",
        name: "Tina Turner",
        genres: ["R&B Soul"],
        matchScore: 1040,
      },
      {
        source: "musicbrainz",
        id: "mb",
        name: "Tina Turner",
        matchScore: 1000,
        country: "US",
        gender: "female",
      },
      {
        source: "deezer",
        id: "20",
        name: "Tina Turner",
        matchScore: 1100,
        followers: 1_700_000,
      },
    ]);
    assert.equal(merged[0].source, "deezer");
    assert.equal(merged[0].country, "US");
    assert.equal(merged[0].gender, "female");
  });
});

describe("pickStyleLockPreviewUrl", () => {
  it("prend le preview du titre seed", () => {
    assert.equal(
      pickStyleLockPreviewUrl({
        previewUrl: "https://cdn/artist.mp3",
        seedTrack: { previewUrl: "https://audio.apple.com/condemnation.m4a" },
      }),
      "https://audio.apple.com/condemnation.m4a",
    );
  });

  it("ignore les URLs non http", () => {
    assert.equal(pickStyleLockPreviewUrl({ previewUrl: "/local.mp3" }), "");
    assert.equal(pickStyleLockPreviewUrl(null), "");
  });
});
