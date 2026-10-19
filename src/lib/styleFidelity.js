/**
 * Fidélité au style de référence (artiste réel peu connu, ou clone d'un artiste Sonozz).
 * Fonctions pures — testées dans tests/style-fidelity.test.js.
 */

const median = (nums) => {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : Math.round((xs[m - 1] + xs[m]) / 2);
};

const uniqLower = (arr, max) => {
  const out = [];
  for (const v of arr) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

/** Fusionne plusieurs écoutes preview (BPM médian, instruments unis, 1er timbre non vide). */
export function mergeAudioDna(list = []) {
  const dnas = (Array.isArray(list) ? list : []).filter((d) => d && typeof d === "object");
  if (!dnas.length) return null;
  if (dnas.length === 1) return { ...dnas[0], listens: 1 };
  const first = (key) => dnas.map((d) => String(d[key] || "").trim()).find(Boolean) || "";
  const register =
    dnas.map((d) => d.vocalRegister).find((r) => r && r !== "unknown") || first("vocalRegister");
  const energies = dnas.map((d) => d.energy);
  const energy = ["high", "mid", "low"].find(
    (e) => energies.filter((x) => x === e).length > dnas.length / 2,
  ) || dnas[0].energy || "mid";
  return {
    bpmEstimate: median(dnas.map((d) => Number(d.bpmEstimate))),
    energy,
    mood: uniqLower(dnas.map((d) => d.mood), 2).join(", "),
    timbre: first("timbre"),
    vocalStyle: first("vocalStyle"),
    vocalRegister: register,
    rhythmFeel: uniqLower(dnas.map((d) => d.rhythmFeel), 2).join(" / "),
    instruments: uniqLower(dnas.flatMap((d) => d.instruments || []), 8),
    productionDensity: dnas[0].productionDensity || "mid",
    genreFeel: uniqLower(dnas.map((d) => d.genreFeel), 2).join(" / "),
    listens: dnas.length,
  };
}

/**
 * Artiste peu connu : le LLM (et le modèle musical) ne le connaissent pas.
 * Ne JAMAIS s'appuyer sur « ta connaissance » ni sur « in the style of <nom> ».
 */
export function isLesserKnownArtist(catalog) {
  if (!catalog) return true;
  const followers = Number(catalog.followers);
  const popularity = Number(catalog.popularity);
  if (Number.isFinite(popularity) && popularity >= 55) return false;
  if (Number.isFinite(followers) && followers >= 100000) return false;
  return true;
}

/** D'où vient le DNA : écoute réelle, fiche catalogue, ou juste le nom. */
export function styleDnaSource({ audioListened, thin } = {}) {
  if (audioListened) return "audio";
  if (thin) return "name-only";
  return "catalog";
}

export function styleLockWarnings({ dnaSource, lesserKnown, name } = {}) {
  const out = [];
  if (dnaSource === "name-only") {
    out.push(
      `Peu de données sur « ${name || "cet artiste"} » (pas de titres ni d'extrait audio) : le son est deviné. Choisis plutôt un MORCEAU de référence ou ajoute un extrait audio.`,
    );
  } else if (dnaSource === "catalog" && lesserKnown) {
    out.push(
      `« ${name || "Cet artiste"} » est peu connu et aucun extrait n'a pu être écouté : vérifie genre / timbre / BPM dans l'onglet Style.`,
    );
  }
  return out;
}

/** Fidélité stricte : clone d'un artiste Sonozz (ou réglage explicite). */
export function isStrictStyleFidelity(artist) {
  if (!artist || typeof artist !== "object") return false;
  return artist.styleFidelity === "strict" || Boolean(artist.cloneOf);
}

function shortWords(s, maxChars) {
  const t = String(s || "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/g, "")
    .trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const sp = cut.lastIndexOf(" ");
  return (sp > maxChars * 0.5 ? cut.slice(0, sp) : cut).replace(/[,\s·-]+$/g, "");
}

/**
 * Bout de caption « timbre » pour le modèle musical (ACE) — sinon seul « male lead vocal »
 * part et la couleur de voix de la référence est perdue.
 */
export function vocalTimbreStyleBit(artist, styleLock = null) {
  const lock = styleLock || artist?.styleLock || null;
  const sample = artist?.voiceSample && typeof artist.voiceSample === "object" ? artist.voiceSample : null;
  const raw =
    sample?.songGenTimbre ||
    sample?.analyzedTimbre ||
    lock?.timbre ||
    "";
  // Mots qui font dériver ACE (voix parlée / vocoder) : on ne garde que la COULEUR.
  const risky = /conversational|spoken|talk|narrat|whisper|vocoder|auto-?tune|robotic/i;
  const parts = String(raw)
    .split(/\s*·\s*/)[0]
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter((x) => x && !risky.test(x))
    .slice(0, 2);
  const timbre = shortWords(parts.join(", "), 48);
  if (!timbre) return "";
  const reg = String(lock?.vocalRegister || sample?.vocalRegister || "").trim().toLowerCase();
  const regOk =
    reg &&
    reg !== "unknown" &&
    reg !== "mixed" &&
    reg.length <= 14 &&
    !timbre.toLowerCase().includes(reg);
  return `${timbre}${regOk ? ` ${reg}` : ""} voice timbre`;
}

/** Champs SON copiés tels quels depuis l'artiste source (clone Sonozz). */
export const CLONE_SOUND_FIELDS = [
  "genre",
  "genres",
  "mood",
  "voice",
  "gender",
  "language",
  "styleLock",
  "styleArtist",
  "styleArtists",
  "styleTrack",
  "influences",
  "musicArrange",
  "writingVoice",
  "favoriteTopics",
  "avoidTopics",
  "newsMode",
  "voiceSample",
  // Duo : les DEUX profils vocaux + interaction + partenaire (singer 2).
  "duo",
  "duoPartner",
  "duoMembers",
  "duoInteraction",
  "vocalProfiles",
];

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

/**
 * Patch SON d'un clone : copie verbatim (pas de ré-invention LLM).
 * @param {object} source profil de l'artiste Sonozz source
 * @param {{ keepGender?: boolean }} [opts]
 */
export function buildCloneSoundPatch(source, { keepGender = true } = {}) {
  if (!source || typeof source !== "object") return {};
  const patch = {};
  for (const k of CLONE_SOUND_FIELDS) {
    if (k === "gender" && !keepGender) continue;
    if (source[k] === undefined || source[k] === null || source[k] === "") continue;
    patch[k] = clone(source[k]);
  }
  if (patch.voiceSample && typeof patch.voiceSample === "object") {
    // Timbre seulement : JAMAIS le fichier audio source (supprimer le clone effacerait
    // l'enregistrement S3 de l'artiste source).
    const v = patch.voiceSample;
    const timbreOnly = {
      guideMode: "timbre",
      songGenTimbre: v.songGenTimbre,
      analyzedTimbre: v.analyzedTimbre,
      vocalRegister: v.vocalRegister,
      genderFeel: v.genderFeel,
      timbreSource: "clone",
      timbreAnalyzedAt: v.timbreAnalyzedAt,
    };
    for (const key of Object.keys(timbreOnly)) {
      if (timbreOnly[key] === undefined) delete timbreOnly[key];
    }
    if (timbreOnly.songGenTimbre || timbreOnly.analyzedTimbre) patch.voiceSample = timbreOnly;
    else delete patch.voiceSample;
  }
  patch.styleFidelity = "strict";
  patch.cloneOf = {
    slug: source.slug || null,
    name: source.name || null,
    at: new Date().toISOString(),
  };
  return patch;
}

/** Styles-lock d'un profil source → forme attendue par runArtist (resolve sauté). */
export function styleLockFromSourceProfile(source) {
  const lock = source?.styleLock && typeof source.styleLock === "object" ? clone(source.styleLock) : null;
  if (!lock) return null;
  return {
    ...lock,
    confidence: "cloned",
    clonedFrom: source.slug || source.name || null,
    influences: Array.isArray(lock.influences) && lock.influences.length
      ? lock.influences
      : Array.isArray(source.influences)
        ? source.influences
        : [],
  };
}
