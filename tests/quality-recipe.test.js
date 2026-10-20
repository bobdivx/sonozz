import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fft, stft, istft } from "../src/server/quality/fft.js";
import { defectFeatures, summarizeVoiceWindows, styleFeatures } from "../src/server/quality/features.js";
import {
  buildQualityProfile, scoreTake, defectPenalty, pickBestTake, qaRetryError, parseQaRetryError,
  QA_RETRY_BELOW, qaMaxRetries,
} from "../src/server/quality/score.js";
import { blockOffsets } from "../src/server/quality/analyze.js";
import { closestToMedian, listAlbumTrackCandidates, pickRepresentativeTrack } from "../src/server/styleReference/representativeTrack.js";
import { buildAceCaption, sanitizeAceCaption, confirmedGenres, stripNames } from "../src/lib/aceCaption.js";
import { assembleAceStepStyle } from "../src/server/aceStep/body.js";
import { serializeStyleLock } from "../src/server/pipeline/util.js";
import { applyAceRecipe } from "../src/server/styleReference/aceRecipe.js";

describe("quality : FFT / STFT", () => {
  it("FFT taille quelconque (Bluestein 7680) = DFT, aller-retour exact", () => {
    for (const n of [15, 7680]) {
      const x = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + (i % 7) / 10);
      const re = Float64Array.from(x), im = new Float64Array(n);
      let a = 0, b = 0;
      for (let k = 0; k < n; k++) { a += x[k] * Math.cos((2 * Math.PI * 5 * k) / n); b -= x[k] * Math.sin((2 * Math.PI * 5 * k) / n); }
      fft(re, im);
      assert.ok(Math.abs(re[5] - a) < 1e-6 && Math.abs(im[5] - b) < 1e-6);
      fft(re, im, true);
      for (let k = 0; k < n; k += 97) assert.ok(Math.abs(re[k] / n - x[k]) < 1e-9);
    }
  });
  it("STFT/ISTFT (n_fft 7680, hop 1024) reconstruit le signal", () => {
    const x = Float32Array.from({ length: 1024 * 40 }, (_, i) => Math.sin(i / 9));
    const S = stft(x, { nFft: 7680, hop: 1024 });
    const y = istft(S.re, S.im, { nFft: 7680, hop: 1024, frames: S.frames, bins: S.bins, length: x.length });
    let e = 0; for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(x[i] - y[i]));
    assert.ok(e < 1e-4, `err ${e}`);
  });
});

describe("quality : défauts", () => {
  const sr = 11025;
  const tone = (sec) => Float32Array.from({ length: sr * sec }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr));
  it("détecte silence, saturation et prise coupée", () => {
    const silent = new Float32Array(sr * 20);
    assert.ok(defectFeatures(silent, sr).silentShare > 0.9);
    const clip = tone(10).map((v) => (v > 0.2 ? 1 : v));
    assert.ok(defectFeatures(clip, sr).clipShare > 0.01);
    const cut = defectFeatures(tone(60), sr, { requestedSec: 120 });
    assert.equal(cut.cut, true);
    const fade = tone(118);
    for (let i = 0; i < sr * 3; i++) fade[fade.length - 1 - i] *= i / (sr * 3);
    assert.equal(defectFeatures(fade, sr, { requestedSec: 120 }).cut, false);
  });
  it("pénalités multiplicatives (voix absente, coupée)", () => {
    const p = defectPenalty({ defects: { cut: true, silentShare: 0 }, style: { vocalEnergyShare: 0.01 }, voice: { voicedShare: 0.05 } });
    assert.ok(p.factor < 0.25);
    assert.deepEqual(p.list.sort(), ["prise coupée", "voix absente"].sort());
  });
  it("style sur bloc synthétique : kick régulier → attaques/s ≈ tempo", () => {
    const sr2 = 44100, n = 261120;
    const mix = new Float32Array(n);
    for (let b = 0; b < n; b += Math.round(sr2 * 0.5)) for (let i = 0; i < 2000 && b + i < n; i++) mix[b + i] += Math.sin((2 * Math.PI * 60 * i) / sr2) * Math.exp(-i / 400);
    const s = styleFeatures([{ mix, vocal: null }], sr2);
    assert.ok(s.kickPerSec > 1.4 && s.kickPerSec < 2.6, `kick ${s.kickPerSec}`);
    assert.ok(s.drumShare > 0.3);
  });
  it("blocs répartis dans le corps du morceau / l'extrait", () => {
    assert.deepEqual(blockOffsets(4), [0]);
    assert.equal(blockOffsets(30).length, 3);
    const o = blockOffsets(180);
    assert.ok(o[0] > 30 && o[2] < 180 - 6);
  });
});

