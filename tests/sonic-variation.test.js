import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  albumArcRole,
  applySonicVariation,
  artistWithSonicVariation,
  composeInstrumentArc,
  normalizeSonicRole,
  pickSonicRole,
  SONIC_ROLE_IDS,
} from "../src/lib/sonicVariation.js";

const lock = {
  genreSummary: "Afro-trap",
  mood: "nocturne",
  energy: "mid",
  bpm: 96,
  instruments: ["808 bass", "trap drums", "synth pads"],
  vocalStyle: "spoken-sung male",
};

describe("sonicVariation", () => {
  it("normalizeSonicRole accepte alias", () => {
    assert.equal(normalizeSonicRole("Banger"), "banger");
    assert.equal(normalizeSonicRole("outro"), "closer");
    assert.equal(normalizeSonicRole("radio"), "single");
    assert.equal(normalizeSonicRole("???"), null);
  });

  it("albumArcRole : lead single, fin closer, milieu contrasté", () => {
    assert.equal(albumArcRole(1, 8), "single");
    assert.equal(albumArcRole(8, 8), "closer");
    const mid = [2, 3, 4, 5, 6, 7].map((i) => albumArcRole(i, 8));
    assert.ok(new Set(mid).size >= 3);
    assert.ok(!mid.every((r) => r === "single"));
    assert.ok(mid[0] !== mid[1] || mid[1] !== mid[2]);
  });

  it("titres solo : rôles stables par titre", () => {
    const a = pickSonicRole({ title: "Sablier", artistKey: "zahra" });
    const b = pickSonicRole({ title: "Sablier", artistKey: "zahra" });
    assert.equal(a, b);
    assert.ok(SONIC_ROLE_IDS.includes(a));
    const other = pickSonicRole({
      title: "Sablier",
      artistKey: "zahra",
      usedRoles: [a],
    });
    assert.notEqual(other, a);
  });

  it("évite les rôles déjà utilisés si possible", () => {
    const used = ["ballad", "banger", "opener", "midtempo", "deep_cut", "closer"];
    const r = pickSonicRole({
      title: "Solo X",
      artistKey: "zahra",
      usedRoles: used,
    });
    assert.equal(r, "single");
  });

  it("applySonicVariation change BPM / densité selon le rôle", () => {
    const ballad = applySonicVariation({
      styleLock: lock,
      role: "ballad",
      title: "Douce",
      artistKey: "zahra",
    });
    const banger = applySonicVariation({
      styleLock: lock,
      role: "banger",
      title: "Feu",
      artistKey: "zahra",
    });
    assert.equal(ballad.sonicRole, "ballad");
    assert.equal(banger.sonicRole, "banger");
    assert.ok(ballad.musicArrange.bpm < lock.bpm);
    assert.ok(banger.musicArrange.bpm > lock.bpm);
    assert.equal(banger.musicArrange.density, "dense");
    assert.match(ballad.musicArrange.notes, /sonic:ballad/);
  });

  it("arrangement manuel : ne touche pas lead/density, seulement BPM + notes", () => {
    const manual = {
      leadInstrument: "saxophone",
      choir: "none",
      drums: "live kit",
      density: "sparse",
      bpm: 100,
      features: ["brass stabs"],
      notes: "mon setup",
      source: "manual",
    };
    const v = applySonicVariation({
      musicArrange: manual,
      styleLock: lock,
      role: "banger",
      title: "X",
    });
    assert.equal(v.musicArrange.leadInstrument, "saxophone");
    assert.equal(v.musicArrange.density, "sparse");
    assert.ok(v.musicArrange.bpm !== 100);
    assert.match(v.musicArrange.notes, /sonic:banger/);
  });

  it("artistWithSonicVariation garde le mood DNA, ajuste energy + arrange", () => {
    const v = applySonicVariation({
      styleLock: lock,
      role: "ballad",
      title: "Y",
      artistKey: "z",
    });
    const artist = artistWithSonicVariation(
      { name: "Z", styleLock: lock, mood: "nocturne" },
      v,
    );
    assert.equal(artist.sonicRole, "ballad");
    assert.equal(artist.mood, "nocturne");
    assert.equal(artist.styleLock.mood, "nocturne");
    assert.equal(artist.styleLock.energy, "low");
    assert.ok(artist.musicArrange.bpm < 96);
  });

  it("composeInstrumentArc + applySonicVariation exposent un arc par rôle", () => {
    const ballad = applySonicVariation({
      styleLock: lock,
      role: "ballad",
      title: "Douce",
      artistKey: "zahra",
    });
    assert.ok(ballad.instrumentArc);
    assert.match(ballad.instrumentArc, /ballad|fingerpick|piano|string/i);
    assert.match(composeInstrumentArc("banger"), /banger|breakdown|max/i);
    const artist = artistWithSonicVariation(
      { name: "Z", styleLock: lock },
      ballad,
    );
    assert.equal(artist.instrumentArc, ballad.instrumentArc);
  });

  it("album : leads / features / BPM distincts entre titres", () => {
    const usedLeads = [];
    const usedFeatures = [];
    const plans = [];
    for (let i = 1; i <= 5; i++) {
      const v = applySonicVariation({
        styleLock: lock,
        title: `Titre ${i}`,
        artistKey: "zahra",
        trackIndex: i,
        trackTotal: 5,
        usedRoles: plans.map((p) => p.sonicRole),
        usedLeads,
        usedFeatures,
      });
      plans.push(v);
      if (v.musicArrange.leadInstrument) usedLeads.push(v.musicArrange.leadInstrument);
      usedFeatures.push(...(v.musicArrange.features || []));
    }
    const roles = plans.map((p) => p.sonicRole);
    assert.equal(roles[0], "single");
    assert.equal(roles[4], "closer");
    assert.ok(new Set(roles).size >= 3, `rôles trop peu variés: ${roles.join(",")}`);
    const leads = plans.map((p) => p.musicArrange.leadInstrument).filter(Boolean);
    assert.ok(new Set(leads).size >= 2, `leads trop peu variés: ${leads.join(",")}`);
    const bpms = plans.map((p) => p.musicArrange.bpm);
    assert.ok(new Set(bpms).size >= 2, `BPM tous identiques: ${bpms.join(",")}`);
  });
});
