import { isMetalLane } from "../musicLane.js";

/** Styles musicaux proposés à la création d'artiste (valeur = hint IA). */
export const MUSIC_STYLES = [
  { value: "", label: "Au choix de l'IA" },
  { value: "Pop contemporaine", label: "Pop" },
  { value: "Pop urbaine / Melodic", label: "Pop urbaine" },
  { value: "Rap / Drill francophone", label: "Rap / Drill" },
  { value: "Trap / Cloud rap", label: "Trap" },
  { value: "Hip-hop old school / Boom bap", label: "Boom bap" },
  { value: "R&B / Soul moderne", label: "R&B / Soul" },
  { value: "Neo-soul / Quiet storm", label: "Neo-soul" },
  { value: "Électro / Hyperpop", label: "Électro" },
  { value: "House / Dance", label: "House" },
  { value: "Techno / Underground", label: "Techno" },
  { value: "EDM / Festival", label: "EDM" },
  { value: "Afrobeats / Afro-pop", label: "Afro" },
  { value: "Amapiano / Afro-house", label: "Amapiano" },
  { value: "Indie / Alternative", label: "Indie" },
  { value: "Variété / Chanson", label: "Chanson" },
  { value: "Folk / Acoustique", label: "Folk" },
  { value: "Latin / Reggaeton", label: "Latin" },
  { value: "Dancehall / Reggae", label: "Dancehall" },
  { value: "Rock / Indie rock", label: "Rock" },
  { value: "Metal / Hard rock", label: "Metal" },
  { value: "Death Metal / Brutal", label: "Death metal" },
  { value: "Punk / Garage", label: "Punk" },
  { value: "Jazz / Nu-jazz", label: "Jazz" },
  { value: "Blues / Roots", label: "Blues" },
  { value: "Funk / Disco", label: "Funk" },
  { value: "Gospel / Inspirational", label: "Gospel" },
  { value: "K-pop / J-pop", label: "K-pop" },
  { value: "Lo-fi / Chill", label: "Lo-fi" },
  { value: "Synthwave / Retrowave", label: "Synthwave" },
  { value: "Country / Americana", label: "Country" },
  { value: "World / Fusion", label: "World" },
];

/**
 * Mappe un genre catalogue (ex. "Alternative", "Hip-Hop") vers une entrée MUSIC_STYLES.
 * @returns {{ value: string, label: string } | null}
 */
export function matchMusicStyleFromGenre(raw) {
  const g = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  if (!g) return null;

  const rules = [
    { re: /gospel|worship|inspirational/, value: "Gospel / Inspirational" },
    { re: /neo-?soul|quiet storm/, value: "Neo-soul / Quiet storm" },
    { re: /r&?b|soul/, value: "R&B / Soul moderne" },
    { re: /drill|rap|hip[\s-]?hop/, value: "Rap / Drill francophone" },
    { re: /trap|cloud/, value: "Trap / Cloud rap" },
    { re: /boom\s*bap|old\s*school/, value: "Hip-hop old school / Boom bap" },
    { re: /amapiano/, value: "Amapiano / Afro-house" },
    { re: /afro|afrobeats/, value: "Afrobeats / Afro-pop" },
    { re: /hyperpop|electro|electronic|synth/, value: "Électro / Hyperpop" },
    { re: /house|dance(?!hall)/, value: "House / Dance" },
    { re: /techno/, value: "Techno / Underground" },
    { re: /edm|festival/, value: "EDM / Festival" },
    { re: /death\s*metal|brutal death|black\s*metal|grindcore|deathcore/, value: "Death Metal / Brutal" },
    { re: /metal|screamo|thrash|doom/, value: "Metal / Hard rock" },
    { re: /punk|garage/, value: "Punk / Garage" },
    { re: /\bindie\b|\balternative\b(?!\s*metal)/, value: "Indie / Alternative" },
    { re: /folk|acoustic/, value: "Folk / Acoustique" },
    { re: /chanson|variete/, value: "Variété / Chanson" },
    { re: /reggaeton|\blatin\b|salsa/, value: "Latin / Reggaeton" },
    { re: /dancehall|reggae/, value: "Dancehall / Reggae" },
    { re: /rock/, value: "Rock / Indie rock" },
    { re: /jazz/, value: "Jazz / Nu-jazz" },
    { re: /blues/, value: "Blues / Roots" },
    { re: /funk|disco/, value: "Funk / Disco" },
    { re: /k-?pop|j-?pop/, value: "K-pop / J-pop" },
    { re: /lo-?fi|chill/, value: "Lo-fi / Chill" },
    { re: /synthwave|retrowave/, value: "Synthwave / Retrowave" },
    { re: /country|americana/, value: "Country / Americana" },
    { re: /world|fusion/, value: "World / Fusion" },
    { re: /melodic|urbaine|urban/, value: "Pop urbaine / Melodic" },
    { re: /pop/, value: "Pop contemporaine" },
  ];

  for (const { re, value } of rules) {
    if (re.test(g)) {
      const hit = MUSIC_STYLES.find((s) => s.value === value);
      return hit || { value, label: value };
    }
  }
  return null;
}

/** Genres catalogue (iTunes/Spotify) → values MUSIC_STYLES, dédupliquées. */
export function catalogGenresToStyleValues(genres = []) {
  const values = [];
  const seen = new Set();
  const list = Array.isArray(genres) ? genres : [genres];
  for (const raw of list) {
    const hit = matchMusicStyleFromGenre(raw);
    if (!hit?.value || seen.has(hit.value)) continue;
    seen.add(hit.value);
    values.push(hit.value);
  }
  if (values.some((v) => /metal/i.test(v))) {
    return values.filter(
      (v) => v !== "Rock / Indie rock" && v !== "Pop contemporaine" && v !== "Indie / Alternative",
    );
  }
  return values;
}

