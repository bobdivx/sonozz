import { norm, uniqStrings, isLock, artefactGuardsFromBlob } from "./util.js";
import { styleLockGenreBlob, isMetalLane, isExtremeMetalLane, isThrashLane } from "./genres.js";

function flavorFromLock(lock) {
  return uniqStrings(
    [
      lock?.genreSummary,
      ...(Array.isArray(lock?.sonicKeywords) ? lock.sonicKeywords : []),
      lock?.vocalStyle,
      lock?.production,
      lock?.rhythmFeel,
      ...(Array.isArray(lock?.instruments) ? lock.instruments.slice(0, 4) : []),
    ],
    8,
  );
}

function flavorFromKeywords(blob = "") {
  if (!isMetalLane(blob)) return [];
  const g = norm(blob);
  const tags = [];
  if (/death\s*metal|brutal/.test(g)) tags.push("death metal", "distorted guitars", "live drum kit");
  if (/black\s*metal/.test(g)) tags.push("black metal", "tremolo picking");
  if (/guttural|growl/.test(g)) tags.push("guttural growls");
  if (/blast/.test(g)) tags.push("blast beats");
  if (/thrash|speed metal/.test(g)) tags.push("thrash metal", "palm-muted guitars", "live drum kit");
  if (!tags.length) tags.push("heavy metal", "distorted guitars", "live drum kit");
  for (const ban of artefactGuardsFromBlob(blob)) tags.push(ban);
  return uniqStrings(tags, 8);
}

/**
 * Tags de couleur : DNA du lock en priorité, sinon mots déjà présents dans le blob.
 * @param {string|object} blobOrLock
 */
export function metalFlavorTags(blobOrLock = "") {
  if (isLock(blobOrLock)) {
    const fromLock = flavorFromLock(blobOrLock);
    if (fromLock.length) return uniqStrings([...fromLock, ...artefactGuardsFromLock(blobOrLock)], 10);
    return flavorFromKeywords(styleLockGenreBlob(blobOrLock));
  }
  return flavorFromKeywords(blobOrLock);
}

export function defaultBpmForGenre(genreHint = "") {
  const g = norm(genreHint);
  if (/dancehall|reggae/.test(g)) return 98;
  if (/afro/.test(g)) return 108;
  if (/trap|drill/.test(g)) return 138;
  if (/death\s*metal|black\s*metal|grindcore|deathcore/.test(g)) return 170;
  if (/thrash|speed metal/.test(g)) return 140;
  if (/metal|hardcore/.test(g)) return 150;
  return 110;
}

/**
 * Voix : vocalStyle du lock, sinon fallback générique selon la lane détectée dans le blob.
 */
export function metalVoiceHint(genderCode = "male", blob = "", lock = null) {
  const fromLock = String(lock?.vocalStyle || "").trim();
  if (fromLock) return fromLock;
  const extreme = isExtremeMetalLane(blob);
  const thrash = isThrashLane(blob);
  if (genderCode === "female") {
    if (extreme) return "harsh screamed female vocals, not clean pop singing";
    if (thrash) return "aggressive female thrash vocals, rhythmic barked delivery, not pop belting";
    return "aggressive female metal vocals, not clean pop singing";
  }
  if (extreme) return "guttural death metal growled male vocals, not clean singing";
  if (thrash) {
    return "aggressive male thrash vocals, rhythmic barking, raspy baritone, not pop crooning";
  }
  return "aggressive male metal vocals, shouted and raspy, not pop crooning";
}

function blobLooksIndustrial(blob = "") {
  return /industrial|\bebm\b|vocoder/.test(norm(blob));
}

/** Gardes ACE / LeVo dérivées du DNA (growl harsh seulement) — pas de liste « no vocoder » globale. */
export function artefactGuardsFromLock(lock) {
  if (!isLock(lock)) return [];
  return artefactGuardsFromBlob(styleLockGenreBlob(lock), lock);
}

export function metalBandInstruments() {
  return [
    "distorted electric guitar",
    "down-tuned rhythm guitar",
    "bass guitar",
    "double kick drums",
    "palm-muted riffs",
  ];
}
