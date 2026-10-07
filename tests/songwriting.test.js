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
import {
  analyzeLyricsDefects,
  endRhymeRatio,
  findFillerTags,
  isStageDirectionLine,
  rhymeEnding,
  stripStageDirections,
  wordCount,
} from "../src/lib/songwriting/defects.js";
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

// Extrait type du titre ZAHRA (défauts remontés par Mathieu) vs version « propre ».
const BAD_ZAHRA = "[Intro]\nLe beat monte, oriental, électrique, une mélodie qui me rappelle les mariages de ma tante\n[Verse]\nJe marchais dans la rue de Belleville avec mon frère et on parlait de tout ce qui nous était arrivé depuis que notre père était parti au bled tu vois ?\nZAHRA ne pleure pas, tu sais ?\nÇa vient du cœur, je te le jure\nTourne, tourne\n[Hook]\nLe temps s'est emballé et je ne sais plus où je vais ni qui je suis vraiment\nTourne tourne\nTourne tourne\nTourne tourne\nEt encore\n[Verse]\nComme si j'étais seule\nVoyager sans bouger hein ?\n[Outro]\nLe beat s'arrête. Silence. Presque.\nSilence.";
const GOOD_RAP = "[Intro]\n(Yeah, ZAHRA)\n[Verse]\nLa Clio de ma mère a la vitre qui descend plus\nOn roule fenêtre fermée, la clim on l'a jamais eue\nSur le parking d'Auchan elle compte ses tickets\nMoi je compte les lampadaires, elle compte les billets\nSamir passe en scooter, il klaxonne deux fois\nIl doit trois cents balles à tout le quartier, pas à moi\nLe dimanche on mange des msemen sur le capot\nEt ma mère rit fort quand la radio passe du Rai trop\n[Hook]\nLa vitre descend plus\nOn chante plus fort\nLa vitre descend plus\nPersonne entend dehors\n[Verse]\nEn deux mille neuf elle l'a payée cash au garage\nLe vendeur l'appelait madame avec un drôle de visage\nAujourd'hui le compteur affiche deux cent mille\nElle dit que c'est pas des kilomètres, c'est des années d'exil\nJe passe le permis jeudi, elle prie pour le créneau\nElle connaît pas les panneaux mais elle connaît les mots\nSi je l'ai je l'emmène voir la mer à Sète\nAvec la vitre en bas, coincée par une allumette\n[Outro]\n(La vitre descend plus)";

describe("clichés ajoutés (retours ZAHRA)", () => {
  it("détecte les nouveaux clichés FR + le temps personnifié", () => {
    const phrases = findCliches("Ça vient du cœur\nTourne, tourne\nLe temps est une salope\nComme si j'étais là\nVoyager sans bouger", "fr").map((h) => h.phrase);
    for (const p of ["ça vient du cœur", "tourne, tourne", "comme si j'étais", "voyager sans bouger"]) assert.ok(phrases.includes(p), p);
    assert.ok(phrases.some((p) => p.startsWith("le temps personnifié")));
  });

  it("équivalents EN", () => {
    const phrases = findCliches("Round and round, straight from the heart, time is a thief", "en").map((h) => h.phrase);
    assert.ok(phrases.includes("round and round"));
    assert.ok(phrases.includes("straight from the heart"));
    assert.ok(phrases.some((p) => p.startsWith("personified time")));
  });

  it("l’apostrophe compte comme lettre (« l'a jamais » ≠ « à jamais »)", () => {
    assert.deepEqual(findCliches("la clim on l'a jamais eue", "fr"), []);
  });
});

describe("didascalies (beat / instru / silence)", () => {
  it("repère les lignes de mise en scène", () => {
    assert.ok(isStageDirectionLine("Le beat monte, oriental, électrique, une mélodie qui me rappelle..."));
    assert.ok(isStageDirectionLine("Le beat s'arrête. Silence. Presque."));
    assert.ok(isStageDirectionLine("Silence."));
    assert.ok(isStageDirectionLine("La musique s'arrête"));
    assert.ok(isStageDirectionLine("*les violons entrent doucement*"));
    assert.ok(isStageDirectionLine("The beat drops"));
  });

  it("laisse passer les vraies paroles et les ad-libs", () => {
    assert.equal(isStageDirectionLine("Ma mère compte les billets sur le capot"), false);
    assert.equal(isStageDirectionLine("(La vitre descend plus)"), false);
    assert.equal(isStageDirectionLine("(yeah)"), false);
    assert.equal(isStageDirectionLine("My heart beats like a broken clock"), false);
  });

  it("post-filtre stripStageDirections", () => {
    const { text, removed } = stripStageDirections("[Intro]\nLe beat monte\n[Verse]\nligne vraie\n[Outro]\nSilence. Presque.");
    assert.equal(removed, 2);
    assert.equal(text, "[Intro]\n[Verse]\nligne vraie\n[Outro]");
  });
});