const JUNK_GENRE_RE =
  /alliteration|assonance|metaphor|rhyme|lyrics|poetry|literary|seen live|favourite|favorite/;

function looksLikeGenreToken(raw) {
  const g = String(raw || "").trim();
  if (g.length < 3 || g.length > 48) return false;
  if (JUNK_GENRE_RE.test(g.toLowerCase())) return false;
  if (matchMusicStyleFromGenre(g)) return true;
  return /metal|rock|punk|jazz|soul|pop|rap|hop|house|techno|folk|blues|funk|disco|gospel|indie|electro|trap|drill|reggae|latin|country|ambient|hardcore|grind|thrash|doom|black|death|wave|beat/.test(
    g.toLowerCase(),
  );
}

/**
 * Pastilles UI : genres catalogue nettoyés, dédupliqués par label.
 * Rock/Pop ombrelle retirés si un vrai metal est présent.
 */
export function styleGenreChips(rawList = []) {
  const chips = [];
  const seen = new Set();
  for (const raw of parseGenres(rawList)) {
    const g = String(raw || "").trim();
    if (!g || !looksLikeGenreToken(g)) continue;
    const mapped = matchMusicStyleFromGenre(g);
    const label = mapped?.label || g;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ raw: g, value: mapped?.value || g, label });
  }
  const blob = chips.map((c) => `${c.label} ${c.raw}`).join(" ");
  if (isMetalLane(blob)) {
    return chips.filter((c) => !/^(rock|pop|indie)$/i.test(c.label));
  }
  return chips;
}

function displayGenreToken(token) {
  const t = String(token || "").trim();
  if (/[A-Z]/.test(t)) return t;
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Labels d’affichage : découpe « a × b », ignore la casse, une pastille par genre.
 */
export function uniqueGenreLabels(rawList = [], { limit = 8 } = {}) {
  const seen = new Map();
  for (const token of parseGenres(rawList)) {
    if (!looksLikeGenreToken(token)) continue;
    const key = token.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key) continue;
    const prev = seen.get(key);
    const next = displayGenreToken(token);
    if (!prev || ((next.match(/[A-Z]/g) || []).length > (prev.match(/[A-Z]/g) || []).length)) {
      seen.set(key, next);
    }
  }
  return [...seen.values()].slice(0, limit);
}

/** Normalise genres (tableau ou string legacy) → string[]. Découpe aussi « a × b ». */
export function parseGenres(genreOrGenres) {
  if (Array.isArray(genreOrGenres)) {
    return genreOrGenres.flatMap((g) => parseGenres(g));
  }
  const raw = String(genreOrGenres || "").trim();
  if (!raw) return [];
  return raw
    .split(/\s*[×/,|]\s*|\s+x\s+|\s+·\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Affiche / prompt IA : "Rap × Électro". */
export function formatGenres(genreOrGenres) {
  return parseGenres(genreOrGenres).join(" × ");
}

/** Label court d’une value MUSIC_STYLES (ou le texte tel quel). */
export function styleLabelForValue(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  const hit = MUSIC_STYLES.find((s) => s.value === v);
  return hit?.label || v;
}

/**
 * Couches de mix UI : base (titre / artiste) + ajouts manuels / perso.
 * Les ajouts déjà présents dans la base sont omis (pas de doublon).
 */
export function describeStyleMix({
  trackChips = [],
  artistChips = [],
  extras = [],
  custom = "",
} = {}) {
  const base = [
    ...trackChips.map((c) => ({
      label: c.label,
      value: c.value,
      source: "track",
    })),
    ...artistChips.map((c) => ({
      label: c.label,
      value: c.value,
      source: "artist",
    })),
  ];
  const baseKeys = new Set(
    base.flatMap((c) => [
      String(c.label || "").toLowerCase(),
      String(c.value || "").toLowerCase(),
    ]),
  );
  const extraItems = [];
  const seen = new Set();
  for (const raw of extras) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const label = styleLabelForValue(value);
    const key = label.toLowerCase();
    if (baseKeys.has(key) || baseKeys.has(value.toLowerCase()) || seen.has(key)) continue;
    seen.add(key);
    extraItems.push({ label, value, source: "extra" });
  }
  const customTrim = String(custom || "").trim();
  if (customTrim) {
    const key = customTrim.toLowerCase();
    if (!baseKeys.has(key) && !seen.has(key)) {
      extraItems.push({ label: customTrim, value: customTrim, source: "custom" });
    }
  }
  return { base, extras: extraItems };
}

/** Résumé lisible du mix (base ∪ ajouts). */
export function formatStyleMixSummary(mix) {
  const base = (mix?.base || []).map((c) =>
    c.source === "track" ? `${c.label} · titre` : `${c.label} · artiste`,
  );
  const extras = (mix?.extras || []).map((c) =>
    c.source === "custom" ? `« ${c.label} »` : c.label,
  );
  if (!base.length && !extras.length) return "";
  if (!extras.length) return `Base : ${base.join(" + ")}`;
  if (!base.length) return `Ajouts : ${extras.join(" + ")}`;
  return `Mix : ${base.join(" + ")}  +  ${extras.join(" + ")}`;
}
