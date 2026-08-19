import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  coalesceGenres,
  defaultBpmForGenre,
  isExtremeMetalLane,
  isMetalLane,
  isThrashLane,
  mapGenreForStudio,
  metalFlavorTags,
  metalVoiceHint,
  withKnownArtistLane,
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

const metallicaLock = {
  matchedName: "Metallica",
  query: "Nothing Else Matters (Remastered 2021) — Metallica",
  genres: ["hard rock ballad", "acoustic rock", "melancholic rock"],
  genreSummary: "A hard rock band specializing in powerful, emotive ballads with a strong acoustic foundation.",
  mood: "melancholic",
  energy: "low",
  bpm: 72,
  musicPrompt: "hard rock ballad, acoustic foundation, Nothing Else Matters",
  seedTrack: { title: "Nothing Else Matters (Remastered 2021)", artistName: "Metallica" },
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

describe("lane Metallica / thrash (pas ballade pop)", () => {
  it("détecte Metallica même si le lock dit acoustic ballad", () => {
    const blob = [
      metallicaLock.matchedName,
      metallicaLock.genreSummary,
      metallicaLock.musicPrompt,
    ].join(" ");
    assert.equal(isMetalLane(blob), true);
    assert.equal(isThrashLane(blob), true);
    assert.equal(isExtremeMetalLane(blob), false);
    assert.equal(mapGenreForStudio(blob), "Metal");
    assert.equal(mapGenreForStudio("Metallica acoustic rock ballad"), "Metal");
  });

  it("ne transforme pas Metallica en death metal ni en Billboard", () => {
    const fixed = withKnownArtistLane(metallicaLock);
    assert.match(fixed.genreSummary, /thrash|heavy metal/i);
    assert.ok(fixed.genres.some((g) => /thrash|heavy metal/i.test(g)));
    const tags = metalFlavorTags(`${fixed.matchedName} ${fixed.genreSummary}`).join(" ");
    assert.match(tags, /downpicking|palm-muted|Hetfield/i);
    assert.doesNotMatch(tags, /guttural|blast beat/i);
    const voice = metalVoiceHint("male", "Metallica thrash");
    assert.match(voice, /Hetfield|bark/i);
    assert.match(voice, /thrash/i);
  });

  it("prompt Suno Metallica sans pads radio ni growls", () => {
    const prompt = buildSunoPrompt({
      lyrics: { title: "Echoes in the Ash", text: "[Verse]\nAsh" },
      artist: { name: "Slowpøke", genre: metallicaLock.genreSummary, gender: "male" },
      styleLock: metallicaLock,
      bpmGuess: 72,
    });
    assert.match(prompt, /thrash|heavy metal|downpick|palm-mut/i);
    assert.doesNotMatch(prompt, /atmospheric pads|soft drums|guttural|blast beats|brutal death/i);
  });
});

describe("lane Cannibal Corpse / death metal (pas thrash Metallica)", () => {
  it("un seed Cannibal Corpse n’hérite pas du résumé Mesa / Hetfield", () => {
    const mixed = {
      ...metallicaLock,
      matchedName: "Cannibal Corpse",
      seedTrack: {
        title: "Hammer Smashed Face",
        artistName: "Cannibal Corpse",
      },
    };
    const fixed = withKnownArtistLane(mixed);
    assert.match(fixed.genreSummary, /brutal death metal/i);
    assert.doesNotMatch(fixed.genreSummary, /Mesa|Hetfield|wah/i);
    assert.ok(fixed.genres.some((g) => /death metal/i.test(g)));
    assert.match(fixed.vocalStyle, /guttural|growl/i);
    const tags = metalFlavorTags(`${fixed.matchedName} ${fixed.genreSummary}`).join(" ");
    assert.match(tags, /guttural|blast/i);
    assert.doesNotMatch(tags, /Hetfield|Mesa/i);
  });

  it("Cannibal Corpse sans leftover Metallica reste en death metal", () => {
    const fixed = withKnownArtistLane(cannibalLock);
    assert.match(fixed.genreSummary, /brutal death metal/i);
    assert.equal(isExtremeMetalLane("Cannibal Corpse"), true);
  });
});