describe("quality : score vs profil", () => {
  const ref = {
    ok: true,
    defects: { silentShare: 0, clipShare: 0, cut: false },
    style: { drumShare: 0.41, subShare: 0.2, melodicShare: 0.05, kickPerSec: 3.4, hatPerSec: 3.9, brightnessHz: 820, distortion: 0.02, tempo: 92, vocalEnergyShare: 0.35 },
    voice: { voicedShare: 0.5, maleShare: 0.6, maleF0: 290, maleHnr: 9, femaleF0: 480, femaleHnr: 12 },
  };
  const profile = buildQualityProfile(ref, { duo: true, source: "Mantra" });
  it("profil compact versionné", () => {
    assert.equal(profile.version, 1);
    assert.equal(profile.voice.maleHnr, 9);
    assert.equal(profile.style.drumShare, 0.41);
  });
  it("la référence elle-même score ~100 ; voix trop propre + metal + peu de batterie = bas", () => {
    assert.ok(scoreTake(ref, profile, { duo: true }).score >= 95);
    const bad = {
      ...ref,
      style: { ...ref.style, drumShare: 0.12, distortion: 0.09, melodicShare: 0.35, subShare: 0.05 },
      voice: { ...ref.voice, maleHnr: 17 },
    };
    const sc = scoreTake(bad, profile, { duo: true });
    assert.ok(sc.score < QA_RETRY_BELOW, `score ${sc.score}`);
    assert.ok(sc.parts.grain < 0.2);
  });
  it("voix plus rauque que la cible : peu pénalisée (asymétrique)", () => {
    const rough = { ...ref, voice: { ...ref.voice, maleHnr: 6 } };
    const clean = { ...ref, voice: { ...ref.voice, maleHnr: 12 } };
    assert.ok(scoreTake(rough, profile, { duo: true }).parts.grain > scoreTake(clean, profile, { duo: true }).parts.grain);
  });
  it("sans profil : défauts seulement", () => {
    const r = scoreTake({ ...ref, defects: { cut: true } }, null);
    assert.equal(r.profile, false);
    assert.ok(r.score < 60);
  });
  it("meilleure prise + erreur de relance aller-retour", () => {
    const best = pickBestTake({ url: "https://a/1.mp3", score: 55 }, { url: "https://a/2.mp3", score: 48 });
    assert.equal(best.url, "https://a/1.mp3");
    const e = qaRetryError(1, best, 48);
    assert.match(e.message, /^ACE_QA_RETRY/);
    assert.deepEqual(parseQaRetryError(e.message).best, best);
    assert.equal(qaMaxRetries({ preview: false }), 2);
    assert.equal(qaMaxRetries({ preview: true }), 1);
  });
  it("voix : part homme / femme et grain par voix depuis les fenêtres classées", () => {
    const wins = [
      ...Array.from({ length: 6 }, () => ({ f0: 280, hnr: 8, voiced: 0.6, rms: 0.05, pFemale: 0.1 })),
      ...Array.from({ length: 4 }, () => ({ f0: 520, hnr: 14, voiced: 0.7, rms: 0.05, pFemale: 0.9 })),
      { f0: 300, hnr: 5, voiced: 0.05, rms: 0.05, pFemale: 0.9 }, // pas assez voisée
      { f0: null, hnr: null, voiced: 0, rms: 0.001, pFemale: null },
    ];
    const v = summarizeVoiceWindows(wins);
    assert.equal(v.windows, 10);
    assert.equal(v.maleShare, 0.6);
    assert.equal(v.maleHnr, 8);
    assert.equal(v.femaleF0, 520);
  });
});

