import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalogGenresToStyleValues, matchMusicStyleFromGenre, inferLanguageFromStyleRef, styleGenreChips } from "../src/lib/studio.js";

describe("matchMusicStyleFromGenre", () => {
  it("mappe alternative metal vers Metal, pas Indie", () => {
    assert.equal(matchMusicStyleFromGenre("Alternative Metal")?.value, "Metal / Hard rock");
    assert.equal(matchMusicStyleFromGenre("Death Metal")?.value, "Death Metal / Brutal");
    assert.equal(matchMusicStyleFromGenre("Alliteration"), null);
  });

  it("mappe Hip-hop Rap iTunes vers Rap / Drill", () => {
    const hit = matchMusicStyleFromGenre("Hip-hop Rap");
    assert.equal(hit?.value, "Rap / Drill francophone");
  });

  it("mappe Rap/Hip Hop Deezer vers Rap / Drill", () => {
    const hit = matchMusicStyleFromGenre("Rap/Hip Hop");
    assert.equal(hit?.value, "Rap / Drill francophone");
  });
});

describe("styleGenreChips", () => {
  it("déduplique Death metal, droppe Rock et Alliteration", () => {
    const chips = styleGenreChips([
      "Rock",
      "Death Metal",
      "Brutal Death Metal",
      "Alliteration",
      "Metal",
    ]);
    assert.deepEqual(
      chips.map((c) => c.label),
      ["Death metal", "Metal"],
    );
  });
});

describe("catalogGenresToStyleValues", () => {
  it("déduplique plusieurs tags hip-hop", () => {
    assert.deepEqual(catalogGenresToStyleValues(["Hip-hop Rap", "West Coast Rap", "Rap"]), [
      "Rap / Drill francophone",
    ]);
  });

  it("droppe Rock iTunes si Death Metal est présent", () => {
    assert.deepEqual(catalogGenresToStyleValues(["Rock", "Death Metal"]), [
      "Death Metal / Brutal",
    ]);
  });
});

describe("inferLanguageFromStyleRef", () => {
  it("prend l’anglais pour un artiste US", () => {
    assert.equal(inferLanguageFromStyleRef({ country: "US" }), "en");
  });

  it("prend le français pour French Hip Hop même si le pays est US", () => {
    assert.equal(
      inferLanguageFromStyleRef({ country: "US", genres: ["French Hip Hop"] }),
      "fr",
    );
  });

  it("prend l’espagnol pour un genre latin / reggaeton", () => {
    assert.equal(inferLanguageFromStyleRef({ genres: ["Reggaeton"] }), "es");
  });

  it("prend l’anglais d’après un titre phare si le pays manque", () => {
    assert.equal(inferLanguageFromStyleRef({ titles: ["The Best"] }), "en");
  });

  it("prend le français d’après un titre francophone si le pays manque", () => {
    assert.equal(inferLanguageFromStyleRef({ titles: ["Alors on danse"] }), "fr");
  });

  it("normalise United States MusicBrainz vers US → en", () => {
    assert.equal(inferLanguageFromStyleRef({ country: "United States" }), "en");
  });
});
