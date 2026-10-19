import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeAudioDna,
  isLesserKnownArtist,
  styleDnaSource,
  styleLockWarnings,
  vocalTimbreStyleBit,
  buildCloneSoundPatch,
  styleLockFromSourceProfile,
  isStrictStyleFidelity,
} from "../src/lib/styleFidelity.js";
import { aggregateDeezerAlbums } from "../src/server/styleReference/providers.js";
import { isThinCatalog, mergeCatalogs } from "../src/server/styleReference/availability.js";
import { applySonicVariation, lanePoolsForLock } from "../src/lib/sonicVariation.js";
import { buildArtistDraftPatch } from "../src/lib/artistDraft.js";
import { buildAceStepBody } from "../src/server/aceStep/body.js";

const VIKING_LOCK = {
  genres: ["Electro", "Rock"],
  genreSummary: "Nordic electro-rock",
  energy: "high",
  mood: "epic, dark",
  bpm: 128,
  timbre: "deep gritty baritone, chant-like",
  vocalRegister: "baritone",
  instruments: ["distorted guitars", "analog synth arps", "war drums", "sub bass"],
  production: "dense, punchy",
  rhythmFeel: "driving four-on-the-floor with live toms",
};

describe("catalogue Deezer : petit artiste sans /top", () => {
  it("agrège titres, previews et genres depuis les albums", () => {
    const agg = aggregateDeezerAlbums(
      [
        { id: 1, title: "Black Dominator", genre_id: 85 },
        { id: 2, title: "Gold Dominator, Pt. 1", genre_id: 106 },
        { id: 3, title: "Viking Gods", genre_id: 152 },
      ],
      [
        {
          genres: { data: [{ name: "Electro" }] },
          tracks: {
            data: [
              { title: "Dragons Lair", preview: "https://cdn.example/a.mp3" },
              { title: "Blood Runs Wild", preview: "https://cdn.example/b.mp3" },
            ],
          },
        },
      ],
    );
    assert.deepEqual(agg.albums, ["Black Dominator", "Gold Dominator, Pt. 1", "Viking Gods"]);
    assert.deepEqual(agg.genres, ["Alternative", "Electro", "Rock"]);
    assert.deepEqual(agg.topTracks, ["Dragons Lair", "Blood Runs Wild"]);
    assert.equal(agg.previewUrls.length, 2);
  });

  it("fiche maigre détectée + fusion d'une 2e source", () => {
    const deezer = { source: "deezer", name: "Bob Dominator", genres: [], topTracks: [], previewUrls: [], albums: [] };
    assert.equal(isThinCatalog(deezer), true);
    const merged = mergeCatalogs(deezer, {
      source: "itunes",
      genres: ["Electronic"],
      topTracks: ["A", "B", "C"],
      previewUrls: ["https://x/1.m4a"],
      albums: ["Gold"],
    });
    assert.equal(isThinCatalog(merged), false);
    assert.equal(merged.source, "deezer");
    assert.deepEqual(merged.extraSources, ["itunes"]);
  });
});

describe("DNA de référence", () => {
  it("fusionne 2 écoutes (BPM médian, instruments unis)", () => {
    const dna = mergeAudioDna([
      { bpmEstimate: 126, energy: "high", timbre: "gritty baritone", vocalRegister: "unknown", instruments: ["guitars"] },
      { bpmEstimate: 130, energy: "high", timbre: "", vocalRegister: "baritone", instruments: ["synth arps", "guitars"] },
    ]);
    assert.equal(dna.bpmEstimate, 128);
    assert.equal(dna.vocalRegister, "baritone");
    assert.deepEqual(dna.instruments, ["guitars", "synth arps"]);
    assert.equal(dna.listens, 2);
  });

  it("petit artiste → pas de « in the style of <nom> », avertissement si deviné", () => {
    assert.equal(isLesserKnownArtist({ followers: 3728 }), true);
    assert.equal(isLesserKnownArtist({ followers: 2_000_000 }), false);
    assert.equal(styleDnaSource({ audioListened: false, thin: true }), "name-only");
    const w = styleLockWarnings({ dnaSource: "name-only", lesserKnown: true, name: "Bob Dominator" });
    assert.match(w[0], /Bob Dominator/);
    assert.deepEqual(styleLockWarnings({ dnaSource: "audio", lesserKnown: true }), []);
  });
});

describe("timbre dans le style musical", () => {
  it("bout de caption timbre sans mots risqués", () => {
    assert.equal(
      vocalTimbreStyleBit({ styleLock: VIKING_LOCK }),
      "deep gritty baritone, chant-like voice timbre",
    );
    assert.equal(
      vocalTimbreStyleBit({ styleLock: { timbre: "warm, conversational", vocalRegister: "tenor" } }),
      "warm tenor voice timbre",
    );
    assert.equal(vocalTimbreStyleBit({}), "");
  });

  it("ACE solo : le timbre du lock part dans le style", () => {
    const body = buildAceStepBody({
      title: "Runes",
      style: "electro rock",
      lyrics: "[Verse]\nRunes on the bass",
      language: "en",
      modelId: "acestep-v15-xl-turbo",
      styleLock: VIKING_LOCK,
      artist: { name: "X", gender: "male", genre: "Nordic electro-rock", styleLock: VIKING_LOCK },
    });
    assert.match(body.style, /gritty baritone/i);
  });
});

