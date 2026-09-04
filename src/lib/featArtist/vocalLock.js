import { resolveArtistGender, ARTIST_GENDER_LABELS } from "../artistGender.js";

/** Lock vocal figé pour un artiste (lead ou feat) — jamais croisé. */
export function vocalLockForArtist(artist) {
  if (!artist || typeof artist !== "object") return null;
  const gender = resolveArtistGender(artist);
  const code = gender?.code || null;
  const lock = artist.styleLock || {};
  const sample = artist.voiceSample || {};
  const timbre =
    sample.songGenTimbre ||
    sample.analyzedTimbre ||
    sample.timbreHint ||
    lock.timbre ||
    null;
  const vocalStyle = lock.vocalStyle || artist.voice || null;

  let voiceHint = "vocals";
  if (code === "female") voiceHint = "female vocals, woman singer";
  else if (code === "male") voiceHint = "male vocals, man singer";
  else if (code === "nonbinary") voiceHint = "androgynous vocals";

  const timbreHint = timbre ? String(timbre).slice(0, 80) : null;
  const hasAudioSample = Boolean(sample.s3Key || sample.url || sample.dataUrl);

  return {
    name: String(artist.name || "").trim() || "Artist",
    genderCode: code,
    genderLabel: code ? ARTIST_GENDER_LABELS[code] : null,
    voiceHint,
    timbreHint,
    vocalStyle: vocalStyle ? String(vocalStyle).slice(0, 100) : null,
    hasAudioSample,
    genre: artist.genre || lock.genreSummary || null,
    mood: artist.mood || lock.mood || null,
    writingStyle: lock.writingStyle || null,
  };
}

/**
 * Feat gospel / chœur : modèle « Sister Act » — lead gospel CLAIR devant un vrai chœur d’église.
 * Le chœur répond / double le feat ; il ne remplace pas singer 2 et ne fusionne pas avec le rappeur.
 */
export function soloizeFeatVocalForDuo(lock) {
  if (!lock || typeof lock !== "object") return lock;
  const blob = `${lock.vocalStyle || ""} ${lock.timbreHint || ""} ${lock.genre || ""}`;
  if (!/\bgospel\b|\bchoir\b|\bensembl\b|\bchorale\b|\bchurch\b/i.test(blob)) return lock;

  const gender = lock.genderCode === "female" ? "woman" : lock.genderCode === "male" ? "man" : "solo";
  return {
    ...lock,
    vocalStyle:
      "Sister Act style gospel lead: powerful soulful belting in front of a joyful church choir, call-and-response with the choir, melismatic ad-libs — choir answers the lead, never replaces them",
    timbreHint: `resonant ${gender} gospel lead like a church soloist (Sister Act energy), bright and passionate; SATB choir behind on hooks only`,
    voiceHint: lock.voiceHint || "male vocals, man singer",
    genre: lock.genre || "Gospel",
  };
}

/** Feat clairement gospel / soul (pas juste un 2e rappeur). */
export function isGospelFeatLock(lock) {
  if (!lock || typeof lock !== "object") return false;
  const blob = `${lock.genre || ""} ${lock.vocalStyle || ""} ${lock.timbreHint || ""}`.toLowerCase();
  return /gospel|soul|choir|chorale|church|sister act/.test(blob);
}

/** Prod gospel type Sister Act (chœur + orgue + claps) — pour sections feat. */
export function sisterActGospelProductionLine() {
  return [
    "REAL Sister Act / contemporary church gospel on hooks",
    "Hammond B3 organ, piano, handclaps, tambourine",
    "joyful SATB choir call-and-response with the gospel lead",
    "uplifting Sunday-service energy, congregation feel",
    "big choir stacks behind singer 2 only — never blend choir with the rapper",
  ].join("; ");
}

/** Phrase timbre prioritaire pour ACE / prompts (texte seul — pas de clone audio). */
export function vocalTimbreLine(lock) {
  if (!lock) return "";
  const parts = [];
  if (lock.timbreHint) parts.push(`timbre: ${lock.timbreHint}`);
  if (lock.vocalStyle) parts.push(`delivery: ${lock.vocalStyle}`);
  if (!parts.length && lock.voiceHint) parts.push(lock.voiceHint);
  return parts.join(", ");
}

/**
 * Duo même sexe : forcer un contraste de registre (sinon ACE mash métallique).
 * Lead = grave / parlé ; feat = aigu / mélodique (ou l’inverse selon genres).
 */
export function contrastSameSexVocalHints(leadLock, featLock) {
  const a = leadLock && typeof leadLock === "object" ? leadLock : null;
  const b = featLock && typeof featLock === "object" ? featLock : null;
  if (!a?.genderCode || !b?.genderCode || a.genderCode !== b.genderCode) {
    return { sameSex: false, leadHint: null, featHint: null, leadTag: null, featTag: null };
  }
  const g = a.genderCode;
  const leadBlob = `${a.genre || ""} ${a.vocalStyle || ""}`.toLowerCase();
  const featBlob = `${b.genre || ""} ${b.vocalStyle || ""}`.toLowerCase();
  const leadRap = /hip.?hop|rap|trap|drill/.test(leadBlob);
  const featGospel = /gospel|soul|choir|chorale/.test(featBlob);

  if (g === "male") {
    if (leadRap && featGospel) {
      return {
        sameSex: true,
        leadHint:
          "deep baritone spoken-sung rap, dry natural male voice",
        featHint:
          "Sister Act style GOSPEL lead — high tenor church soloist, joyful soulful belting, melismatic runs, testimony shout; choir call-and-response BEHIND them on hooks; featured star of the gospel sections, NOT a second rapper",
        leadTag: "male rap baritone",
        featTag: "male gospel tenor",
      };
    }
    return {
      sameSex: true,
      leadHint: "deep baritone male lead, dry natural voice, clear diction",
      featHint:
        "higher tenor male featured lead, brighter timbre, distinct from singer 1, natural voice",
      leadTag: "male baritone",
      featTag: "male tenor",
    };
  }

  if (g === "female") {
    return {
      sameSex: true,
      leadHint: "low alto / mezzo chest voice, dry natural tone",
      featHint: "bright high mezzo / soprano lead, clear and distinct from singer 1",
      leadTag: "female alto",
      featTag: "female soprano",
    };
  }

  return {
    sameSex: true,
    leadHint: "lower-register lead voice, dry natural tone",
    featHint: "higher-register featured voice, clearly different timbre",
    leadTag: "vocal low",
    featTag: "vocal high",
  };
}

export function aceStepSameSexDuoNegatives() {
  return "two distinct clear natural voices";
}
