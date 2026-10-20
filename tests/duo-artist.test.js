import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVocalists,
  mergeDuoVocals,
  duoChorusMode,
  vocalistTimbreLine,
  applyDuoToProfile,
  withDuoPartner,
  isDuoArtist,
} from "../src/lib/duoVocals.js";
import { buildCloneSoundPatch } from "../src/lib/styleFidelity.js";
import { buildAceStepDuoStyle } from "../src/lib/featArtist/aceStepStyle.js";
import { ensureAceStepDuoSingerTags, prepareAceStepLyrics } from "../src/lib/featArtist/aceStepLyrics.js";
import { duoLyricsInstruction } from "../src/lib/featArtist/duoLyrics.js";
import { normalizeFeatArtist, displayArtistCredit } from "../src/lib/featArtist/index.js";

const HEARD = [
  {
    vocalists: [
      { gender: "female", range: "mezzo, strong chest belt", texture: "bright, slightly raspy", delivery: "powerful sung lead", effects: "plate reverb", share: "lead" },
      { gender: "male", range: "baritone", texture: "gritty", delivery: "shouted chant", effects: "double-tracked", share: "co-lead" },
    ],
    vocalInteraction: "female sings verses, male shouts the pre-chorus, both harmonise the chorus",
  },
  {
    vocalists: [{ gender: "female", range: "mezzo", texture: "bright", delivery: "sung", share: "lead" }],
  },
];

const LOCK = {
  genreSummary: "Nordic electro-rock",
  genres: ["Electro", "Rock"],
  instruments: ["distorted guitars", "analog synths", "war drums"],
  mood: "epic",
  bpm: 128,
};

describe("duo : écoute", () => {
  it("détecte femme + homme et garde la description la plus riche", () => {
    const dv = mergeDuoVocals(HEARD);
    assert.ok(dv);
    assert.equal(dv.female.range, "mezzo, strong chest belt");
    assert.equal(dv.male.delivery, "shouted chant");
    assert.equal(dv.female.heardIn, 2);
    assert.equal(dv.chorus, "both");
    assert.match(dv.interaction, /pre-chorus/);
  });

  it("pas de duo si une seule voix (ou chœur en backing)", () => {
    assert.equal(mergeDuoVocals([HEARD[1]]), null);
    assert.equal(
      mergeDuoVocals([{ vocalists: [{ gender: "female", share: "lead" }, { gender: "male", share: "backing" }] }]),
      null,
    );
  });

  it("modes de refrain", () => {
    assert.equal(duoChorusMode("call-and-response between them"), "call-and-response");
    assert.equal(duoChorusMode("both harmonise the chorus"), "both");
    assert.equal(duoChorusMode("female sings the chorus alone"), "female");
    assert.equal(normalizeVocalists([{ gender: "x" }])[0].gender, "unknown");
    assert.equal(vocalistTimbreLine({ range: "baritone", texture: "gritty", delivery: "shouted chant" }), "baritone, gritty, shouted chant");
  });
});

