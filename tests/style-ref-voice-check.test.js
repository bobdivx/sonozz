import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAceStepBody } from "../src/server/aceStep/body.js";
import {
  readArtistStyleReference,
  resolveArtistStyleReference,
  isDirectStyleRefHostOk,
} from "../src/server/aceStep/artistStyleRef.js";
import {
  voiceCheckEndpoint,
  measureMaleVoice,
  voiceCheckVerdict,
  pickRougherTake,
  voiceCleanError,
  parseVoiceCleanError,
  VOICE_CHECK_HNR_MAX_DB,
} from "../src/server/aceStep/voiceCheck.js";

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
      lyrics: "[Verse]\nAshes fall",
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

describe("vérification de la voix d'homme (duo)", () => {
  it("inactive sans SONOZZ_VOICE_CHECK_URL", async () => {
    assert.equal(voiceCheckEndpoint({}, {}), "");
    assert.equal(await measureMaleVoice({}, "https://a/b.mp3", { env: {} }), null);
    assert.equal(voiceCheckEndpoint({}, { SONOZZ_VOICE_CHECK_URL: "http://gpu:8765/" }), "http://gpu:8765");
  });

  it("appelle le worker et lit maleHnr", async () => {
    let sent;
    const fetchImpl = async (u, o) => { sent = { u, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ maleHnr: 12.34, maleSeconds: 9 }) }; };
    const m = await measureMaleVoice({}, "https://ace/x.mp3", { fetchImpl, env: { SONOZZ_VOICE_CHECK_URL: "http://gpu:8765" } });
    assert.equal(sent.u, "http://gpu:8765/check");
    assert.equal(sent.body.audioUrl, "https://ace/x.mp3");
    assert.equal(m.maleHnr, 12.3);
  });

  it("verdict : > 12 dB (échelle worker) = propre, peu de voix d'homme = inconnu", () => {
    assert.equal(VOICE_CHECK_HNR_MAX_DB, 12);
    assert.equal(voiceCheckVerdict({ maleHnr: 13, maleSeconds: 9 }), "clean");
    assert.equal(voiceCheckVerdict({ maleHnr: 7, maleSeconds: 9 }), "rough");
    assert.equal(voiceCheckVerdict({ maleHnr: 13, maleSeconds: 1 }), "unknown");
    assert.equal(voiceCheckVerdict(null), "unknown");
  });

  it("garde la prise la plus rauque et la transporte dans l'erreur de relance", () => {
    const best = pickRougherTake({ url: "https://a/1.mp3", hnr: 11.5 }, { url: "https://a/2.mp3", hnr: 14 });
    assert.equal(best.url, "https://a/1.mp3");
    const err = voiceCleanError(1, best);
    assert.match(err.message, /ACE_VOICE_CLEAN/);
    assert.deepEqual(parseVoiceCleanError(err.message).best, { url: "https://a/1.mp3", hnr: 11.5 });
    assert.equal(parseVoiceCleanError("autre erreur"), null);
  });
});
