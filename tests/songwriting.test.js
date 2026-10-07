import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SONG_ANGLES,
  buildAntiRepeatBlock,
  buildBriefBlock,
  buildVoiceBlock,
  buildWritingRulesBlock,
  clicheScore,
  extractHookLine,
  findCliches,
  newsProbability,
  normalizeNewsMode,
  pickSongBrief,
  shouldUseNews,
} from "../src/lib/songwriting/index.js";
import { parseRssItems, isSafeNewsItem } from "../src/server/songwriting/news.js";
import { buildArtistDraftPatch, isUnchangedArtistDraft } from "../src/lib/artistDraft.js";

function seq(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("findCliches", () => {
  it("détecte les clichés FR insensible aux accents / majuscules", () => {
    const text = "[Verse]\nDans la nuit je BRÛLE\nMon cœur s'envole\n[Chorus]\nMon coeur, mon coeur\nLa Clio de ma mère";
    const hits = findCliches(text, "fr");
    const phrases = hits.map((h) => h.phrase);
    assert.ok(phrases.includes("dans la nuit"));
    assert.ok(phrases.includes("je brûle"));
    assert.equal(hits.find((h) => h.phrase === "mon cœur").count, 3);
    assert.ok(clicheScore(hits) >= 3);
  });

  it("ignore les tags et ne matche pas des sous-mots", () => {
    assert.deepEqual(findCliches("[Chorus]\nla flammekueche de Strasbourg", "fr"), []);
    assert.deepEqual(findCliches("le ticket de caisse froissé", "fr"), []);
  });

  it("EN + langue non couverte", () => {
    assert.ok(findCliches("We own the night, set me free", "en").length >= 2);
    assert.deepEqual(findCliches("corazón en la noche", "es"), []);
  });
});

describe("pickSongBrief", () => {
  it("évite les catégories des titres récents", () => {
    const recent = SONG_ANGLES.slice(0, 6).map((a) => ({ category: a.cat }));
    const blocked = new Set(recent.map((r) => r.category));
    for (let i = 0; i < 30; i++) {
      const b = pickSongBrief({ recent, rng: Math.random });
      assert.ok(!blocked.has(b.category), `catégorie récente réutilisée: ${b.category}`);
      assert.equal(b.anchors.length, 3);
      assert.ok(b.pov && b.tone && b.angle);
    }
  });

  it("exclut aussi les catégories déjà prises dans l’album", () => {
    const b = pickSongBrief({ excludeCategories: ["amour", "objet"], rng: seq([0, 0.5]) });
    assert.ok(!["amour", "objet"].includes(b.category));
  });

  it("ne répète pas le pov / ton des 2 derniers titres", () => {
    const recent = [{ pov: "je — confession directe", tone: "tendre" }];
    for (let i = 0; i < 20; i++) {
      const b = pickSongBrief({ recent });
      assert.notEqual(b.pov, recent[0].pov);
      assert.notEqual(b.tone, recent[0].tone);
    }
  });

  it("mode actu → angle actu + candidats dans le bloc prompt", () => {
    const b = pickSongBrief({ news: { candidates: [{ title: "Le gazole baisse", source: "Le Monde" }] }, rng: seq([0.3]) });
    assert.equal(b.category, "actu");
    const block = buildBriefBlock(b);
    assert.match(block, /Le gazole baisse/);
    assert.match(block, /AUCUN nom de personne réelle/);
    assert.match(block, /newsRef/);
  });
});

describe("news mode", () => {
  it("normalise les valeurs FR / EN", () => {
    assert.equal(normalizeNewsMode("jamais"), "never");
    assert.equal(normalizeNewsMode("Parfois"), "sometimes");
    assert.equal(normalizeNewsMode("often"), "often");
    assert.equal(normalizeNewsMode(undefined), "auto");
  });

  it("probabilités : jamais / souvent / auto selon la lane", () => {
    assert.equal(newsProbability({ newsMode: "never", genre: "rap" }), 0);
    assert.equal(newsProbability({ newsMode: "often" }), 0.6);
    assert.ok(newsProbability({ genre: "Rap français" }) > 0);
    assert.equal(newsProbability({ genre: "Dream pop" }), 0);
    assert.equal(shouldUseNews({ newsMode: "never" }, () => 0), false);
    assert.equal(shouldUseNews({ newsMode: "often" }, () => 0.1), true);
  });
});

describe("RSS actu", () => {
  it("parse RSS + CDATA, retire le suffixe média et « EN DIRECT »", () => {
    const xml = `<rss><channel><title>X</title>
      <item><title><![CDATA[EN DIRECT, Le prix du gazole baisse]]></title><pubDate>Wed, 07 Oct 2026</pubDate></item>
      <item><title>Les lycées bloqués à Nantes - Ouest-France</title><description>&lt;b&gt;blocus&lt;/b&gt;</description></item>
    </channel></rss>`;
    const items = parseRssItems(xml, "Test");
    assert.equal(items.length, 2);
    assert.equal(items[0].title, "Le prix du gazole baisse");
    assert.equal(items[1].title, "Les lycées bloqués à Nantes");
    assert.equal(items[1].summary, "blocus");
  });

  it("filtre les drames (garde-fou)", () => {
    assert.equal(isSafeNewsItem({ title: "Un homme tué à Lyon" }), false);
    assert.equal(isSafeNewsItem({ title: "Attaque terroriste" }), false);
    assert.equal(isSafeNewsItem({ title: "Concert de violon gratuit" }), true);
    assert.equal(isSafeNewsItem({ title: "Le gazole baisse de 15 centimes" }), true);
  });
});

describe("hooks / historique / blocs prompt", () => {
  it("extractHookLine prend la 1re ligne du refrain", () => {
    const text = "[Intro]\nyeah\n[Verse]\nligne 1\n[Hook]\nLa vitre descend plus\nbis\n[Outro]\nfin";
    assert.equal(extractHookLine(text), "La vitre descend plus");
    assert.equal(extractHookLine("[Verse]\nrien"), "");
  });

  it("buildAntiRepeatBlock liste titres / thèmes / hooks", () => {
    const block = buildAntiRepeatBlock([{ title: "Néon", theme: "la nuit en ville", hook: "on brûle" }]);
    assert.match(block, /« Néon »/);
    assert.match(block, /NE PAS refaire/);
    assert.equal(buildAntiRepeatBlock([]), "");
  });

  it("voix d’auteur + règles d’écriture", () => {
    const v = buildVoiceBlock({ city: "Marseille", writingVoice: "argot, humour noir", avoidTopics: "drogue" });
    assert.match(v, /Marseille/);
    assert.match(v, /humour noir/);
    assert.match(v, /NE JAMAIS traiter: drogue/);
    assert.match(v, /pas DE QUOI parle/);
    assert.match(buildWritingRulesBlock("fr"), /dans la nuit/);
    assert.match(buildWritingRulesBlock("en"), /my heart/);
  });
});

describe("artistDraft — champs d’écriture", () => {
  it("passe les champs fournis et détecte les changements", () => {
    const patch = buildArtistDraftPatch({ name: "X", writingVoice: " sec ", newsMode: "bogus" }, {});
    assert.equal(patch.writingVoice, "sec");
    assert.equal(patch.newsMode, "auto");
    assert.equal(isUnchangedArtistDraft(patch, { name: "X", writingVoice: "sec" }), true);
    assert.equal(isUnchangedArtistDraft(patch, { name: "X", writingVoice: "autre" }), false);
    const legacy = buildArtistDraftPatch({ name: "X" }, {});
    assert.equal("writingVoice" in legacy, false);
  });
});

describe("album fallbackThemes", () => {
  it("catégories toutes distinctes, index / closer corrects", async () => {
    const { fallbackThemes } = await import("../src/server/album.js");
    const tracks = fallbackThemes({ artist: {}, count: 7, total: 8 });
    const cats = tracks.map((t) => t.brief.category);
    assert.equal(new Set(cats).size, cats.length);
    assert.equal(tracks[0].workingTitle, "Piste 2");
    assert.equal(tracks.at(-1).trackRole, "closer");
    const pad = fallbackThemes({ artist: {}, count: 2, excludeCategories: ["amour", "travail"], startIndex: 4 });
    assert.ok(pad.every((t) => !["amour", "travail"].includes(t.brief.category)));
    assert.equal(pad[0].workingTitle, "Piste 4");
  });
});
