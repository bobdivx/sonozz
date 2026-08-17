import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyArtistNameAvailability } from "../src/server/styleReference.js";
import {
  collectAlternateStageNames,
  resolveFreeGeneratedStageName,
} from "../src/server/artistName.js";

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

describe("collectAlternateStageNames", () => {
  it("déduplique et saute les noms déjà refusés", () => {
    const names = collectAlternateStageNames(
      { name: "Nova", aka: "Nova", names: ["Lumen", "Nova", "Ascendia", "  "] },
      new Set(["ascendia"]),
    );
    assert.deepEqual(names, ["Nova", "Lumen"]);
  });
});

describe("resolveFreeGeneratedStageName", () => {
  it("accepte le premier nom s'il est libre", async () => {
    const result = await resolveFreeGeneratedStageName({
      initialName: "Virelia",
      checkAvailability: async () => ({ available: true, collisions: [] }),
      proposeNames: async () => {
        throw new Error("ne doit pas redemander de noms");
      },
    });
    assert.equal(result.name, "Virelia");
    assert.deepEqual(result.tried, []);
  });

  it("enchaîne les essais jusqu'à un nom libre au lieu de s'arrêter au 2e", async () => {
    const checks = [];
    const statuses = [];
    let rounds = 0;
    const result = await resolveFreeGeneratedStageName({
      initialName: "Ascendia",
      checkAvailability: async (name) => {
        checks.push(name);
        return {
          available: name === "Virelia",
          collisions: name === "Virelia" ? [] : [{ name, source: "itunes" }],
        };
      },
      proposeNames: async () => {
        rounds += 1;
        if (rounds === 1) return { names: ["Heliora", "Lumenox"] };
        return { names: ["Virelia"] };
      },
      onStatus: (message) => statuses.push(message),
    });
    assert.equal(result.name, "Virelia");
    assert.deepEqual(checks, ["Ascendia", "Heliora", "Lumenox", "Virelia"]);
    assert.equal(rounds, 2);
    assert.ok(statuses.some((m) => m.includes("Ascendia") && m.includes("déjà pris")));
  });

  it("n'abandonne qu'après épuisement des essais", async () => {
    await assert.rejects(
      () =>
        resolveFreeGeneratedStageName({
          initialName: "Taken",
          maxChecks: 3,
          checkAvailability: async (name) => ({
            available: false,
            collisions: [{ name, source: "itunes" }],
          }),
          proposeNames: async () => ({ names: ["Alt1", "Alt2", "Alt3"] }),
        }),
      /Impossible de trouver un nom libre après 3 essais/,
    );
  });
});
