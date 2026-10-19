import {
  vocalLockForArtist,
  soloizeFeatVocalForDuo,
  contrastSameSexVocalHints,
  isGospelFeatLock,
  aceStepSameSexDuoNegatives,
  aceLeadVocalPhrase,
} from "./vocalLock.js";

/** Genre lead raccourci (évite « Afro-trap Électro-Oriental » × 4 dans le prompt). */
function shortGenre(raw, fallback = "hip hop") {
  const g = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!g) return fallback;
  const first = g.split(/[/×,+]| feat\.?/i)[0].trim();
  // Un seul libellé court (Afro-trap, Hip Hop, R&B…)
  const token = first.split(/\s+/).slice(0, 2).join(" ");
  if (token.length <= 18) return token || fallback;
  return first.split(/\s+/)[0].slice(0, 18) || fallback;
}

function shortBed(leadGenre) {
  const g = leadGenre.toLowerCase();
  if (/trap|drill|hip.?hop|rap|afro/.test(g)) return "808, trap drums, pads";
  if (/r&?b|soul/.test(g)) return "drums, bass, keys, pads";
  if (/gospel/.test(g)) return "drums, bass, piano, organ";
  if (/rock|metal/.test(g)) return "drums, bass, guitars";
  if (/indie|folk|pop|acoustic/.test(g)) return "guitar, bass, drums, keys";
  if (/electro|edm|synth|oriental/.test(g)) return "808, synths, drums, pads";
  return "drums, bass, keys, pads";
}

function firstWordsBed(x) {
  return String(x || "").replace(/\s+(and|with|for|on)\s+.*/i, "").split(/\s+/).slice(0, 3).join(" ");
}

/** Coupe à une frontière de mot / virgule. */
function cutWords(raw, max) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const at = Math.max(c.lastIndexOf(","), c.lastIndexOf(";"));
  const cut = at > max * 0.5 ? c.slice(0, at) : c.slice(0, c.lastIndexOf(" "));
  return cut.replace(/[,;:\s]+$/, "");
}

