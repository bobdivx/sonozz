import { isMetalLane } from "../musicLane.js";
import { MUSIC_LANGUAGES } from "./languages.js";

const AREA_NAME_TO_COUNTRY = {
  "united states": "US",
  "united kingdom": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  france: "FR",
  belgium: "BE",
  canada: "CA",
  spain: "ES",
  mexico: "MX",
  brazil: "BR",
  portugal: "PT",
  italy: "IT",
  germany: "DE",
  austria: "AT",
  japan: "JP",
  china: "CN",
  "hong kong": "HK",
  taiwan: "TW",
  "south korea": "KR",
  korea: "KR",
  australia: "AU",
  ireland: "IE",
  colombia: "CO",
  argentina: "AR",
  chile: "CL",
  peru: "PE",
  "puerto rico": "PR",
  morocco: "MA",
  algeria: "DZ",
  tunisia: "TN",
  senegal: "SN",
  "ivory coast": "CI",
  "cote d ivoire": "CI",
};

const COUNTRY_TO_LANGUAGE = {
  US: "en",
  GB: "en",
  AU: "en",
  NZ: "en",
  IE: "en",
  CA: "en",
  FR: "fr",
  BE: "fr",
  LU: "fr",
  MC: "fr",
  SN: "fr",
  CI: "fr",
  ML: "fr",
  CM: "fr",
  CD: "fr",
  CG: "fr",
  GA: "fr",
  GN: "fr",
  BJ: "fr",
  TG: "fr",
  NE: "fr",
  BF: "fr",
  HT: "fr",
  MG: "fr",
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  PE: "es",
  UY: "es",
  VE: "es",
  EC: "es",
  GT: "es",
  CU: "es",
  DO: "es",
  PR: "es",
  PA: "es",
  CR: "es",
  BO: "es",
  PY: "es",
  HN: "es",
  NI: "es",
  SV: "es",
  BR: "pt",
  PT: "pt",
  AO: "pt",
  MZ: "pt",
  IT: "it",
  SM: "it",
  DE: "de",
  AT: "de",
  JP: "ja",
  CN: "zh",
  TW: "zh",
  HK: "zh",
  EG: "ar",
  SA: "ar",
  AE: "ar",
  QA: "ar",
  KW: "ar",
  BH: "ar",
  OM: "ar",
  JO: "ar",
  LB: "ar",
  IQ: "ar",
  SY: "ar",
  PS: "ar",
  YE: "ar",
  MA: "ar",
  DZ: "ar",
  TN: "ar",
  LY: "ar",
};

const LANGUAGE_FROM_GENRE = [
  { re: /french|francais|chanson|variete|pop urbaine/, code: "fr" },
  { re: /j-?pop|japanese|city pop/, code: "ja" },
  { re: /c-?pop|mando|canto|chinese/, code: "zh" },
  { re: /reggaeton|latin|salsa|bachata|corrido|regional mexican|musica mexicana/, code: "es" },
  { re: /sertanejo|bossa|mpb|fado|pagode|funk carioca/, code: "pt" },
  { re: /deutsch|german (rap|hip)/, code: "de" },
  { re: /italo|italian/, code: "it" },
  { re: /\brai\b|raï|arabic|maghreb/, code: "ar" },
  { re: /uk (drill|hip|rap|grime)|british|english (hip|rap)/, code: "en" },
];

/** Dernier recours : titres phares (quand le catalogue n’a pas de pays). */
const LANGUAGE_FROM_TITLE = [
  { re: /\b(alors|dans|pour|avec|sans|c'est|n'est|l'amour|je |tu |nous |une |des |les )\b/i, code: "fr" },
  { re: /\b(corazon|quiero|baile|noche|contigo|darte|\blos\b|\blas\b|\buno\b)/i, code: "es" },
  { re: /\b(the |you |your |love |don't |wanna |ain't |heart |night |baby |never |always |what'?s?)\b/i, code: "en" },
];

/** ISO-2 depuis un code ou un nom de pays MusicBrainz. */
export function normalizeCatalogCountry(raw) {
  const s = String(raw || "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const n = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return AREA_NAME_TO_COUNTRY[n] || "";
}

/**
 * Langue des chansons d’après la fiche artiste/titre (pays + tags + titres).
 * @returns {string | null} code MUSIC_LANGUAGES
 */
export function inferLanguageFromStyleRef({ country, language, genres = [], titles = [] } = {}) {
  const explicit = String(language || "")
    .toLowerCase()
    .slice(0, 2);
  if (MUSIC_LANGUAGES.some((l) => l.code === explicit)) return explicit;

  const blob = (Array.isArray(genres) ? genres : [genres])
    .map((g) => String(g || ""))
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const { re, code } of LANGUAGE_FROM_GENRE) {
    if (re.test(blob)) return code;
  }

  const cc = normalizeCatalogCountry(country);
  if (COUNTRY_TO_LANGUAGE[cc]) return COUNTRY_TO_LANGUAGE[cc];

  const titleBlob = (Array.isArray(titles) ? titles : [titles])
    .map((t) => String(t || ""))
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (titleBlob.trim()) {
    for (const { re, code } of LANGUAGE_FROM_TITLE) {
      if (re.test(titleBlob)) return code;
    }
  }

  return null;
}
