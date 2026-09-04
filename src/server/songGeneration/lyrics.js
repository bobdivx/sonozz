/** MiniMax-style [Verse] / [Chorus] → sections SongGeneration Studio. */
export function lyricsToSections(lyricsText = "") {
  const text = String(lyricsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[prechorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .trim();

  if (!text) {
    return [
      { type: "verse", lyrics: "la la la" },
      { type: "chorus", lyrics: "oh oh oh" },
      { type: "verse", lyrics: "la la la" },
      { type: "chorus", lyrics: "oh oh oh" },
    ];
  }

  const tagRe = /\[([^\]]+)\]/g;
  const tags = [...text.matchAll(tagRe)];
  if (!tags.length) {
    return [
      { type: "verse", lyrics: formatLyricsForSongGen(text.slice(0, 800), { maxLines: 16, maxChars: 800 }) },
      { type: "chorus", lyrics: formatLyricsForSongGen(text.slice(0, 400), { maxLines: 8, maxChars: 400 }) },
    ];
  }

  const sections = [];
  for (let i = 0; i < tags.length; i++) {
    const rawType = String(tags[i][1] || "verse").trim().toLowerCase();
    const start = tags[i].index + tags[i][0].length;
    const end = i + 1 < tags.length ? tags[i + 1].index : text.length;
    const body = text.slice(start, end).trim();

    // intro-medium ≈ ~1 min de drone chez LeVo — short par défaut.
    // inst-medium = lit instrumental riche (sans le problème d’intro longue).
    let type = "verse";
    if (/^intro/.test(rawType)) {
      type = /medium|long/.test(rawType) ? "intro-medium" : "intro-short";
    } else if (/^outro/.test(rawType)) {
      type = /medium|long/.test(rawType) ? "outro-medium" : "outro-short";
    } else if (/^chorus|refrain/.test(rawType)) type = "chorus";
    else if (/^bridge|pont/.test(rawType)) type = "bridge";
    else if (/^pre\s*chorus|prechorus/.test(rawType)) type = "prechorus";
    else if (/^instrumental|inst|solo/.test(rawType)) {
      type = /short/.test(rawType) ? "inst-short" : "inst-medium";
    } else if (/^verse|couplet/.test(rawType)) type = "verse";

    const vocal = ["verse", "chorus", "bridge", "prechorus"].includes(type);
    const lyrics =
      vocal && body ? formatLyricsForSongGen(body, { maxLines: 24, maxChars: 1400 }) : null;

    // Intro/outro instrumentales vides → drone / sifflement : on les ignore.
    if (/^intro|^outro/.test(type) && !lyrics) continue;

    sections.push({
      type,
      lyrics,
    });
  }

  return sections.length ? sections : [{ type: "verse", lyrics: formatLyricsForSongGen(text, { maxLines: 16, maxChars: 800 }) }];
}

/**
 * LeVo (SongGen) joint les lignes par « . » et strippe la ponctuation.
 * On n’envoie que des lignes COMPLÈTES (un slice mid-mot = charabia).
 * Apostrophes FR → espace, sinon Studio les enlève (« c'est » → « cest »).
 */
export function formatLyricsForSongGen(raw, { maxLines = 8, maxChars = 360 } = {}) {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\[[^\]]+\]\s*/g, "")
        .replace(/['’‘‛]/g, " ")
        .replace(/[«»""„]/g, "")
        .replace(/[,;:!?…]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length >= 2);

  const out = [];
  let chars = 0;
  for (const line of lines) {
    if (out.length >= maxLines) break;
    if (out.length >= 2 && chars + line.length > maxChars) break;
    out.push(line);
    chars += line.length + 1;
  }
  return out.join("\n");
}

/**
 * Extrait SongGen : couplet court + refrain (sans intro).
 * Un refrain seul (~10s) sort souvent vocoder a cappella chez LeVo.
 */
export function lyricsToPreviewSections(lyricsText = "") {
  const full = lyricsToSections(lyricsText);
  const chorus = full.find((s) => s.type === "chorus" && String(s.lyrics || "").trim());
  const verse = full.find((s) => s.type === "verse" && String(s.lyrics || "").trim());
  const out = [];
  if (verse?.lyrics) {
    const v = formatLyricsForSongGen(verse.lyrics, { maxLines: 4, maxChars: 180 });
    if (v) out.push({ type: "verse", lyrics: v });
  }
  const hook = formatLyricsForSongGen((chorus || verse)?.lyrics || lyricsText, {
    maxLines: 6,
    maxChars: 240,
  });
  out.push({ type: "chorus", lyrics: hook || "oh oh oh" });
  return out;
}
