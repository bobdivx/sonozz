import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextPlayIndex, prevPlayIndex, slimPlayTrack } from "../src/lib/playSession.js";

describe("slimPlayTrack", () => {
  it("exige un id et une source audio", () => {
    assert.equal(slimPlayTrack({ id: "a" }), null);
    assert.equal(slimPlayTrack({ audioUrl: "https://x/a.mp3" }), null);
    assert.equal(slimPlayTrack({ id: "a", audioUrl: "https://x/a.mp3" }).id, "a");
  });
});

describe("nextPlayIndex / prevPlayIndex", () => {
  it("passe au suivant puis s’arrête", () => {
    assert.equal(nextPlayIndex({ index: 0, queueLen: 3, repeat: "off" }), 1);
    assert.equal(nextPlayIndex({ index: 2, queueLen: 3, repeat: "off" }), -1);
  });

  it("boucle en repeat all et reste en repeat one", () => {
    assert.equal(nextPlayIndex({ index: 2, queueLen: 3, repeat: "all" }), 0);
    assert.equal(nextPlayIndex({ index: 1, queueLen: 3, repeat: "one" }), 1);
  });

  it("revient au début du titre si on a déjà avancé", () => {
    assert.equal(prevPlayIndex({ index: 2, queueLen: 3, repeat: "off", currentTime: 12 }), 2);
    assert.equal(prevPlayIndex({ index: 2, queueLen: 3, repeat: "off", currentTime: 1 }), 1);
  });
});