const fakeDeezer = (routes) => async (url) => {
  const key = Object.keys(routes).find((k) => url.includes(k));
  return { ok: Boolean(key), json: async () => (key ? routes[key] : {}) };
};

describe("référence de style automatique (Deezer)", () => {
  const routes = {
    "/search/artist": { data: [{ id: 99, name: "Bob Dominator", nb_fan: 3000 }, { id: 1, name: "Beat Dominator", nb_fan: 10 }] },
    "/artist/99/albums": { data: [
      { id: 10, title: "Black Dominator", record_type: "album", fans: 900, release_date: "2026-09-18" },
      { id: 11, title: "Blood Runs Wild", record_type: "single", fans: 500, release_date: "2026-07-17" },
      { id: 12, title: "Rock the Stadium (Live)", record_type: "album", fans: 50, release_date: "2026-01-01" },
    ] },
    "/artist/99/top": { data: [] },
    "/artist/99": { id: 99, name: "Bob Dominator" },
    "/album/10": { id: 10, title: "Black Dominator", genres: { data: [{ name: "Alternative" }] }, tracks: { data: [
      { id: 1001, title: "Blood Runs Wild", rank: 500000, duration: 153, artist: { id: 99 } },
      { id: 1002, title: "Mantra", rank: 450000, duration: 157, artist: { id: 99 } },
      { id: 1003, title: "Intro", rank: 900000, duration: 60, artist: { id: 99 } },
      { id: 1004, title: "My Wolf", rank: 430000, duration: 161, artist: { id: 99 } },
    ] } },
  };
  it("candidats = titres d'album, sans singles / intro / live", async () => {
    const r = await listAlbumTrackCandidates({ name: "Bob Dominator", fetchImpl: fakeDeezer(routes) });
    assert.equal(r.artistId, "99");
    const titles = r.candidates.map((c) => c.title);
    assert.ok(titles.includes("Mantra"));
    assert.ok(!titles.includes("Blood Runs Wild"));
    assert.ok(!titles.includes("Intro"));
    assert.deepEqual(r.genres, ["Alternative"]);
  });
  it("sans audio : titre d'album le plus écouté non sorti en single ; mode reference, force 1", async () => {
    const r = await pickRepresentativeTrack({ name: "Bob Dominator", fetchImpl: fakeDeezer(routes) });
    assert.equal(r.deezerTrackId, "1002");
    assert.equal(r.mode, "reference");
    assert.equal(r.strength, 1);
    assert.equal(r.auto, true);
  });
  it("avec audio : le plus proche de la médiane", () => {
    const f = (d, s) => ({ drumShare: d, subShare: s, melodicShare: 0.2, kickPerSec: 3, hatPerSec: 3, brightnessHz: 800, distortion: 0.02 });
    assert.equal(closestToMedian([f(0.1, 0.05), f(0.4, 0.2), f(0.38, 0.21), f(0.42, 0.19), f(0.7, 0.6)]), 1);
  });
});

