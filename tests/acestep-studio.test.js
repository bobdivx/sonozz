import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAceStepBody,
  extractGradioUploadUrl,
  gradioFileUrl,
  interpretAceProbe,
  isAceHostedAudioUrl,
  isGradioReferenceCacheError,
  lyricsForAceStepPreview,
  pickAceStepModel,
  resolveAceAudioUrl,
  resolveAceStepBaseUrl,
  resolveAceStepGradioUrl,
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
    assert.equal(sft.referenceAudioUrl, undefined);
    assert.equal(sft.taskType, undefined);
  });

  it("envoie le preview titre phare en référence style (pas une cover)", () => {
    const body = buildAceStepBody({
      title: "Vile Adulteress",
      style: "brutal death metal",
      lyrics: "[Verse]\nFlesh",
      language: "en",
      bpm: 170,
      modelId: "acestep-v15-xl-sft",
      referenceAudioUrl: "https://audio.example/condemnation.m4a",
      referenceAudioTitle: "Condemnation Contagion — Cannibal Corpse",
    });
    assert.equal(body.customMode, true);
    assert.equal(body.taskType, "text2music");
    assert.equal(body.referenceAudioUrl, "https://audio.example/condemnation.m4a");
    assert.match(body.referenceAudioTitle, /Condemnation Contagion/);
    assert.equal(body.audioCoverStrength, 0.25);
    assert.match(body.instruction, /not a cover/i);

    const viaGradio = buildAceStepBody({
      title: "Vile Adulteress",
      style: "brutal death metal",
      lyrics: "x",
      language: "en",
      studioBase: "http://127.0.0.1:3001",
      referenceAudioUrl: "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/hash/style-ref.mp3",
      referenceAudioTitle: "Condemnation Contagion",
    });
    assert.match(viaGradio.referenceAudioUrl, /gradio_api\/file=/);
    assert.equal(viaGradio.taskType, "text2music");
  });

  it("refuse les URLs ACE /audio/ (Gradio 5 InvalidPathError)", () => {
    const studio = "http://127.0.0.1:3001";
    assert.equal(isAceHostedAudioUrl(studio, "/audio/u/ref.mp3"), true);
    assert.equal(
      isAceHostedAudioUrl(studio, "http://127.0.0.1:3001/audio/1787059803049-9af11083.mp3"),
      true,
    );
    assert.equal(
      isAceHostedAudioUrl(studio, "https://audio-ssl.itunes.apple.com/preview.m4a"),
      false,
    );
    assert.equal(
      isAceHostedAudioUrl(studio, "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/x.mp3"),
      false,
    );

    const body = buildAceStepBody({
      title: "Vile Adulteress",
      style: "death metal",
      lyrics: "x",
      language: "en",
      studioBase: studio,
      referenceAudioUrl: "http://127.0.0.1:3001/audio/ref.mp3",
      referenceAudioTitle: "local ACE",
    });
    assert.equal(body.referenceAudioUrl, undefined);
    assert.equal(body.taskType, undefined);
  });

  it("dérive l’URL Gradio :8001 et parse l’upload officiel", () => {
    assert.equal(
      resolveAceStepGradioUrl({ aceStepBaseUrl: "http://10.1.0.88:3001" }),
      "http://10.1.0.88:8001",
    );
    assert.equal(
      resolveAceStepGradioUrl({ aceStepGradioUrl: "http://127.0.0.1:7865" }),
      "http://127.0.0.1:7865",
    );
    assert.equal(
      gradioFileUrl("http://127.0.0.1:8001", "D:\\temp\\gradio\\a.mp3"),
      "http://127.0.0.1:8001/gradio_api/file=D:/temp/gradio/a.mp3",
    );
    assert.equal(
      extractGradioUploadUrl("http://127.0.0.1:8001", ["/tmp/gradio/hash/style-ref.mp3"]),
      "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/hash/style-ref.mp3",
    );
    assert.equal(
      extractGradioUploadUrl("http://127.0.0.1:8001", {
        url: "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/x.mp3",
      }),
      "http://127.0.0.1:8001/gradio_api/file=/tmp/gradio/x.mp3",
    );
    assert.equal(
      isGradioReferenceCacheError(
        "Cannot move D:\\pinokio\\api\\ACE-Step-Studio-pinokio.git\\app\\temp\\gradio\\ref-1\\x.mp3 to the gradio cache dir because it was not uploaded by a user.",
      ),
      true,
    );
    assert.equal(isGradioReferenceCacheError("VRAM OOM"), false);
  });

  it("détecte ACE totalement injoignable vs moteur Python down", () => {
    const down = interpretAceProbe({
      base: "http://127.0.0.1:3001",
      health: { healthy: false, error: "ACE-Step Studio injoignable (http://127.0.0.1:3001) — délai dépassé" },
      status: {},
    });
    assert.equal(down.unreachable, true);

    const python = interpretAceProbe({
      health: { healthy: false },
      status: { connected: false, activeModel: "" },
    });
    assert.equal(python.unreachable, false);
    assert.equal(python.pipelineUp, false);
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
