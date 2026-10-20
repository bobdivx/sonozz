import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAceStepBody } from "../src/server/aceStep/body.js";
import {
  readArtistStyleReference,
  resolveArtistStyleReference,
  isDirectStyleRefHostOk,
} from "../src/server/aceStep/artistStyleRef.js";

const artist = {
  name: "Skarlvind",
  styleLock: { styleReference: { source: "deezer", deezerTrackId: "4277012282", title: "Mantra — Bob Dominator" } },
};

describe("référence de style par artiste", () => {
  it("lit styleLock.styleReference (deezer) en mode reference par défaut", () => {
    const r = readArtistStyleReference(artist);
    assert.equal(r.source, "deezer");
    assert.equal(r.deezerTrackId, "4277012282");
    assert.equal(r.mode, "reference");
    assert.equal(readArtistStyleReference({ styleLock: { styleReference: { enabled: false, source: "deezer", deezerTrackId: "1" } } }), null);
    assert.equal(readArtistStyleReference({}), null);
  });

  it("rafraîchit l'aperçu Deezer à chaque génération", async () => {
    const calls = [];
    const fetchImpl = async (u) => {
      calls.push(u);
      return { ok: true, json: async () => ({ preview: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3?hdnea=exp=1" }) };
    };
    const r = await resolveArtistStyleReference(artist, { fetchImpl });
    assert.equal(calls[0], "https://api.deezer.com/track/4277012282");
    assert.match(r.url, /dzcdn\.net/);
    assert.equal(r.mode, "reference");
  });

  it("source env : URL privée lue côté serveur, jamais en http", async () => {
    const a = { styleLock: { styleReference: { source: "env", env: "SKARLVIND_REF" } } };
    assert.equal((await resolveArtistStyleReference(a, { env: { SKARLVIND_REF: "https://priv.example/x.mp3" } })).url, "https://priv.example/x.mp3");
    assert.equal(await resolveArtistStyleReference(a, { env: { SKARLVIND_REF: "http://insecure/x.mp3" } }), null);
  });

  it("URL directe acceptée seulement pour les hôtes testés (Deezer)", () => {
    assert.equal(isDirectStyleRefHostOk("https://cdnt-preview.dzcdn.net/a.mp3"), true);
    assert.equal(isDirectStyleRefHostOk("https://s3.amazonaws.com/a.mp3"), false);
  });

  it("body ACE mode reference : pas de cover, pas de source, durée demandée", () => {
    const body = buildAceStepBody({
      title: "T",
      style: "dark folk metal, electronic",
      lyrics: ["[Verse]", "[Chorus]", "[Verse]", "[Chorus]", "[Bridge]", "[Chorus]"]
        .map((t) => `${t}\n${"Ashes fall upon the frozen shore tonight\n".repeat(6)}`)
        .join("\n"),
      language: "en",
      bpm: 90,
      modelId: "acestep-v15-xl-turbo-bf16",
      durationSec: 180,
      referenceAudioUrl: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3",
      referenceAudioTitle: "Mantra",
      referenceMode: "reference",
    });
    assert.equal(body.referenceAudioUrl, "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3");
    assert.equal(body.sourceAudioUrl, undefined);
    assert.notEqual(body.taskType, "cover");
    assert.equal(body.audioCoverStrength, undefined);
    assert.equal(body.duration, 180);
    const strong = buildAceStepBody({
      title: "T", style: "dark folk", lyrics: "[Verse]\nx", language: "en", bpm: 90,
      modelId: "acestep-v15-xl-turbo-bf16", referenceAudioUrl: "https://cdnt-preview.dzcdn.net/api/1/1/x.mp3",
      referenceMode: "reference", audioCoverStrength: 1,
    });
    assert.equal(strong.audioCoverStrength, 1);
    assert.equal(strong.sourceAudioUrl, undefined);
  });

  it("body ACE sans referenceMode : cover historique inchangé", () => {
    const body = buildAceStepBody({
      title: "T", style: "rock", lyrics: "[Verse]\nx", language: "en", bpm: 120,
      modelId: "acestep-v15-xl-turbo-bf16", referenceAudioUrl: "https://audio.example/a.mp3",
    });
    assert.equal(body.taskType, "cover");
    assert.equal(body.sourceAudioUrl, "https://audio.example/a.mp3");
  });
});

// L'ancien worker Python externe (tools/voice-check) est remplacé par le contrôle qualité intégré :
// voir tests/quality-recipe.test.js.
