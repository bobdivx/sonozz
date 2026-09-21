import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  notesToStyleAddon,
  composeStyleAddon,
  saveLikedAceTaste,
  updateAceTasteNotes,
  applyAceTasteToBody,
  normalizeAceTaste,
  clearAceTasteLiked,
  toggleAceTasteTag,
  aceTastePromptBits,
  ACE_TASTE_CHIPS,
} from "../src/lib/aceTaste.js";
import { buildAceStepBody } from "../src/server/aceStep.js";

describe("aceTaste", () => {
  it("mappe remarques diction → styleAddon", () => {
    const a = notesToStyleAddon("beaucoup de paroles pas compréhensibles");
    assert.match(a, /intelligible|enunciat/i);
  });

  it("mappe « pas du rap » → flow rappé", () => {
    const a = notesToStyleAddon("c'est pas du tout du rap, trop chanté");
    assert.match(a, /rapped|hip-hop|not melodic/i);
  });

  it("mappe rap US + gospel + mélodique", () => {
    const us = notesToStyleAddon("ça ressemble pas assez à du rap US");
    assert.match(us, /US hip-hop|American rap/i);
    const gospel = notesToStyleAddon("je veux plus de chœur gospel");
    assert.match(gospel, /gospel choir|Hammond/i);
    const mel = notesToStyleAddon("pas assez mélodique");
    assert.match(mel, /melodic rap|sung hooks/i);
  });

  it("pastilles toggle + compose", () => {
    assert.ok(ACE_TASTE_CHIPS.length >= 8);
    let t = normalizeAceTaste({});
    t = toggleAceTasteTag(t, "us-rap");
    t = toggleAceTasteTag(t, "gospel-choir");
    assert.deepEqual(t.tags.sort(), ["gospel-choir", "us-rap"].sort());
    assert.match(t.styleAddon, /US hip-hop/i);
    assert.match(t.styleAddon, /gospel choir/i);
    t = toggleAceTasteTag(t, "us-rap");
    assert.ok(!t.tags.includes("us-rap"));
  });

  it("composeStyleAddon fusionne tags + notes", () => {
    const a = composeStyleAddon(["more-melodic"], "plus de chœur gospel");
    assert.match(a, /melodic/i);
    assert.match(a, /gospel/i);
  });

  it("saveLiked fige CFG + notes", () => {
    const t = saveLikedAceTaste(
      { notes: "diction floue", tags: ["clear-diction"] },
      {
        aceGen: {
          guidanceScale: 3,
          inferenceSteps: 8,
          model: "acestep-v15-xl-turbo-bf16",
        },
        notes: "diction floue",
      },
    );
    assert.equal(t.guidanceScale, 3);
    assert.equal(t.inferenceSteps, 8);
    assert.ok(t.likedAt);
    assert.match(t.styleAddon, /intelligible|enunciat/i);
  });

  it("applyAceTasteToBody injecte addon + CFG + prefs", () => {
    const body = applyAceTasteToBody(
      {
        style: "Rap. male lead.",
        instruction: "Follow style.",
        guidanceScale: 0,
        inferenceSteps: 8,
      },
      {
        notes: "pas compréhensible",
        tags: ["us-rap"],
        styleAddon: "every word intelligible",
        guidanceScale: 3,
      },
    );
    assert.equal(body.guidanceScale, 3);
    assert.match(body.style, /intelligible|US hip-hop/i);
    assert.match(body.instruction, /User taste|Prefs|User notes/i);
  });

  it("aceTastePromptBits découpe l’addon", () => {
    const bits = aceTastePromptBits(
      { tags: ["us-rap"], notes: "plus de chœur gospel" },
      { maxBits: 4, maxLen: 40 },
    );
    assert.ok(bits.length >= 1);
    assert.ok(bits.every((b) => typeof b === "string" && b.length <= 40));
  });

  it("buildAceStepBody honore artist.aceTaste", () => {
    const body = buildAceStepBody({
      title: "T",
      style: "Rap / Drill francophone",
      lyrics: "[Verse]\nYo",
      language: "fr",
      modelId: "acestep-v15-xl-turbo-bf16",
      artist: {
        name: "K",
        gender: "male",
        genre: "Rap / Drill francophone",
        aceTaste: {
          notes: "paroles pas claires",
          tags: ["us-rap", "clear-diction"],
          guidanceScale: 4,
          likedAt: "2026-01-01T00:00:00.000Z",
        },
      },
      styleLock: { genreSummary: "Rap / Drill francophone" },
    });
    assert.equal(body.guidanceScale, 4);
    assert.match(body.style, /intelligible|US hip-hop/i);
    assert.match(body.instruction, /User taste|Prefs|User notes/i);
  });

  it("updateAceTasteNotes + clearLiked conserve tags", () => {
    const u = updateAceTasteNotes({ tags: ["airy-mix"] }, "mix trop plat");
    assert.ok(u.tags.includes("airy-mix"));
    assert.match(u.styleAddon, /airy|mix|depth/i);
    const c = clearAceTasteLiked({
      ...u,
      likedAt: "x",
      guidanceScale: 3,
    });
    assert.equal(c.likedAt, null);
    assert.equal(c.guidanceScale, null);
    assert.ok(c.tags.includes("airy-mix"));
  });

  it("normalizeAceTaste borne les valeurs", () => {
    const t = normalizeAceTaste({
      guidanceScale: 99,
      inferenceSteps: 0.4,
      notes: "x".repeat(600),
      tags: ["us-rap", "fake-tag"],
    });
    assert.equal(t.guidanceScale, 20);
    assert.equal(t.inferenceSteps, 1);
    assert.ok(t.notes.length <= 500);
    assert.deepEqual(t.tags, ["us-rap"]);
  });
});