describe("duo : profil + génération", () => {
  const base = { name: "Frostbloom", slug: "frostbloom", genre: "Nordic electro-rock", language: "en", styleLock: LOCK };
  const duo = applyDuoToProfile(base, {
    duoVocals: mergeDuoVocals(HEARD),
    members: [{ name: "Liv Ash", gender: "female" }, { name: "Ragn Holt", gender: "male" }],
  });

  it("profil duo : deux profils vocaux, partenaire singer 2", () => {
    assert.equal(duo.duo, true);
    assert.equal(duo.gender, "female");
    assert.equal(duo.vocalProfiles.length, 2);
    assert.equal(duo.duoPartner.name, "Ragn Holt");
    assert.equal(duo.duoPartner.gender, "male");
    assert.match(duo.duoPartner.styleLock.timbre, /gritty/);
    assert.match(duo.styleLock.timbre, /mezzo/);
    assert.equal(isDuoArtist(duo), true);
  });

  it("génère toujours avec les deux voix, sans crédit « feat. »", () => {
    const withFeat = withDuoPartner({ ...duo, featArtist: null });
    const feat = normalizeFeatArtist(withFeat.featArtist);
    assert.equal(feat.name, "Ragn Holt");
    assert.equal(feat.duoMember, true);
    assert.equal(displayArtistCredit(duo, feat), "Frostbloom");
    // feat explicite choisi par l'utilisateur : respecté
    const other = withDuoPartner({ ...duo, featArtist: { name: "Guest", gender: "male" } });
    assert.equal(other.featArtist.name, "Guest");
  });

  it("style ACE : Studio tags — raspy male + female + instruments DNA", () => {
    const feat = normalizeFeatArtist(withDuoPartner(duo).featArtist);
    const style = buildAceStepDuoStyle(duo, feat, { styleLock: duo.styleLock });
    assert.match(style, /high-pitched male (tenor|baritone), raspy distorted shouted vocals, gravelly belting/i);
    assert.match(style, /powerful husky female vocal/i);
    assert.match(style, /^dark folk metal, electronic/i);
    assert.match(style, /heavy drums, deep sub bass, taiko war drums, oriental strings, epic choir, no guitars/i);
    assert.doesNotMatch(style, /distorted guitars/i);
    assert.doesNotMatch(style, /dubstep|wobble/i);
    assert.doesNotMatch(style, /singer 1 Liv Ash/i);
    assert.ok(style.length <= 380, `trop long ${style.length}`);
  });

  it("paroles : tags [singer 1: female]/[singer 2: male], refrain à deux", () => {
    const feat = normalizeFeatArtist(withDuoPartner(duo).featArtist);
    const out = ensureAceStepDuoSingerTags(
      "[Verse]\nIce on the oar\n[Chorus]\nRaise the fire\nRaise the fire\n[Verse]\nIron and salt",
      duo,
      feat,
    );
    assert.match(out, /\[Verse\]\n\[singer 1: female\]/);
    assert.match(out, /\[Chorus\]\n\[singer 1: female\]\n\[singer 2: male\]/);
    assert.match(out, /\[Verse\]\n\[singer 2: male\]\nIron/);
    const block = duoLyricsInstruction(duo, feat);
    assert.match(block, /UN groupe/);
    assert.match(block, /ENSEMBLE/);
  });

  it("refrain question-réponse si l'interaction le dit", () => {
    const cr = { ...duo, duoInteraction: { summary: "call-and-response", chorus: "call-and-response" } };
    const feat = normalizeFeatArtist(withDuoPartner(cr).featArtist);
    const out = ensureAceStepDuoSingerTags("[Chorus]\nRaise the fire\nHold the line", cr, feat);
    assert.match(out, /\[singer 1: female\]\nRaise the fire\n\[singer 2: male\]\nHold the line/);
  });

  it("clone : copie les deux profils vocaux", () => {
    const patch = buildCloneSoundPatch(duo);
    assert.equal(patch.duo, true);
    assert.equal(patch.vocalProfiles.length, 2);
    assert.equal(patch.duoPartner.name, "Ragn Holt");
    assert.deepEqual(patch.duoInteraction, duo.duoInteraction);
  });
});

