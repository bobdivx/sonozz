import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAceStepBody,
  lyricsForAceStepPreview,
  pickAceStepModel,
  resolveAceAudioUrl,
  resolveAceStepBaseUrl,
  isAceStepMusicProvider,
} from "../src/server/aceStep.js";
import { isStudioEnabled, keysAfterStudioToggle } from "../src/lib/keys.js";

describe("ACE-Step Studio client", () => {
  it("résout l’URL et le provider", () => {
    assert.equal(resolveAceStepBaseUrl({}), "http://127.0.0.1:3001");
    assert.equal(
      resolveAceStepBaseUrl({ aceStepBaseUrl: "http://10.1.0.88:3001/" }),
      "http://10.1.0.88:3001",
    );
    assert.equal(isAceStepMusicProvider({ musicProvider: "acestep" }), true);
    assert.equal(isAceStepMusicProvider({ musicProvider: "songgen" }), false);
    assert.equal(
      isAceStepMusicProvider({ musicProvider: "acestep", aceStepEnabled: "0" }),
      false,
    );
  });

  it("préfixe les URLs audio relatives", () => {
    assert.equal(
      resolveAceAudioUrl("http://127.0.0.1:3001", "/audio/u/song.mp3"),
      "http://127.0.0.1:3001/audio/u/song.mp3",
    );
    assert.equal(
      resolveAceAudioUrl("http://127.0.0.1:3001", "https://cdn.example/a.mp3"),
      "https://cdn.example/a.mp3",
    );
  });

  it("choisit le modèle : préférence > actif > turbo bf16", () => {
    const models = [
      { id: "acestep-v15-xl-turbo", isPreloaded: true, isActive: false },
      { id: "marcorez8/acestep-v15-xl-turbo-bf16", isPreloaded: true, isActive: false },
      { id: "acestep-v15-xl-sft", isPreloaded: false, isActive: false },
    ];
    assert.equal(
      pickAceStepModel({ models, activeModel: "acestep-v15-xl-turbo" }, {}).modelId,
      "acestep-v15-xl-turbo",
    );
    assert.equal(
      pickAceStepModel({ models }, { preferredId: "acestep-v15-xl-sft" }).modelId,
      "acestep-v15-xl-sft",
    );
    assert.equal(
      pickAceStepModel({ models }, {}).modelId,
      "marcorez8/acestep-v15-xl-turbo-bf16",
    );
  });

  it("tronque les paroles preview et calibre Turbo vs SFT", () => {
    const long = Array.from({ length: 30 }, (_, i) => `ligne ${i + 1}`).join("\n");
    const preview = lyricsForAceStepPreview(long);
    assert.equal(preview.split("\n").length, 16);

    const turbo = buildAceStepBody({
      title: "Test",
      style: "pop, female vocal",
      lyrics: long,
      language: "fr",
      bpm: 118,
      modelId: "acestep-v15-xl-turbo",
      preview: true,
    });
    assert.equal(turbo.customMode, true);
    assert.equal(turbo.instrumental, false);
    assert.equal(turbo.vocalLanguage, "fr");
    assert.equal(turbo.inferenceSteps, 8);
    assert.equal(turbo.guidanceScale, 0);
    assert.ok(turbo.duration <= 45);
    assert.ok(turbo.lyrics.split("\n").length <= 16);

    const sft = buildAceStepBody({
      title: "Test",
      style: "pop",
      lyrics: "hello",
      language: "en",
      modelId: "acestep-v15-xl-sft",
      preview: false,
    });
    assert.equal(sft.inferenceSteps, 50);
    assert.equal(sft.guidanceScale, 7);
    assert.equal(sft.duration, 180);
  });

  it("toggle active/désactive un studio et bascule le moteur actif", () => {
    const base = { musicProvider: "acestep", aceStepEnabled: "1", songGenEnabled: "1", replicateEnabled: "1" };
    assert.equal(isStudioEnabled(base, "acestep"), true);
    const off = keysAfterStudioToggle(base, "acestep", false);
    assert.equal(off.aceStepEnabled, "0");
    assert.equal(off.musicProvider, "replicate");
    const on = keysAfterStudioToggle(off, "acestep", true);
    assert.equal(on.aceStepEnabled, "1");
  });
});
