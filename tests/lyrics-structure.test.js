import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACE_COMMERCIAL_LYRICS_STRUCTURE,
  LYRICS_FORM_PRESETS,
  buildLyricsCraftBrief,
  detectLyricsForm,
  getLyricsFormPreset,
} from "../src/lib/musicLane.js";
import {
  canonicalStructureTag,
  deriveStructureFromText,
  normalizeAndValidateLyrics,
  normalizeLyricsTextTags,
  parseLyricsSections,
  validateLyricsAgainstForm,
} from "../src/lib/lyricsStructure.js";
import { duoLyricsInstruction, normalizeFeatArtist } from "../src/lib/featArtist.js";

describe("detectLyricsForm", () => {
  it("défaut → radio_pop", () => {
    assert.equal(detectLyricsForm(null, { genre: "pop" }).id, "radio_pop");
    assert.equal(detectLyricsForm({}, {}).id, "radio_pop");
  });

  it("trap / hip-hop → rap_trap", () => {
    assert.equal(
      detectLyricsForm({ genreSummary: "afro-trap, hip-hop" }, { genre: "Trap" }).id,
      "rap_trap",
    );
    assert.equal(detectLyricsForm(null, { genre: "drill" }).id, "rap_trap");
  });

  it("edm / house → edm", () => {
    assert.equal(detectLyricsForm({ genreSummary: "progressive house" }, null).id, "edm");
    assert.equal(detectLyricsForm(null, { genre: "EDM dance" }).id, "edm");
  });

  it("ballade / acoustic → ballad (avant metal)", () => {
    assert.equal(
      detectLyricsForm(
        {
          genreSummary: "A hard rock band specializing in powerful, emotive ballads with a strong acoustic foundation.",
          genres: ["hard rock ballad", "acoustic rock"],
        },
        null,
      ).id,
      "ballad",
    );
  });

  it("death metal → metal", () => {
    assert.equal(
      detectLyricsForm(
        { genreSummary: "Brutal Death Metal", genres: ["Death Metal"], sonicKeywords: ["blast beats"] },
        { genre: "Metal" },
      ).id,
      "metal",
    );
  });

  it("indie / alt → indie_alt", () => {
    assert.equal(detectLyricsForm({ genreSummary: "indie alternative rock" }, null).id, "indie_alt");
  });

  it("ACE_COMMERCIAL_LYRICS_STRUCTURE reste l’arc radio_pop", () => {
    assert.equal(ACE_COMMERCIAL_LYRICS_STRUCTURE, LYRICS_FORM_PRESETS.radio_pop.tagsArc);
    assert.equal(getLyricsFormPreset("radio_pop").id, "radio_pop");
  });

  it("buildLyricsCraftBrief mentionne la forme", () => {
    const brief = buildLyricsCraftBrief(LYRICS_FORM_PRESETS.metal);
    assert.match(brief, /metal/i);
    assert.match(brief, /Breakdown/);
  });
});

describe("lyricsStructure parse / validate", () => {
  const popText = `[Intro]
ooh
[Verse]
first story line here
another line
[Pre-Chorus]
rising up
[Chorus]
the hook line forever
[Verse]
second story different words
more plot
[Pre-Chorus]
rising again
[Chorus]
the hook line forever
[Bridge]
new angle now
[Chorus]
the hook line forever
[Outro]
fade`;

  it("canonicalise les tags avec suffixe vocal", () => {
    assert.equal(canonicalStructureTag("Verse - female vocal"), "Verse");
    assert.equal(canonicalStructureTag("Chorus - duet male and female vocals"), "Chorus");
    assert.equal(canonicalStructureTag("Refrain"), "Chorus");
    assert.equal(canonicalStructureTag("Pré-refrain"), "Pre-Chorus");
  });

  it("normalise les tags FR dans le texte", () => {
    const out = normalizeLyricsTextTags("[Couplet]\nhi\n[Refrain]\nhook\n[Pont]\nx");
    assert.match(out, /\[Verse\]/);
    assert.match(out, /\[Chorus\]/);
    assert.match(out, /\[Bridge\]/);
  });

  it("dérive structure depuis text", () => {
    const structure = deriveStructureFromText(popText);
    assert.deepEqual(structure.slice(0, 4), ["Intro", "Verse", "Pre-Chorus", "Chorus"]);
    assert.ok(structure.includes("Bridge"));
  });

  it("valide un texte radio_pop complet", () => {
    const v = validateLyricsAgainstForm(popText, LYRICS_FORM_PRESETS.radio_pop);
    assert.equal(v.ok, true);
    assert.equal(v.errors.length, 0);
  });

  it("détecte tags manquants", () => {
    const v = validateLyricsAgainstForm(
      `[Intro]\nx\n[Verse]\na\n[Chorus]\nhook`,
      LYRICS_FORM_PRESETS.radio_pop,
    );
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /Bridge|Pre-Chorus|Outro/i.test(e)));
  });

  it("détecte verses dupliqués", () => {
    const dup = `[Intro]
x
[Verse]
same words here
[Pre-Chorus]
up
[Chorus]
hook
[Verse]
same words here
[Pre-Chorus]
up
[Chorus]
hook
[Bridge]
diff
[Chorus]
hook
[Outro]
bye`;
    const v = validateLyricsAgainstForm(dup, LYRICS_FORM_PRESETS.radio_pop);
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => /identiques/i.test(e)));
  });

  it("valide un arc rap_trap avec Hook", () => {
    const rap = `[Intro]
yo
[Verse]
bars one distinct
[Hook]
short hook
[Verse]
bars two different
[Hook]
short hook
[Bridge]
switch
[Hook]
short hook
[Outro]
out`;
    const v = validateLyricsAgainstForm(rap, LYRICS_FORM_PRESETS.rap_trap);
    assert.equal(v.ok, true);
  });

  it("normalizeAndValidateLyrics synchronise structure + lyricsForm", () => {
    const out = normalizeAndValidateLyrics(
      { title: "T", theme: "x", language: "fr", structure: ["Wrong"], text: popText },
      "radio_pop",
    );
    assert.equal(out.lyricsForm, "radio_pop");
    assert.ok(out.structure.includes("Bridge"));
    assert.equal(out._validation.ok, true);
    assert.ok(!("Wrong" === out.structure[0] && out.structure.length === 1));
  });

  it("parse sections avec corps", () => {
    const sections = parseLyricsSections("[Verse]\nhello\nworld\n[Chorus]\nhook");
    assert.equal(sections.length, 2);
    assert.equal(sections[0].canonical, "Verse");
    assert.match(sections[0].body, /hello/);
  });
});

describe("duoLyricsInstruction + forme", () => {
  it("utilise l’arc du preset (rap Hook, pas Pre-Chorus forcé)", () => {
    const lead = { name: "A", gender: "male", genre: "trap" };
    const feat = normalizeFeatArtist({ name: "B", gender: "female", genre: "rnb" });
    const block = duoLyricsInstruction(lead, feat, LYRICS_FORM_PRESETS.rap_trap);
    assert.match(block, /rap_trap/);
    assert.match(block, /\[Hook\]/);
    // Format ACE actuel : singer 1/2 sous le hook (plus « Hook - duet … vocals »).
    assert.match(block, /\[singer 1: male\]/);
    assert.match(block, /\[singer 2: female\]/);
    assert.doesNotMatch(block, /Pre-Chorus/);
  });
});
