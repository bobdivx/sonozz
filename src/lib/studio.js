import { isMetalLane } from "./musicLane.js";

export const STEPS = [
  { id: 1, key: "stats", label: "Stats", short: "Analytics" },
  { id: 2, key: "lyrics", label: "Paroles", short: "Texte" },
  { id: 3, key: "tracks", label: "Morceaux", short: "Audio" },
  { id: 4, key: "covers", label: "Jaquettes", short: "Visuel" },
  { id: 5, key: "distrokid", label: "ONCE", short: "Release" },
  { id: 6, key: "clip", label: "Clips", short: "Vidéo" },
  { id: 7, key: "social", label: "Réseaux", short: "Pub" },
];

/** Ids d’étape Studio (sans création d’artiste). */
export const STUDIO_STEP = {
  stats: 1,
  lyrics: 2,
  tracks: 3,
  covers: 4,
  distrokid: 5,
  clip: 6,
  social: 7,
};

export function studioHref(projectId, stepKey = "tracks") {
  const step = STUDIO_STEP[stepKey] || STUDIO_STEP.tracks;
  const q = new URLSearchParams();
  if (projectId) q.set("project", String(projectId));
  q.set("step", String(step));
  return `/?${q.toString()}`;
}

export function artistHubHref(slug) {
  const s = String(slug || "").trim();
  return s ? `/artiste/${encodeURIComponent(s)}` : "/artistes";
}

export function artistEditHref(slug) {
  const s = String(slug || "").trim();
  return s ? `/artiste/${encodeURIComponent(s)}/editer` : "/artiste/nouveau";
}

/** Fiche artiste, onglet Album (création) ou album ouvert dans le catalogue. */
export function artistAlbumHref(slug, leadId = "") {
  const base = artistHubHref(slug);
  const id = String(leadId || "").trim();
  if (base === "/artistes") return base;
  return id ? `${base}#album-${id}` : `${base}#album`;
}

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
/** Langues des paroles / release. */
export const MUSIC_LANGUAGES = [
  { code: "en", label: "Anglais", prompt: "anglais (English)" },
  { code: "fr", label: "Français", prompt: "français" },
  { code: "es", label: "Espagnol", prompt: "espagnol" },
  { code: "zh", label: "Chinois", prompt: "chinois (mandarin)" },
  { code: "ja", label: "Japonais", prompt: "japonais" },
  { code: "pt", label: "Portugais", prompt: "portugais" },
  { code: "it", label: "Italien", prompt: "italien" },
  { code: "de", label: "Allemand", prompt: "allemand" },
  { code: "ar", label: "Arabe", prompt: "arabe" },
];

/**
 * Langues chantées nativement par SongGeneration (LeVo), selon le checkpoint.
 * Large = zh+en. v2 = zh, en, es, ja (+ « etc. » non documenté pour le FR).
 */
export const SONGGEN_LANGS_BY_MODEL = {
  songgeneration_base: ["zh"],
  songgeneration_base_new: ["zh", "en"],
  songgeneration_base_full: ["zh", "en"],
  songgeneration_large: ["zh", "en"],
  songgeneration_v2_large: ["zh", "en", "es", "ja"],
  songgeneration_v2_medium: ["zh", "en", "es", "ja"],
  songgeneration_v2_fast: ["zh", "en", "es", "ja"],
};

export function songGenLanguageCodes(modelId = "") {
  const id = String(modelId || "").toLowerCase().trim();
  if (id && SONGGEN_LANGS_BY_MODEL[id]) return [...SONGGEN_LANGS_BY_MODEL[id]];
  if (id.includes("v2")) return ["zh", "en", "es", "ja"];
  if (id === "songgeneration_base") return ["zh"];
  return ["zh", "en"];
}

export function isSongGenNativeLanguage(code, songGenModel) {
  const lang = String(code || "").toLowerCase().slice(0, 2);
  return songGenLanguageCodes(songGenModel).includes(lang);
}

/**
 * Langues proposées dans l’UI.
 * SongGen : on affiche aussi FR/ES/… (chant via MiniMax si le modèle ne les chante pas).
 */
export function languagesForProvider(musicProvider, songGenModel, { minimaxFallback = true } = {}) {
  const provider = String(musicProvider || "").trim();
  if (provider !== "songgen") return MUSIC_LANGUAGES;
  if (minimaxFallback) return MUSIC_LANGUAGES;
  const allowed = new Set(songGenLanguageCodes(songGenModel));
  return MUSIC_LANGUAGES.filter((l) => allowed.has(l.code));
}

export function isLanguageOkForProvider(code, musicProvider, songGenModel) {
  const provider = String(musicProvider || "").trim();
  if (provider !== "songgen") return true;
  return isSongGenNativeLanguage(code, songGenModel);
}

