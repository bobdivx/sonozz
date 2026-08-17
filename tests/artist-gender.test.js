import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseGenderCode,
  resolveArtistGender,
  withResolvedArtistGender,
  inferGenderFromStyleRef,
} from "../src/lib/artistGender.js";

describe("resolveArtistGender", () => {
  it("lit gender explicite", () => {
    assert.equal(resolveArtistGender({ gender: "female" })?.code, "female");
  });

  it("ignore une longue description voice (timbre)", () => {
    const artist = {
      voice:
        "Voix grave et mélodieuse avec une capacité à varier les intonations et les flows",
    };
    assert.equal(resolveArtistGender(artist), null);
  });

  it("infère male depuis portraitPrompt si gender manquant", () => {
    const artist = {
      voice: "Voix grave et mélodieuse avec une capacité à varier les intonations",
      visualIdentity: {
        portraitPrompt:
          "Realistic medium shot portrait of a 25-year-old male artist named Kaelen",
      },
    };
    assert.equal(resolveArtistGender(artist)?.code, "male");
    assert.equal(withResolvedArtistGender(artist).gender, "male");
  });

  it("infère female depuis pronoms she/her dans le portrait", () => {
    const artist = {
      visualIdentity: {
        portraitPrompt:
          "A realistic photo of Nyx, a 22-year-old artist. She has intense, dark eyes.",
      },
    };
    assert.equal(resolveArtistGender(artist)?.code, "female");
  });

  it("parse genderLock anglais", () => {
    assert.equal(
      parseGenderCode("25-year-old adult man, male singer, clearly masculine face"),
      "male",
    );
  });

  it("parse le sexe MusicBrainz Female / Male", () => {
    assert.equal(parseGenderCode("Female"), "female");
    assert.equal(parseGenderCode("Male"), "male");
  });
});

describe("inferGenderFromStyleRef", () => {
  it("lit le sexe d’un artiste catalogue", () => {
    assert.equal(inferGenderFromStyleRef({ gender: "female" }), "female");
    assert.equal(inferGenderFromStyleRef({ gender: "Female" }), "female");
    assert.equal(inferGenderFromStyleRef({}), null);
  });
});
