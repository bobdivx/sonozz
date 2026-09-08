import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTrackInstrumentPlan } from "../src/server/trackInstrumentPlan.js";
import { assembleAceStepStyle } from "../src/server/aceStep.js";

describe("resolveTrackInstrumentPlan", () => {
  it("sans LLM → plan déterministe avec instrumentArc", async () => {
    const { artist, variation, source } = await resolveTrackInstrumentPlan(
      {},
      {
        artist: {
          name: "Haze",
          slug: "haze",
          gender: "male",
          genre: "Indie Pop",
          styleLock: {
            genreSummary: "Indie Pop",
            bpm: 110,
            instruments: ["guitar", "bass", "drums"],
          },
        },
        lyrics: { title: "Echoes", text: "[Verse]\nHello haze" },
        skipLlm: true,
      },
    );
    assert.equal(source, "deterministic");
    assert.ok(variation.sonicRole);
    assert.ok(variation.instrumentArc);
    assert.match(variation.instrumentArc, /arc|verse|chorus/i);
    assert.equal(artist.sonicRole, variation.sonicRole);
    assert.equal(artist.instrumentArc, variation.instrumentArc);
  });

  it("plan déjà figé → source existing", async () => {
    const arc =
      "ballad arc: verse piano only → chorus strings → intimate bridge → warm final";
    const { source, variation } = await resolveTrackInstrumentPlan(
      { geminiApiKey: "fake-should-not-call" },
      {
        artist: {
          name: "Haze",
          sonicRole: "ballad",
          instrumentArc: arc,
          styleLock: { genreSummary: "Indie Pop", bpm: 90 },
        },
        lyrics: { title: "Soft" },
      },
    );
    assert.equal(source, "existing");
    assert.equal(variation.sonicRole, "ballad");
    assert.match(variation.instrumentArc, /ballad arc/i);
  });

  it("assembleAceStepStyle injecte l’arc piste", () => {
    const a = assembleAceStepStyle({
      style: "indie pop",
      language: "en",
      artist: {
        name: "Haze",
        gender: "male",
        genre: "Indie Pop",
        sonicRole: "banger",
        instrumentArc:
          "banger arc: verse tight drums → chorus max layers → breakdown → biggest final",
      },
      styleLock: { genreSummary: "Indie Pop" },
      lyrics: "hi",
    });
    assert.match(a.style, /banger arc|breakdown|max layers/i);
    assert.equal(a.brief.sonicRole, "banger");
    assert.ok(a.brief.trackArc);
  });

  it("album forcé : rôle gardé, plan frais (pas existing)", async () => {
    const { source, variation } = await resolveTrackInstrumentPlan(
      {},
      {
        artist: {
          name: "Haze",
          gender: "male",
          genre: "Indie Pop",
          styleLock: { genreSummary: "Indie Pop", bpm: 100, instruments: ["guitar"] },
          forceFreshInstrumentPlan: true,
          trackRoleForced: "ballad",
          albumTrackIndex: 3,
          albumTrackTotal: 6,
          usedSonicRoles: ["single", "opener"],
          usedLeads: ["electric guitar", "synth lead"],
          usedInstrumentArcs: ["opener arc: sparse piano"],
        },
        lyrics: { title: "Slow Burn", text: "[Verse]\nSoft night" },
        skipLlm: true,
      },
    );
    assert.equal(source, "deterministic");
    assert.equal(variation.sonicRole, "ballad");
    assert.ok(variation.instrumentArc);
    assert.ok(variation.musicArrange.leadInstrument);
    assert.notEqual(variation.musicArrange.leadInstrument, "electric guitar");
  });
});
