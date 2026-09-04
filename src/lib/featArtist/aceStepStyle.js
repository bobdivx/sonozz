import {
  vocalLockForArtist,
  soloizeFeatVocalForDuo,
  contrastSameSexVocalHints,
  isGospelFeatLock,
  sisterActGospelProductionLine,
  aceStepSameSexDuoNegatives,
  vocalTimbreLine,
} from "./vocalLock.js";

/**
 * Style ACE-Step duo : UNE seule lane de prod (lead) + 2 voix.
 * Prompt court — trop de bits commerciaux / fusion / DNA → ACE colle 2 morceaux.
 */
export function buildAceStepDuoStyle(lead, feat, { genreSummary, mood, styleLock, styleBase } = {}) {
  const a = vocalLockForArtist(lead);
  let b = vocalLockForArtist(feat);
  if (!a || !b) return "";
  b = soloizeFeatVocalForDuo(b);

  const contrast = contrastSameSexVocalHints(a, b);
  const leadTimbre =
    contrast.leadHint || vocalTimbreLine(a) || a.voiceHint;
  const featTimbre =
    contrast.featHint || vocalTimbreLine(b) || b.voiceHint;
  const lock = styleLock && typeof styleLock === "object" ? styleLock : null;

  const leadGenre = String(
    a.genre || lock?.genreSummary || genreSummary || styleBase || "hip hop",
  )
    .trim()
    .slice(0, 80);
  const featGenre = String(b.genre || "").trim().slice(0, 60);
  const moodBit = String(mood || lock?.mood || a.mood || "").trim().slice(0, 60);

  // Verses = lane lead ; hooks gospel = vrai arrangement Sister Act (pas une touche soft).
  const genreNorm = leadGenre.toLowerCase();
  const featGospel = isGospelFeatLock(b) || /gospel|soul/i.test(featGenre);
  let bed = "808 bass, boom-bap drums, hi-hats, sparse piano, synth pads";
  if (/trap|drill/.test(genreNorm)) bed = "808 bass, trap drums, hi-hats, dark pads, melodic hook";
  else if (/r&?b|soul/.test(genreNorm)) bed = "drum kit, bass, electric piano, pads";
  else if (/gospel/.test(genreNorm)) bed = "live drums, bass, piano, Hammond organ, handclaps, gospel choir";
  else if (/rock|metal/.test(genreNorm)) bed = "drums, bass, guitars, pads";
  if (featGospel && !/gospel/.test(genreNorm)) {
    bed = `VERSES: ${bed}. CHORUS/HOOK/BRIDGE: ${sisterActGospelProductionLine()}`;
  }

  const fusion = featGospel
    ? `TRUE hip-hop × Sister Act gospel: ${leadGenre} RAP verses (singer 1, dry hip-hop beat); then FULL church-gospel choruses owned by singer 2 (${b.name}) with choir answering — audible genre switch on hooks (organ, claps, choir), still ONE song not two glued tracks`
    : featGenre && !genreNorm.includes(featGenre.toLowerCase().slice(0, 6))
      ? `ONE song only: ${leadGenre} production throughout; ${b.name} brings ${featGenre} vocal color on hooks — never switch to a second genre mid-track`
      : `ONE song only: coherent ${leadGenre} arrangement from intro to outro`;

  const sameSex = contrast.sameSex
    ? featGospel
      ? `CRITICAL: singer 1 rap on verses; singer 2 = Sister Act gospel LEAD on every Chorus/Hook/Bridge (choir answers singer 2 only); keep rapper and gospel lead distinct; ${aceStepSameSexDuoNegatives()}`
      : `CRITICAL same-sex duet: singer 1 = ${contrast.leadTag}, singer 2 = ${contrast.featTag}; NEVER blend into one voice; call-and-response on hooks only (never stacked unison); ${aceStepSameSexDuoNegatives()}`
    : null;

  return [
    featGospel
      ? `${leadGenre} featuring Sister Act style gospel — church choir energy on hooks, clean mix`
      : `${leadGenre} duet hit — single production lane, full band, clean mix, not two songs glued together`,
    `instruments: ${bed}`,
    fusion,
    moodBit || null,
    sameSex,
    `singer 1 ${a.name} (${contrast.leadTag || a.genderCode || "lead"}): ${leadTimbre}`.slice(
      0,
      220,
    ),
    `singer 2 ${b.name} (${contrast.featTag || b.genderCode || "feat"}): ${featTimbre}`.slice(
      0,
      240,
    ),
    featGospel
      ? `obey tags: verses = singer 1 rap over hip-hop; Chorus/Bridge = singer 2 gospel lead + Sister Act choir/organ/claps; choir never sings the rap verses`
      : `obey [singer 1]/[singer 2] tags; both voices intelligible; no anonymous choir as singer 2`,
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1100);
}