describe("duo : régression Salt on the Rails", () => {
  const artist = applyDuoToProfile(
    {
      name: "Skarlvind",
      genre: "Electro-pop dance, viking-themed, dubstep-tinged drops",
      language: "en",
      styleLock: {
        ...LOCK,
        genreSummary: "Electro-pop dance, viking-themed, dubstep-tinged drops",
        genres: ["Electro", "Alternative", "Rock"],
      },
    },
    {
      duoVocals: mergeDuoVocals(HEARD),
      members: [
        { name: "Ylva Brann", gender: "female" },
        { name: "Torvik Hale", gender: "male" },
      ],
    },
  );
  artist.duoInteraction = { summary: "call-and-response", chorus: "call-and-response" };

  it("prepareAceStepLyrics GARDE les tags singer déjà présents (EDM Build/Drop)", () => {
    const raw = `[Build]\n[singer 1: female]\nGray skies\n[singer 2: male]\nForty kroner\n[Drop]\n[singer 1: female]\nWe're the future\n[singer 2: male]\nFuture!`;
    const feat = normalizeFeatArtist(withDuoPartner(artist).featArtist);
    const out = prepareAceStepLyrics(raw, artist, feat);
    assert.match(out, /\[singer 1: female\]/);
    assert.match(out, /\[singer 2: male\]/);
    assert.match(out, /Gray skies/);
  });

  it("sans tags préexistants, EDM Build/Drop n'envoie PAS tout sur singer 2", () => {
    const raw = `[Intro]\nOh\n[Build]\nLine a\n[Drop]\nHook one\nHook two\n[Break]\nBreath\n[Build]\nLine b\n[Drop]\nHook again\n[Outro]\nEnd`;
    const feat = normalizeFeatArtist(withDuoPartner(artist).featArtist);
    const out = ensureAceStepDuoSingerTags(raw, artist, feat);
    assert.match(out, /\[Build\]\n\[singer 1: female\]\nLine a/);
    assert.match(out, /\[Drop\]\n\[singer 1: female\]\nHook one\n\[singer 2: male\]\nHook two/);
    assert.match(out, /\[Break\]\n\[singer 2: male\]/);
    assert.match(out, /\[Drop\]\n\[singer 1: female\]\nHook again/);
    assert.doesNotMatch(out, /\[Build\]\n\[Drop\]/); // jamais une section sans singer
  });

  it("caption ACE duo : male+female, PAS woman rapper / hip-hop (fuite « rap verses » Suno)", async () => {
    const { assembleAceStepStyle } = await import("../src/server/aceStep/body.js");
    const { resolveAceStepStyleCaption } = await import("../src/server/aceStep/styleCaption.js");
    const { isRapLane, styleLockGenreBlob } = await import("../src/lib/musicLane.js");
    const sunoLeak =
      "Style: Electro-pop. genre fusion is OK (e.g. rap verses + gospel featured hooks). lead vocalist Skarlvind";
    assert.equal(
      isRapLane(styleLockGenreBlob(artist.styleLock, [sunoLeak])),
      true,
      "précondition : le pavé Suno faisait basculer isRapLane",
    );
    assert.equal(
      isRapLane(styleLockGenreBlob(artist.styleLock, [artist.genre])),
      false,
    );
    const feat = normalizeFeatArtist(withDuoPartner(artist).featArtist);
    const assembled = assembleAceStepStyle({
      style: artist.genre,
      language: "en",
      styleLock: artist.styleLock,
      artist: withDuoPartner(artist),
      featArtist: feat,
    });
    assert.equal(assembled.brief.rap, false);
    const cap = await resolveAceStepStyleCaption(
      {},
      {
        style: artist.genre,
        language: "en",
        styleLock: artist.styleLock,
        artist: withDuoPartner(artist),
        featArtist: feat,
      },
    );
    assert.equal(cap.source, "skeleton");
    assert.match(cap.style, /male and female vocal duet/i);
    // Studio short caption (tests ACE r4) : dark folk metal + male rauque, PAS de dubstep.
    assert.match(cap.style, /high-pitched male (tenor|baritone), raspy distorted shouted vocals, gravelly belting/i);
    assert.match(cap.style, /dark folk metal, electronic/i);
    assert.match(cap.style, /no guitars/i);
    assert.doesNotMatch(cap.style, /dubstep|wobble/i);
    assert.doesNotMatch(cap.style, /woman rapper|hip-?hop\/rap|lead rap vocal/i);
    assert.doesNotMatch(cap.style, /female lead and male co-lead/i);
    assert.doesNotMatch(cap.style, /warm guitar/i);
  });

  it("genre electro pur (sans rock/folk/viking) : pas de bed metal", () => {
    const lock = { ...artist.styleLock, genreSummary: "electro-pop", genres: ["Electro"], instruments: ["analog synths"] };
    const lead = { ...artist, genre: "electro-pop", styleLock: lock };
    const feat = normalizeFeatArtist(withDuoPartner(lead).featArtist);
    const style = buildAceStepDuoStyle(lead, feat, { styleLock: lock });
    assert.match(style, /^electro-pop/i);
    assert.doesNotMatch(style, /folk metal|distorted guitars/i);
  });
});

describe("répliques duo « (…) » (prod 20/10 Ghost of the Jetty : voix d'homme supprimée)", () => {
  it("garde les répliques courtes, les donne à l'autre voix et rétablit la voix courante", async () => {
    const { prepareAceStepLyrics, ensureAceStepDuoSingerTags, assignDuoRetorts, normalizeFeatArtist, isDuoRetortLine } = await import("../src/lib/featArtist.js");
    const lead = { name: "Skarlvind", gender: "female", duo: true, duoInteraction: { chorus: "female" } };
    const feat = normalizeFeatArtist({ name: "Torvik Hale", gender: "male" });
    const raw = "[Verse - female vocal]\nOld planks smell wet\n(Never the same!)\nDad's toolbox\n\n[Bridge]\nThis harbor\n(Long since rotten!)\n(Sound of waves crashing on the shore)";
    let t = prepareAceStepLyrics(raw, lead, feat);
    t = assignDuoRetorts(ensureAceStepDuoSingerTags(t, lead, feat));
    assert.match(t, /Old planks smell wet\n\[singer 2: male\]\nNever the same!\n\[singer 1: female\]\nDad's toolbox/);
    assert.match(t, /\[singer 2: male\]\nThis harbor\n\[singer 1: female\]\nLong since rotten!/);
    assert.ok(!/Sound of waves/.test(t));
    assert.equal(isDuoRetortLine("(Skarlvind)"), true); // nom seul : traité comme cue avant (prepare)
    assert.equal(isDuoRetortLine("(beat drops)"), false);
    assert.equal(isDuoRetortLine("(a very long stage direction about the whole band playing)"), false);
  });
});