/** Badge UI : moteur qui chantera vraiment cette langue. */
export function languageEngineLabel(code, musicProvider, songGenModel) {
  const provider = String(musicProvider || "").trim();
  if (provider === "acestep") return "ACE-Step";
  if (provider !== "songgen") return "";
  return isSongGenNativeLanguage(code, songGenModel) ? "SongGen" : "MiniMax";
}

export function songGenLanguageHint(modelId) {
  const id = modelId || "songgeneration_large";
  const native = songGenLanguageCodes(id)
    .map((c) => MUSIC_LANGUAGES.find((l) => l.code === c)?.label || c)
    .join(", ");
  const v2 = String(id).includes("v2");
  if (v2) {
    return `SongGen v2 chante : ${native}. Français : pas documenté — on bascule sur MiniMax.`;
  }
  return `SongGen Large chante : ${native}. Espagnol / japonais = modèle v2 (pas installé). Français et le reste : MiniMax (Réglages → Replicate).`;
}

export function languageLabel(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.label || code || "Français";
}

export function languagePrompt(code) {
  return MUSIC_LANGUAGES.find((l) => l.code === code)?.prompt || "français";
}

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

export const emptyProject = () => ({
  trends: null,
  artist: null,
  /** Second artiste SONOZZ (duo / feat.) — snapshot vocal+style, jamais fusionné au lead. */
  featArtist: null,
  lyrics: null,
  lyricsVersions: [],
  activeLyricsId: null,
  track: null,
  trackVersions: [],
  activeTrackId: null,
  album: null,
  musicArrange: null,
  cover: null,
  coverVersions: [],
  activeCoverId: null,
  distrokid: null,
  social: null,
  clip: null,
  clips: [],
  activeClipId: null,
});

/** Tailles d’album proposées (lead inclus). */
export const ALBUM_SIZES = [
  { value: 5, label: "EP · 5 titres" },
  { value: 8, label: "Album · 8 titres" },
  { value: 10, label: "Album · 10 titres" },
  { value: 12, label: "Album · 12 titres" },
];

export function createAlbumId() {
  return `alb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createAlbumTrackId() {
  return `at_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Audio généré/importé et validé — utilisable pour Cover, ONCE, clips, catalogue. */
export function isTrackAudioFinal(track) {
  if (!track?.audioUrl) return false;
  const st = String(track.status || "");
  if (st === "pending-review" || st === "preview-ready") return false;
  if (track.isPreview) return false;
  return true;
}

/** True si le projet / release a été soumis ou livré via ONCE. */
export function isOncePublished(meta = {}) {
  if (!meta || typeof meta !== "object") return false;
  if (meta.distributed) return true;
  const status = String(meta.status || meta.onceStatus || "").toLowerCase();
  const provider = String(meta.provider || "").toLowerCase();
  const releaseId = String(meta.releaseId || "").trim();
  if (/^(submitted|live|distributed|delivered)/i.test(status)) return true;
  if (/live|distributed|delivered/i.test(status)) return true;
  if (provider === "once" && releaseId) return true;
  return false;
}

/**
 * Message de confirmation suppression projet.
 * @returns {string|null} null = l’utilisateur a annulé
 */
export function confirmDeleteProject(label, onceMeta = {}) {
  const name = label || "ce morceau";
  const once = isOncePublished(onceMeta);
  const releaseId = String(onceMeta.releaseId || "").trim();

  if (once) {
    const ok = confirm(
      `Attention — « ${name} » a déjà été publié / soumis sur ONCE` +
        (releaseId ? ` (release ${releaseId})` : "") +
        `.\n\n` +
        `Supprimer ici n’annule PAS la release ONCE ni les stores (Spotify, etc.).\n` +
        `Tu devras la gérer séparément dans le dashboard ONCE.\n\n` +
        `Continuer et effacer le projet SONOZZ ?`,
    );
    if (!ok) return false;
    return confirm(
      `Dernière confirmation : supprimer définitivement « ${name} » de SONOZZ ?\n` +
        `La release ONCE restera en ligne tant que tu ne l’as pas retirée côté ONCE.`,
    );
  }

  return confirm(
    `Supprimer définitivement « ${name} » ?\n\nLe projet (audio, paroles, album) sera effacé de Turso.`,
  );
}

const GENERIC_AUDIO_STEMS =
  /^(stream|audio|track|untitled|sans[-_ ]?titre|download|file|song)$/i;

/** Titre placeholder (Untitled / vide) — à remplacer à l’import. */
export function isPlaceholderTitle(value) {
  const s = String(value || "").trim();
  return !s || /^untitled$/i.test(s);
}

/** Titre lisible depuis un nom de fichier audio (ignore stream.flac, etc.). */
export function titleFromAudioFileName(fileName) {
  const raw = String(fileName || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "";
  const stem = raw.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
  if (!stem || GENERIC_AUDIO_STEMS.test(stem)) return "";
  return stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}
