import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { catalogGenresToStyleValues, matchMusicStyleFromGenre, inferLanguageFromStyleRef } from "../src/lib/studio.js";

describe("matchMusicStyleFromGenre", () => {
  it("mappe Hip-hop Rap iTunes vers Rap / Drill", () => {
    const hit = matchMusicStyleFromGenre("Hip-hop Rap");
    assert.equal(hit?.value, "Rap / Drill francophone");
  });

  it("mappe Rap/Hip Hop Deezer vers Rap / Drill", () => {
    const hit = matchMusicStyleFromGenre("Rap/Hip Hop");
    assert.equal(hit?.value, "Rap / Drill francophone");
  });
});

describe("catalogGenresToStyleValues", () => {
  it("déduplique plusieurs tags hip-hop", () => {
    assert.deepEqual(catalogGenresToStyleValues(["Hip-hop Rap", "West Coast Rap", "Rap"]), [
      "Rap / Drill francophone",
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
