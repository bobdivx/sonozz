import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coalesceGenres,
  defaultBpmForGenre,
  isExtremeMetalLane,
  isMetalLane,
  mapGenreForStudio,
  metalFlavorTags,
} from "../src/lib/musicLane.js";
import { musicArrangeFromStyleLock, musicArrangeToSongGen } from "../src/lib/musicArrange.js";
import { buildSunoPrompt } from "../src/lib/sunoPrompt.js";
import { matchMusicStyleFromGenre } from "../src/lib/studio.js";

const cannibalLock = {
  matchedName: "Cannibal Corpse",
  genres: ["Rock", "Death Metal"],
  genreSummary: "Brutal Death Metal",
  mood: "dark brutal",
  energy: "high",
  production: "crushing dense death metal mix",
  vocalStyle: "guttural death growl",
  sonicKeywords: ["blast beats", "down-tuned guitars"],
  instruments: ["distorted guitar", "bass", "drums"],
  seedTrack: { title: "Condemnation Contagion", artistName: "Cannibal Corpse" },
  musicPrompt: "Brutal Death Metal, exactly in the style of Cannibal Corpse",
  doNot: ["pop", "clean singing", "synth pads"],
};

describe("lane metal / iTunes Rock", () => {
  it("mappe Rock + Death Metal vers Studio Metal (pas Rock)", () => {
    assert.equal(mapGenreForStudio("Rock"), "Rock");
    assert.equal(mapGenreForStudio("Death Metal"), "Metal");
    assert.equal(mapGenreForStudio("Rock, Death Metal"), "Metal");
    assert.equal(mapGenreForStudio("Brutal Death Metal · Cannibal Corpse"), "Metal");
  });

  it("droppe l’ombrelle iTunes Rock quand un sous-genre metal est là", () => {
    assert.deepEqual(coalesceGenres(["Rock", "Death Metal"]), ["Death Metal"]);
    assert.deepEqual(coalesceGenres(["Rock / Indie rock", "Metal / Hard rock"]), [
      "Metal / Hard rock",
    ]);
    assert.equal(isExtremeMetalLane("Cannibal Corpse brutal death metal"), true);
    assert.equal(isMetalLane("indie pop"), false);
  });

  it("BPM death metal ~170, pas 110 pop", () => {
    assert.equal(defaultBpmForGenre("Death Metal"), 170);
    assert.equal(defaultBpmForGenre("Rock"), 110);
  });

  it("catalogue Death Metal → chip Death metal (pas Rock indie)", () => {
    assert.equal(matchMusicStyleFromGenre("Death Metal")?.value, "Death Metal / Brutal");
    assert.equal(matchMusicStyleFromGenre("Rock")?.value, "Rock / Indie rock");
  });
});

describe("arrangement / prompts death metal", () => {
  it("n’injecte ni piano ni pads ni radio-ready", () => {
    const arr = musicArrangeFromStyleLock(cannibalLock);
    assert.equal(arr.leadInstrument, "electric guitar");
    assert.equal(arr.drums, "live kit");
    assert.equal(arr.choir, "none");
    assert.equal(arr.density, "dense");

    const packed = musicArrangeToSongGen(arr, {
      styleLockInstruments: cannibalLock.instruments,
      styleLock: cannibalLock,
    });
    const blob = `${packed.instruments} ${packed.customFragments.join(" ")}`.toLowerCase();
    assert.match(blob, /guitar|blast|death metal|growl/);
    assert.doesNotMatch(blob, /\bpiano\b|billboard|radio-ready|soft drums/);
    assert.match(blob, /never synth pads|never pop/);
    assert.ok(!metalFlavorTags("pop").length);
    assert.ok(metalFlavorTags("brutal death metal").includes("guttural growls"));
  });

  it("prompt Suno sans pads atmosphériques", () => {
    const prompt = buildSunoPrompt({
      lyrics: { title: "Vile Adulteress", text: "[Verse]\nFlesh" },
      artist: { name: "SLOWP-KE", genre: "Death Metal", gender: "male" },
      styleLock: cannibalLock,
      bpmGuess: 170,
    });
    assert.match(prompt, /death metal|growl|blast/i);
    assert.doesNotMatch(prompt, /atmospheric pads|soft drums|subtle electronic/);
  });
});