describe("clone d'un artiste Sonozz", () => {
  const source = {
    slug: "bob-src",
    name: "Bob Src",
    gender: "male",
    language: "en",
    genre: "Nordic electro-rock",
    genres: ["Electro", "Rock"],
    voice: "deep gritty baritone chants",
    writingVoice: "short war-cry lines, Norse imagery",
    musicArrange: { leadInstrument: "electric guitar", drums: "live kit", bpm: 128 },
    styleLock: VIKING_LOCK,
    voiceSample: { s3Key: "audio/voice/bob/sample.wav", url: "https://s3/x.wav", songGenTimbre: "gritty baritone", analyzedTimbre: "deep gritty baritone" },
  };

  it("copie le son verbatim, jamais le fichier voix source", () => {
    const patch = buildCloneSoundPatch(source);
    assert.equal(patch.genre, source.genre);
    assert.deepEqual(patch.genres, source.genres);
    assert.equal(patch.language, "en");
    assert.equal(patch.gender, "male");
    assert.equal(patch.writingVoice, source.writingVoice);
    assert.deepEqual(patch.styleLock, VIKING_LOCK);
    assert.notEqual(patch.styleLock, VIKING_LOCK, "copie profonde");
    assert.equal(patch.styleFidelity, "strict");
    assert.equal(patch.cloneOf.slug, "bob-src");
    assert.equal(patch.voiceSample.songGenTimbre, "gritty baritone");
    assert.equal(patch.voiceSample.s3Key, undefined);
    assert.equal(patch.voiceSample.url, undefined);
    assert.equal(isStrictStyleFidelity(patch), true);
  });

  it("lock source réutilisé (pas de ré-résolution)", () => {
    const lock = styleLockFromSourceProfile(source);
    assert.equal(lock.timbre, VIKING_LOCK.timbre);
    assert.equal(lock.confidence, "cloned");
    assert.equal(lock.clonedFrom, "bob-src");
    assert.equal(styleLockFromSourceProfile({ name: "no lock" }), null);
  });
});

describe("variation sonore autour du DNA", () => {
  it("lane rock/electro : jamais sax / brush jazz / latin sur un album", () => {
    const leads = new Set();
    const drums = new Set();
    for (let i = 1; i <= 10; i++) {
      const v = applySonicVariation({
        styleLock: VIKING_LOCK,
        title: `Track ${i}`,
        artistKey: "bob",
        trackIndex: i,
        trackTotal: 10,
      });
      leads.add(v.musicArrange.leadInstrument);
      drums.add(v.musicArrange.drums);
      assert.ok(!(v.musicArrange.features || []).includes("gospel choir"));
    }
    for (const l of leads) assert.ok(!["saxophone", "trumpet", "brass section", "acoustic guitar"].includes(l), `lead hors lane: ${l}`);
    for (const d of drums) assert.ok(!["brush jazz", "latin percussion", "boom bap"].includes(d), `drums hors lane: ${d}`);
  });

  it("strict (clone) : BPM ±4, energy DNA, lead issu du lock", () => {
    const pools = lanePoolsForLock(VIKING_LOCK, { strict: true });
    for (let i = 1; i <= 8; i++) {
      const v = applySonicVariation({
        styleLock: VIKING_LOCK,
        title: `T${i}`,
        artistKey: "bob",
        trackIndex: i,
        trackTotal: 8,
        strict: true,
      });
      assert.ok(Math.abs(v.musicArrange.bpm - 128) <= 4, `bpm ${v.musicArrange.bpm}`);
      assert.equal(v.energy, "high");
      assert.ok(pools.leads.includes(v.musicArrange.leadInstrument), v.musicArrange.leadInstrument);
    }
  });

  it("non strict : ballade bornée à -10 BPM", () => {
    const v = applySonicVariation({ styleLock: VIKING_LOCK, role: "ballad", title: "x", artistKey: "b" });
    assert.ok(v.musicArrange.bpm >= 118);
  });
});

describe("brouillon artiste : références changées", () => {
  it("efface le DNA périmé quand la référence change (Eminem → SDM)", () => {
    const prev = {
      styleLock: {
        source: "deezer",
        sourceId: "13",
        matchedName: "Eminem",
        timbre: "raspy, aggressive tenor",
        bpm: 172,
        genreSummary: "early 2000s Eminem",
      },
    };
    const patch = buildArtistDraftPatch(
      { mode: "fiction", styleArtistPick: { source: "deezer", id: "999", name: "SDM" } },
      prev,
    );
    assert.equal(patch.styleLock.matchedName, "SDM");
    assert.equal(patch.styleLock.timbre, undefined);
    assert.equal(patch.styleLock.bpm, undefined);
  });

  it("garde le DNA si la référence est la même", () => {
    const prev = { styleLock: { source: "deezer", sourceId: "13", matchedName: "Eminem", timbre: "raspy" } };
    const patch = buildArtistDraftPatch(
      { mode: "fiction", styleArtistPick: { source: "deezer", id: 13, name: "Eminem" } },
      prev,
    );
    assert.equal(patch.styleLock.timbre, "raspy");
  });
});