describe("caption ACE automatique (règles v3/v4)", () => {
  const bobLock = {
    matchedName: "Bob Dominator",
    genres: ["Folk Metal", "Electronic", "Dubstep"],
    instruments: ["heavy drums", "808 bass", "taiko war drums", "oriental strings", "epic choir"],
    bpm: 90,
    duoVocals: {
      female: { range: "alto-mezzo", texture: "powerful, husky", delivery: "sung hooks" },
      male: { range: "high baritone", texture: "gritty, rough", delivery: "shouted belting" },
      interaction: "call-and-response",
    },
  };
  it("duo rauque non rock : duet en tête, voix rauque, pas de dubstep/808, no guitars, pas de nom", () => {
    const { caption, noGuitars } = buildAceCaption({ styleLock: bobLock, catalogGenres: ["Electro", "Alternative"], duo: true, names: ["Torvik Hale"] });
    assert.match(caption, /^male and female vocal duet, both voices clearly audible\./);
    assert.match(caption, /high-pitched male tenor, raspy/);
    assert.match(caption, /no guitars/);
    assert.match(caption, /90 BPM/);
    assert.doesNotMatch(caption, /dubstep|808|trap|Bob Dominator/i);
    assert.equal(noGuitars, true);
    assert.ok(caption.length <= 420);
  });
  it("pop / chanson : pas de mots rauques ni « no guitars » inutile", () => {
    const { caption } = buildAceCaption({
      styleLock: { matchedName: "Vianney", genres: ["French Pop", "Chanson"], timbre: "warm, soft tenor", vocalStyle: "intimate sung", instruments: ["acoustic guitar", "piano", "strings"], bpm: 100 },
      catalogGenres: ["Pop", "Chanson française"],
      leadGender: "male",
    });
    assert.doesNotMatch(caption, /raspy|gravelly|distorted|no guitars|Vianney/i);
    assert.match(caption, /acoustic guitar/);
    assert.match(caption, /male tenor|male vocal/);
  });
  it("un genre « nettoyant » non confirmé par le catalogue est ignoré", () => {
    assert.deepEqual(confirmedGenres({ catalogGenres: ["Electro"], lockGenres: ["Dubstep", "Electro"] }), ["electro"]);
  });
  it("garde-fou LLM : noms retirés, prose coupée, règles réappliquées", () => {
    const t = sanitizeAceCaption("In the style of Bob Dominator, dark electro, raspy male tenor, trap hi-hats, electric guitar riffs", { names: ["Bob Dominator"], rough: true, noGuitars: true, duo: true });
    assert.doesNotMatch(t, /Bob|trap|electric guitar/i);
    assert.match(t, /no guitars/);
    assert.match(t, /^male and female vocal duet/);
    assert.equal(stripNames("epic, exactly in the style of X Y, drums", []), "epic, drums");
  });
  it("body ACE : la caption de recette est envoyée telle quelle (artiste sans recette : inchangé)", () => {
    const cap = "male and female vocal duet, both voices clearly audible. electro, raspy male tenor, no guitars, 90 BPM. clear sung lyrics, airy mix.";
    const withRecipe = assembleAceStepStyle({ style: "x", language: "en", styleLock: { aceCaption: cap }, artist: { name: "A", gender: "male" } });
    assert.equal(withRecipe.style, cap.replace(/\.$/, ""));
    const without = assembleAceStepStyle({ style: "rock", language: "en", styleLock: { genreSummary: "rock" }, artist: { name: "A", gender: "male" } });
    assert.notEqual(without.style, withRecipe.style);
    const fr = assembleAceStepStyle({ style: "x", language: "fr", styleLock: { aceCaption: cap }, artist: { name: "A", gender: "male" } });
    assert.ok(fr.style.startsWith(cap.replace(/\.$/, "")) && fr.style.length > cap.length);
  });
  it("le profil sérialisé garde la recette ; applyAceRecipe ne touche que ses champs", () => {
    const lock = applyAceRecipe({ matchedName: "Bob", genres: ["Electro"] }, {
      styleReference: { source: "deezer", deezerTrackId: "1", title: "T", mode: "reference", strength: 1 },
      aceCaption: "c", qualityProfile: { version: 1 }, aceRecipe: { version: 1 },
    });
    const s = serializeStyleLock(lock);
    assert.equal(s.styleReference.deezerTrackId, "1");
    assert.equal(s.aceCaption, "c");
    assert.equal(s.qualityProfile.version, 1);
    assert.deepEqual(s.genres, ["Electro"]);
  });
});

