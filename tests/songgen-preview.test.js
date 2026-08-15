import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatLyricsForSongGen,
  lyricsToPreviewSections,
  lyricsToSections,
} from "../src/server/songGeneration.js";

const SAMPLE = `[Verse]
L'asphalte chauffe, la ville s'enflamme
Les corps se lâchent, c'est plus qu'une trame

[Chorus]
Viens, danse avec moi, sous la lune ou le soleil
Chaque mouvement est une étincelle, un réveil
La musique nous guide, nos corps se répondent
`;

describe("SongGen lyrics / preview", () => {
  it("extrait = couplet court + chorus, sans intro", () => {
    const sections = lyricsToPreviewSections(SAMPLE);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].type, "verse");
    assert.equal(sections[1].type, "chorus");
    assert.match(sections[1].lyrics, /Viens danse avec moi/);
    assert.match(sections[0].lyrics, /asphalte/i);
  });

  it("ne coupe pas au milieu d’une ligne", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Une ligne complete numero ${i + 1} du refrain`).join(
      "\n",
    );
    const text = formatLyricsForSongGen(long, { maxLines: 4, maxChars: 80 });
    const lines = text.split("\n");
    assert.ok(lines.length <= 4);
    for (const line of lines) {
      assert.match(line, /Une ligne complete numero/);
    }
  });

  it("assouplit les apostrophes françaises", () => {
    const text = formatLyricsForSongGen("c'est l'heure\nl’asphalte chauffe");
    assert.match(text, /c est l heure/);
    assert.match(text, /l asphalte chauffe/);
  });

  it("n’injecte plus d’intro automatique sur un titre complet", () => {
    const sections = lyricsToSections(SAMPLE);
    assert.equal(sections[0].type, "verse");
    assert.ok(!sections.some((s) => /^intro/.test(s.type)));
    assert.ok(!sections.some((s) => /^outro/.test(s.type)));
    assert.ok(sections.some((s) => s.type === "chorus"));
  });
});