/** Assemble des phrases sans couper au milieu (plafond dure). */
function joinBudget(parts, max) {
  let out = "";
  for (const raw of parts) {
    const p = String(raw || "").trim();
    if (!p) continue;
    const next = out ? `${out}. ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

/**
 * Style ACE-Step duo — DURCI COURT (≤~380c, phrases entières).
 * Les pavés Sister Act / fusion / DNA → mur de bruit + troncature à 700.
 */
export function buildAceStepDuoStyle(lead, feat, { genreSummary, mood, styleLock, styleBase } = {}) {
  const a = vocalLockForArtist(lead);
  let b = vocalLockForArtist(feat);
  if (!a || !b) return "";
  b = soloizeFeatVocalForDuo(b);

  const contrast = contrastSameSexVocalHints(a, b);
  const lock = styleLock && typeof styleLock === "object" ? styleLock : null;
  const leadGenre = shortGenre(
    a.genre || lock?.genreSummary || genreSummary || styleBase,
    "hip hop",
  );
  const featGospel = isGospelFeatLock(b) || /gospel|soul|choir|church/i.test(`${b.genre || ""}`);
  const g1 = contrast.leadTag || a.genderCode || "lead";
  const g2 = contrast.featTag || b.genderCode || "feat";

  // Voix très courtes — les pavés « intelligible lyrics » mangent le budget.
  const leadVoice = featGospel
    ? `dry ${g1} rap`
    : (contrast.leadHint || aceLeadVocalPhrase(a, leadGenre) || "dry natural voice")
        .replace(/,?\s*intelligible lyrics/gi, "")
        .replace(/dry studio take/gi, "dry")
        .slice(0, 48);
  const featVoice = featGospel
    ? "gospel lead, choir on hooks only"
    : (contrast.featHint || aceLeadVocalPhrase(b, b.genre || leadGenre) || "dry natural voice")
        .replace(/,?\s*intelligible lyrics/gi, "")
        .replace(/dry studio take/gi, "dry")
        .slice(0, 48);

  // Artiste DUO (2 voix du même projet) : vrais timbres + instruments du DNA + interaction.
  const internalDuo = Boolean(lead?.duo && (feat?.duoMember || lead?.duoPartner));
  const lockInstr = Array.isArray(lock?.instruments) ? lock.instruments.slice(0, 4).join(", ") : "";
  const bed = featGospel
    ? `${shortBed(leadGenre)}; chorus organ+choir`
    : internalDuo && lockInstr
      ? cutWords(lock.instruments.slice(0, 4).map((x) => firstWordsBed(x)).join(", "), 72)
      : shortBed(leadGenre);
  const profiles = Array.isArray(lead?.vocalProfiles) ? lead.vocalProfiles : [];
  const firstWords = (x, n) => String(x || "").split(/[,;]/)[0].trim().split(/\s+/).slice(0, n).join(" ");
  const duoVoice = (lockArtist, idx) => {
    const p = profiles[idx];
    if (p) {
      return cutWords(
        [firstWords(p.range, 3), firstWords(p.texture, 3), firstWords(p.delivery, 4)].filter(Boolean).join(", "),
        62,
      );
    }
    const t = String(lockArtist?.timbreHint || "").trim();
    const d = String(lockArtist?.vocalStyle || "").trim();
    const txt = [t, d && !t.toLowerCase().includes(d.toLowerCase().slice(0, 12)) ? d : ""]
      .filter(Boolean)
      .join(", ")
      .replace(/conversational|spoken-?word|vocoder/gi, "")
      .replace(/\s*,\s*,/g, ",")
      .trim();
    return cutWords(txt, 62);
  };


  const leadVoiceFinal = internalDuo ? duoVoice(a, 0) || leadVoice : leadVoice;
  const featVoiceFinal = internalDuo ? duoVoice(b, 1) || featVoice : featVoice;
  const interaction = internalDuo
    ? (() => {
        const chorus = String(lead?.duoInteraction?.chorus || "");
        const sum = String(lead?.duoInteraction?.summary || lead?.styleLock?.duoVocals?.interaction || "").trim();
        if (sum && sum.length <= 70) return sum;
        if (chorus === "call-and-response") return "they trade lines, call-and-response hooks";
        if (chorus === "female" || chorus === "male") return `${chorus} voice carries the hook, other answers`;
        return sum ? cutWords(sum, 60) : "alternating verses, both voices on the hook";
      })()
    : "";

  const moodBit = String(mood || lock?.mood || a.mood || "")
    .trim()
    .slice(0, 20);

  const sameSexBit =
    contrast.sameSex && !featGospel
      ? `distinct voices; ${aceStepSameSexDuoNegatives()}`
      : null;

  // Duo interne : noms des MEMBRES (pas le nom du groupe) et les 2 voix AVANT la ligne d'arc
  // (sinon le budget 380c coupe singer 2).
  const name1 = internalDuo ? String(lead?.duoMembers?.[0]?.name || a.name) : a.name;
  const name2 = internalDuo ? String(feat?.name || lead?.duoMembers?.[1]?.name || b.name) : b.name;
  if (internalDuo) {
    const mustDuo = [
      `${leadGenre} male-female duo, ONE lane, clean mix`,
      `singer 1 ${name1} (${g1}): ${leadVoiceFinal}`,
      `singer 2 ${name2} (${g2}): ${featVoiceFinal}`,
      `band: ${bed}`,
      interaction ? `obey [singer 1]/[singer 2]: ${interaction}` : "obey [singer 1]/[singer 2]; voices clear",
      "layers change: verse sparse → chorus adds layers → densest final",
    ];
    return joinBudget([...mustDuo, moodBit], 380);
  }

  // Priorité : identité + band + singers + singers. Mood / sameSex optionnels.
  const must = [
    featGospel
      ? `${leadGenre} duet, gospel hooks, ONE clean song`
      : `${leadGenre} duet, ONE lane, full band, clean mix`,
    `band: ${bed}`,
    "instrument layers change: verse sparse → chorus adds layers → thin bridge → densest final",
    `singer 1 ${a.name} (${g1}): ${leadVoiceFinal}`,
    `singer 2 ${b.name} (${g2}): ${featVoiceFinal}`,
    featGospel
      ? "verses=singer1; chorus=singer2 gospel; no two songs glued"
      : "obey [singer 1]/[singer 2]; voices clear",
  ];
  const optional = [moodBit, sameSexBit];

  return joinBudget([...must, ...optional], 380);
}
