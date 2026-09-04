import { vocalLockForArtist, soloizeFeatVocalForDuo, vocalTimbreLine } from "./vocalLock.js";

/**
 * Fragments prompt audio : deux chanteurs nommés, voix non fusionnées.
 * Le genre SongGen reste celui du lead ; le feat est décrit explicitement.
 */
export function duoVocalPromptBits(lead, feat) {
  const a = vocalLockForArtist(lead);
  let b = vocalLockForArtist(feat);
  if (!a || !b) return [];
  b = soloizeFeatVocalForDuo(b);

  const leadDesc = [a.voiceHint, vocalTimbreLine(a)].filter(Boolean).join(", ");
  const featDesc = [b.voiceHint, vocalTimbreLine(b)].filter(Boolean).join(", ");

  const bits = [
    `duet featuring two distinct lead singers — never collapse the featured part into an anonymous choir`,
    `lead vocalist ${a.name}: ${leadDesc}`,
    `featured vocalist ${b.name}: ${featDesc}`,
    a.timbreHint
      ? `CRITICAL timbre lock for ${a.name}: ${a.timbreHint} — do not swap or average with the other singer`
      : null,
    b.timbreHint
      ? `CRITICAL timbre lock for ${b.name}: ${b.timbreHint} — do not swap or average with the other singer`
      : null,
    `call-and-response and traded verses between ${a.name} and ${b.name}`,
    `keep both vocal identities and timbres clearly separate throughout the mix`,
    `genre fusion is OK (e.g. rap verses + gospel featured hooks) — keep arrangement coherent, not two songs at once`,
    `never collapse into one male-only or one female-only performance`,
  ].filter(Boolean);

  if (a.genderCode && b.genderCode && a.genderCode !== b.genderCode) {
    bits.push(
      `mixed-gender duet: ${a.genderCode} lead (${a.name}) and ${b.genderCode} featured (${b.name}) — BOTH must be clearly audible on their verses and the shared chorus`,
    );
  } else if (a.genderCode && b.genderCode) {
    bits.push(
      `same-gender duet with contrasted timbres between ${a.name} and ${b.name}`,
    );
  }

  return bits;
}
