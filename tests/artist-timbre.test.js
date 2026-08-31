import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  artistHasLockedTimbre,
  artistLockedTimbre,
  applyTimbreDnaToArtist,
} from "../src/server/artistTimbre.js";

describe("artistTimbre", () => {
  it("détecte un timbre déjà figé", () => {
    assert.equal(artistHasLockedTimbre({}), false);
    assert.equal(
      artistHasLockedTimbre({ voiceSample: { songGenTimbre: "warm soft tenor" } }),
      true,
    );
    assert.equal(artistLockedTimbre({ styleLock: { timbre: "raspy baritone" } }), "raspy baritone");
  });

  it("applique le DNA Gemini sur voiceSample + styleLock", () => {
    const next = applyTimbreDnaToArtist(
      { name: "ZAHRA", gender: "female", styleLock: { genreSummary: "afro" } },
      {
        timbre: "bright airy mezzo",
        songGenTimbre: "bright airy mezzo",
        vocalStyle: "melodic afro vocals",
        vocalRegister: "mezzo",
        genderFeel: "female",
      },
      { source: "hub-track" },
    );
    assert.equal(next.voiceSample.songGenTimbre, "bright airy mezzo");
    assert.equal(next.voiceSample.analyzedTimbre, "bright airy mezzo");
    assert.equal(next.voiceSample.timbreSource, "hub-track");
    assert.equal(next.styleLock.timbre, "bright airy mezzo");
    assert.match(next.voice, /melodic afro|bright airy/i);
    assert.equal(artistHasLockedTimbre(next), true);
  });

  it("synthétise un timbre depuis le profil IA sans audio", async () => {
    const { synthesizeArtistTimbreDna, lockSynthesizedTimbre } = await import(
      "../src/server/artistTimbre.js"
    );
    const dna = synthesizeArtistTimbreDna({
      name: "ZAHRA",
      gender: "female",
      voice: "breathy melodic afro vocals",
      genre: "Afro-trap",
      styleLock: { vocalStyle: "soft melodic", mood: "nocturnal" },
    });
    assert.ok(dna.songGenTimbre);
    assert.match(dna.songGenTimbre, /mezzo|breathy|bright|soft|melodic/i);

    const locked = lockSynthesizedTimbre({
      name: "Jeser",
      gender: "male",
      voice: "raspy rap baritone",
    });
    assert.equal(artistHasLockedTimbre(locked), true);
    assert.equal(locked.voiceSample.timbreSource, "profile-synth");
  });
});
