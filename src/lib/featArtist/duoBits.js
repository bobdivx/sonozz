import { vocalLockForArtist, isGospelFeatLock } from "./vocalLock.js";

/**
 * Style : lead = lane production dominante ; feat = couleur vocale + genre hint léger.
 * Pas de merge de BPM / instruments / musicPrompt.
 */
export function duoStylePromptBits(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return [];

  const bits = [
    `production lane stays with lead ${a.name}${a.genre ? ` (${a.genre})` : ""} on verses`,
  ];
  if (isGospelFeatLock(b) || /gospel/i.test(b.genre || "")) {
    bits.push(
      `featured ${b.name}: FULL Sister Act style gospel on choruses (church choir, Hammond, handclaps) — not a soft gospel tint on a rap beat`,
    );
  } else if (b.genre) {
    bits.push(
      `featured ${b.name} keeps their own vocal color${b.genre ? ` from ${b.genre}` : ""} — do not overwrite lead arrangement`,
    );
  } else {
    bits.push(`featured ${b.name} keeps their own vocal color — do not overwrite lead arrangement`);
  }
  if (b.mood) bits.push(`featured mood accent: ${b.mood}`);
  return bits;
}

/**
 * Bits prompt jaquette duo : deux visages distincts, composition album.
 * Les portraits de référence portent l’identité ; ici on verrouille le casting.
 */
export function duoCoverPromptBits(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return [];

  const bits = [
    `duet / featuring album cover with BOTH artists clearly visible`,
    `lead artist ${a.name}${a.genderLabel ? ` (${a.genderLabel})` : ""} — same person as reference image 1`,
    `featured artist ${b.name}${b.genderLabel ? ` (${b.genderLabel})` : ""} — same person as reference image 2 when provided`,
    `two distinct faces side by side or cinematic dual portrait, equal visual weight`,
    `do not merge faces, do not invent a third person, keep each identity and gender`,
  ];
  if (a.genderCode && b.genderCode && a.genderCode !== b.genderCode) {
    bits.push(`mixed-gender duo cover: ${a.genderCode} lead + ${b.genderCode} featured`);
  }
  return bits;
}

/** Tags courts pour SongGen custom_style (après les tags lead). */
export function duoSongGenStyleTags(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return [];

  const tags = ["vocal duet", "two singers", "call and response"];

  if (a.genderCode === "female") tags.push("female lead vocals");
  else if (a.genderCode === "male") tags.push("male lead vocals");

  if (b.genderCode === "female") tags.push("female featured vocals");
  else if (b.genderCode === "male") tags.push("male featured vocals");

  if (a.genderCode && b.genderCode && a.genderCode !== b.genderCode) {
    tags.push("mixed gender duet");
  }

  if (b.timbreHint) tags.push(String(b.timbreHint).slice(0, 28));
  if (b.genre) {
    const g = String(b.genre).split(/[,/×]/)[0].trim().slice(0, 24);
    if (g) tags.push(g);
  }

  return tags.filter(Boolean).slice(0, 8);
}

function genderVocalCue(code) {
  if (code === "female") return "female vocal";
  if (code === "nonbinary") return "androgynous vocal";
  return "male vocal";
}
