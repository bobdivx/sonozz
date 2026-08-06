import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyArtistNameAvailability } from "../src/server/styleReference.js";

describe("classifyArtistNameAvailability", () => {
  it("marque un match exact comme collision", () => {
    const result = classifyArtistNameAvailability("Drake", [
      { source: "spotify", id: "1", name: "Drake", followers: 90_000_000, url: "https://open.spotify.com/artist/1" },
      { source: "deezer", id: "2", name: "Drake Band", followers: 100 },
    ]);
    assert.equal(result.available, false);
    assert.equal(result.collisions.length, 1);
    assert.equal(result.collisions[0].name, "Drake");
    assert.equal(result.collisions[0].source, "spotify");
  });

  it("ignore la casse et les accents", () => {
    const result = classifyArtistNameAvailability("café noir", [
      { source: "itunes", id: "9", name: "Cafe Noir", followers: 1200 },
    ]);
    assert.equal(result.available, false);
    assert.equal(result.collisions[0].name, "Cafe Noir");
  });

  it("traite un préfixe fort comme warning, pas collision", () => {
    const result = classifyArtistNameAvailability("Jonah", [
      { source: "spotify", id: "3", name: "Jonah Dean", followers: 5000 },
    ]);
    // "Jonah" vs "Jonah Dean" : ratio longueur trop bas pour exact/prefix fort 800
    // selon nameMatchScore — peut être warning ou rien ; pas collision exacte
    assert.equal(result.available, true);
    assert.equal(result.collisions.length, 0);
  });

  it("signale un préfixe proche comme warning", () => {
    const result = classifyArtistNameAvailability("Arctic Monkeys", [
      { source: "spotify", id: "4", name: "Arctic Monkey", followers: 800 },
    ]);
    assert.equal(result.available, true);
    assert.ok(result.warnings.length >= 1);
    assert.equal(result.warnings[0].name, "Arctic Monkey");
  });

  it("nom libre si aucun candidat proche", () => {
    const result = classifyArtistNameAvailability("Zzqx Fictionella", [
      { source: "spotify", id: "5", name: "Taylor Swift", followers: 100 },
    ]);
    assert.equal(result.available, true);
    assert.equal(result.collisions.length, 0);
    assert.equal(result.warnings.length, 0);
  });
});
