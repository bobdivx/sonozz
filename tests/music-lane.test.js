import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  artefactGuardsFromLock,
  coalesceGenres,
  composeAceStepStyle,
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

const deathLock = {
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

const thrashLock = {
  matchedName: "Metallica",
  genres: ["Thrash Metal", "Heavy Metal"],
  genreSummary: "American thrash and heavy metal, palm-muted downpicked riffs, live kit",
  vocalStyle: "barked rhythmic vocals, raspy baritone",
  sonicKeywords: ["palm-muted guitars", "downpicking"],
  production: "high-gain thrash mix, live kit",
  doNot: ["death growl", "synth pads", "pop crooning"],
  seedTrack: { title: "Battery", artistName: "Metallica" },
};

const balladLock = {
  matchedName: "Metallica",
  query: "Nothing Else Matters (Remastered 2021) — Metallica",
  genres: ["hard rock ballad", "acoustic rock", "melancholic rock"],
  genreSummary: "A hard rock band specializing in powerful, emotive ballads with a strong acoustic foundation.",
  mood: "melancholic",
  energy: "low",
  bpm: 72,
  vocalStyle: "emotive raspy baritone",
  musicPrompt: "hard rock ballad, acoustic foundation, Nothing Else Matters",
  seedTrack: { title: "Nothing Else Matters (Remastered 2021)", artistName: "Metallica" },
};

const industrialLock = {
  matchedName: "Rammstein",
  genres: ["Industrial Metal"],
  genreSummary: "Industrial metal, tight riffs, staged shouted vocals",
  vocalStyle: "shouted industrial male vocals, slight processing",
  production: "industrial metal mix, drum machine + guitars",
  sonicKeywords: ["industrial", "drum machine"],
  doNot: ["death growl", "blast beats"],
};

describe("lane metal / iTunes Rock", () => {
  it("mappe Rock + Death Metal vers Studio Metal (pas Rock)", () => {
    assert.equal(mapGenreForStudio("Rock"), "Rock");
    assert.equal(mapGenreForStudio("Death Metal"), "Metal");
    assert.equal(mapGenreForStudio("Rock, Death Metal"), "Metal");
    assert.equal(mapGenreForStudio("Brutal Death Metal"), "Metal");
  });

  it("droppe l’ombrelle iTunes Rock quand un sous-genre metal est là", () => {
    assert.deepEqual(coalesceGenres(["Rock", "Death Metal"]), ["Death Metal"]);
    assert.deepEqual(coalesceGenres(["Rock / Indie rock", "Metal / Hard rock"]), [
      "Metal / Hard rock",
    ]);
    assert.equal(isExtremeMetalLane("brutal death metal"), true);
    assert.equal(isMetalLane("indie pop"), false);
  });

  it("BPM depuis le genre du DNA, pas un nom de groupe", () => {
    assert.equal(defaultBpmForGenre("Death Metal"), 170);
    assert.equal(defaultBpmForGenre("Thrash Metal"), 140);
    assert.equal(defaultBpmForGenre("Rock"), 110);
  });

  it("catalogue Death Metal → chip Death metal (pas Rock indie)", () => {
    assert.equal(matchMusicStyleFromGenre("Death Metal")?.value, "Death Metal / Brutal");
    assert.equal(matchMusicStyleFromGenre("Rock")?.value, "Rock / Indie rock");
  });
});

describe("arrangement / prompts depuis le DNA", () => {
  it("death : reprend vocalStyle / production / doNot du lock", () => {
    const arr = musicArrangeFromStyleLock(deathLock);
    assert.equal(arr.leadInstrument, "electric guitar");
    assert.equal(arr.drums, "live kit");
    assert.equal(arr.choir, "none");
    assert.equal(arr.density, "dense");

    const packed = musicArrangeToSongGen(arr, {
      styleLockInstruments: deathLock.instruments,
      styleLock: deathLock,
    });
    const blob = `${packed.instruments} ${packed.customFragments.join(" ")}`.toLowerCase();
    assert.match(blob, /guttural death growl/);
    assert.match(blob, /crushing dense death metal mix/);
    assert.match(blob, /never pop|never clean singing|never synth/);
    assert.doesNotMatch(blob, /never vocoder|never autotune/);
    assert.ok(!metalFlavorTags("pop").length);
    const tags = metalFlavorTags(deathLock).join(" ");
    assert.match(tags, /guttural death growl|blast beats|Brutal Death Metal/i);
  });

  it("prompt Suno recopie le DNA, sans bible Florida / Hetfield", () => {
    const prompt = buildSunoPrompt({
      lyrics: { title: "Vile Adulteress", text: "[Verse]\nFlesh" },
      artist: { name: "SLOWP-KE", genre: "Death Metal", gender: "male" },
      styleLock: deathLock,
      bpmGuess: 170,
    });
    assert.match(prompt, /Brutal Death Metal|guttural death growl|blast beats/i);
    assert.doesNotMatch(prompt, /Florida|George Fisher|Hetfield|Rammstein/i);
    assert.doesNotMatch(prompt, /atmospheric pads|soft drums|subtle electronic/);
  });

  it("industriel : pas de growls death ni de ban industrial", () => {
    const packed = musicArrangeToSongGen(musicArrangeFromStyleLock(industrialLock), {
      styleLock: industrialLock,
    });
    const blob = packed.customFragments.join(" ").toLowerCase();
    assert.match(blob, /industrial/);
    assert.doesNotMatch(blob, /guttural/);
    assert.match(blob, /never blast beats/);
    assert.equal(artefactGuardsFromLock(industrialLock).length, 0);
    const voice = metalVoiceHint("male", "Industrial Metal", industrialLock);
    assert.match(voice, /industrial/i);
    assert.doesNotMatch(voice, /guttural|George Fisher/i);
  });
});

describe("lane thrash vs ballade : le lock prime", () => {
  it("détecte thrash depuis les genres, pas le nom du groupe", () => {
    const blob = [thrashLock.genreSummary, thrashLock.genres.join(" ")].join(" ");
    assert.equal(isMetalLane(blob), true);
    assert.equal(isThrashLane(blob), true);
    assert.equal(isExtremeMetalLane(blob), false);
    assert.equal(mapGenreForStudio(blob), "Metal");
  });

  it("ne réécrit pas un DNA ballade en thrash / death", () => {
    const fixed = withKnownArtistLane(balladLock);
    assert.match(fixed.genreSummary, /ballad|acoustic/i);
    assert.doesNotMatch(fixed.genreSummary, /thrash|death metal|Hetfield/i);
    const voice = metalVoiceHint("male", styleBlob(fixed), fixed);
    assert.match(voice, /raspy baritone/i);
    assert.doesNotMatch(voice, /guttural|Hetfield/i);
  });

  it("DNA thrash : tags et voix du lock", () => {
    const tags = metalFlavorTags(thrashLock).join(" ");
    assert.match(tags, /palm-muted|downpicking|thrash/i);
    assert.doesNotMatch(tags, /guttural|blast beat|Hetfield|Mesa/i);
    const voice = metalVoiceHint("male", "Thrash Metal", thrashLock);
    assert.match(voice, /barked rhythmic/i);
  });

  it("prompt Suno thrash sans growls ni pads radio", () => {
    const prompt = buildSunoPrompt({
      lyrics: { title: "Echoes in the Ash", text: "[Verse]\nAsh" },
      artist: { name: "Slowpøke", genre: "Thrash Metal", gender: "male" },
      styleLock: thrashLock,
      bpmGuess: 140,
    });
    assert.match(prompt, /thrash|palm-muted|barked/i);
    assert.doesNotMatch(prompt, /atmospheric pads|soft drums|guttural|blast beats|brutal death|Florida|Hetfield/i);
  });
});

describe("DNA figé : pas d’override par nom d’artiste", () => {
  it("un seed death n’écrase pas un leftover ballade (le strip se fait au changement de titre)", () => {
    const mixed = {
      ...balladLock,
      matchedName: "Cannibal Corpse",
      seedTrack: {
        title: "Hammer Smashed Face",
        artistName: "Cannibal Corpse",
      },
    };
    const fixed = withKnownArtistLane(mixed);
    assert.match(fixed.genreSummary, /ballad|acoustic/i);
    assert.doesNotMatch(fixed.vocalStyle, /guttural/i);
  });

  it("coalesce seulement les genres catalogue du DNA death", () => {
    const fixed = withKnownArtistLane(deathLock);
    assert.deepEqual(fixed.genres, ["Death Metal"]);
    assert.equal(fixed.vocalStyle, deathLock.vocalStyle);
    assert.equal(isExtremeMetalLane("brutal death metal guttural"), true);
  });

  it("un ban « death growl » dans un blob thrash ne bascule pas en death metal", () => {
    const blob = "American thrash metal, barked vocals, avoid death growl";
    assert.equal(isExtremeMetalLane(blob), false);
    assert.doesNotMatch(composeAceStepStyle(blob), /guttural|Florida/i);
  });

  it("ACE-Step reprend le DNA du lock, sans préfixe Florida", () => {
    const style = composeAceStepStyle("high energy original", deathLock);
    assert.match(style, /Brutal Death Metal/i);
    assert.match(style, /guttural death growl/i);
    assert.doesNotMatch(style, /Florida|George Fisher|Rammstein/i);
    assert.doesNotMatch(style, /no vocoder|no autotune/i);
    assert.doesNotMatch(composeAceStepStyle("pop, emotional, radio-ready"), /guttural|industrial/i);
  });
});

function styleBlob(lock) {
  return [lock.genreSummary, lock.vocalStyle, ...(lock.genres || [])].join(" ");
}
