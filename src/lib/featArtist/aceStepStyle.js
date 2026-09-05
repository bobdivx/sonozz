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

  const bed = featGospel
    ? `${shortBed(leadGenre)}; chorus + organ/choir`
    : shortBed(leadGenre);

  const moodBit = String(mood || lock?.mood || a.mood || "")
    .trim()
    .slice(0, 20);

  const sameSexBit =
    contrast.sameSex && !featGospel
      ? `distinct voices; ${aceStepSameSexDuoNegatives()}`
      : null;

  // Priorité : identité + band + singers + singers. Mood / sameSex optionnels.
  const must = [
    featGospel
      ? `${leadGenre} duet, gospel hooks, ONE clean song`
      : `${leadGenre} duet, ONE lane, full band, clean mix`,
    `band: ${bed}`,
    "verse lean → thicker chorus → thin bridge → big final chorus",
    `singer 1 ${a.name} (${g1}): ${leadVoice}`,
    `singer 2 ${b.name} (${g2}): ${featVoice}`,
    featGospel
      ? "verses=singer1; chorus=singer2 gospel; no two songs glued"
      : "obey [singer 1]/[singer 2]; voices clear",
  ];
  const optional = [moodBit, sameSexBit];

  return joinBudget([...must, ...optional], 380);
}