describe("tics de remplissage", () => {
  it("compte « tu vois ? », « je te le jure »… (fin de phrase / n’importe où)", () => {
    const f = findFillerTags("[Verse]\nOn part demain, tu vois ?\nJ'ai payé, je te le jure\nTu vois la mer d'ici\nC'est fini, hein ?", "fr");
    const total = f.reduce((s, x) => s + x.count, 0);
    assert.equal(total, 3); // « Tu vois la mer » n’est pas un tic
  });

  it("EN : you know / I swear / right?", () => {
    const f = findFillerTags("[Verse]\nWe drove all night, you know\nI swear I paid\nIt's late, right?\nRight now we leave", "en");
    assert.equal(f.reduce((s, x) => s + x.count, 0), 3);
  });

  it("1 tic toléré, au-delà = défaut", () => {
    const one = analyzeLyricsDefects("[Verse]\nOn part demain, tu vois ?\n", { lang: "fr", form: "radio_pop" });
    assert.ok(!one.reasons.some((r) => r.startsWith("tics")));
    const two = analyzeLyricsDefects("[Verse]\nOn part demain, tu vois ?\nC'est fini, hein ?", { lang: "fr", form: "radio_pop" });
    assert.ok(two.reasons.some((r) => r.startsWith("tics")));
  });
});

describe("métrique / rimes / refrain / nom", () => {
  it("wordCount ignore les ad-libs", () => {
    assert.equal(wordCount("On roule fenêtre fermée (yeah yeah)"), 4);
  });

  it("fins phonétiques FR approximatives", () => {
    assert.equal(rhymeEnding("tickets").key, rhymeEnding("billets").key);
    assert.equal(rhymeEnding("créneau").key, rhymeEnding("mots").key);
    assert.equal(rhymeEnding("garage").key, rhymeEnding("visage").key);
    assert.equal(rhymeEnding("temps").key, rhymeEnding("moment").key);
  });

  it("taux de rimes : couplet rimé vs prose", () => {
    assert.ok(endRhymeRatio(["Sur le parking elle compte ses tickets", "Moi je compte les lampadaires, elle les billets", "Samir klaxonne deux fois", "Il doit de l'argent à tout le monde sauf à moi"], "fr") >= 0.75);
    assert.ok(endRhymeRatio(["Je marchais dans la rue avec mon cousin", "On parlait de notre enfance au village", "Il faisait chaud ce jour-là", "Le bus était en retard comme toujours"], "fr") < 0.4);
  });

  it("extrait ZAHRA : tous les défauts remontent et déclenchent la réécriture", () => {
    const r = analyzeLyricsDefects(BAD_ZAHRA, { lang: "fr", form: "rap_trap", artistNames: ["ZAHRA"] });
    assert.ok(r.score >= 3);
    const all = r.reasons.join("\n");
    for (const re of [/clichés/, /tics de remplissage/, /didascalies/, /trop longues/, /rimes/, /refrain pas assez punchy/, /se nomme/]) {
      assert.match(all, re);
    }
    assert.equal(r.stageLines.length, 3);
    assert.ok(r.longLines.some((l) => l.words >= 20));
  });

  it("version propre : score 0 (signature ad-lib rap tolérée une fois)", () => {
    const r = analyzeLyricsDefects(GOOD_RAP, { lang: "fr", form: "rap_trap", artistNames: ["ZAHRA"] });
    assert.equal(r.score, 0, r.reasons.join("\n"));
  });

  it("nom de l’artiste : interdit hors rap, et hors parenthèses", () => {
    const pop = analyzeLyricsDefects("[Verse]\n(Zahra)\nOn danse au marché", { lang: "fr", form: "radio_pop", artistNames: ["Zahra"] });
    assert.ok(pop.reasons.some((r) => r.includes("se nomme")));
    const rap = analyzeLyricsDefects("[Verse]\nZahra dans la place", { lang: "fr", form: "rap_trap", artistNames: ["Zahra"] });
    assert.ok(rap.reasons.some((r) => r.includes("se nomme")));
  });

  it("refrain trop long → défaut", () => {
    const r = analyzeLyricsDefects("[Chorus]\nUne ligne de refrain beaucoup trop longue pour être chantée en chœur par tout le monde\nb\nc\nd\ne", { lang: "fr", form: "radio_pop" });
    assert.equal(r.hookIssues.length, 2);
  });

  it("règles d’écriture : métrique par genre, didascalies, tics, nom", () => {
    const rap = buildWritingRulesBlock("fr", { form: "rap_trap", artistName: "ZAHRA" });
    assert.match(rap, /8 ou 16 mesures/);
    assert.match(rap, /JAMAIS plus de 14 mots/);
    assert.match(rap, /didascalie/);
    assert.match(rap, /1 fois MAXIMUM/);
    assert.match(rap, /« ZAHRA » n’apparaît pas/);
    assert.match(buildWritingRulesBlock("fr", { form: "radio_pop" }), /JAMAIS plus de 10 mots/);
  });
});
