import { norm } from "./util.js";
import { isThrashLane, isMetalLane } from "./genres.js";

/**
 * Genre SongGeneration Studio (clés GENRE_TO_AUTO_PROMPT).
 * Tester la chaîne entière : « Rock, Death Metal » doit matcher Metal, pas Rock.
 */
export function mapGenreForStudio(genre = "") {
  const g = norm(genre).trim();
  if (!g) return "Pop";

  if (/afro-?trap|afrobeat|afrobeats|amapiano|dancehall|reggae|ska|\bdub\b/.test(g)) {
    return "Reggae";
  }
  if (/gospel|inspirational|choir|spiritual|worship/.test(g)) return "R&B";
  if (/r&?b|soul|neo-?soul|motown|funk/.test(g)) return "R&B";
  if (
    isThrashLane(g) ||
    /death\s*metal|black\s*metal|thrash|grindcore|metalcore|deathcore|doom\s*metal|heavy\s*metal|\bmetal\b|screamo/.test(
      g,
    ) ||
    (/hardcore/.test(g) && !/techno|house|gabber/.test(g))
  ) {
    return "Metal";
  }
  if (/rock|punk|garage|grunge|britpop|indie rock/.test(g)) return "Rock";
  if (/jazz|bossa|swing|blues/.test(g)) return "Jazz";
  if (/folk|acoustic|chanson|singer-?songwriter|americana|country|bluegrass/.test(g))
    return "Folk";
  if (
    /electro|edm|\bdance\b|house|techno|hyperpop|synth|electronic|trance|dubstep|drum.?and.?bass|ambient|indie electronic/.test(
      g,
    )
  ) {
    return "Electronic";
  }
  if (/latin|reggaeton|salsa|bachata|cumbia/.test(g)) return "Pop";
  if (/hip[\s-]?hop|rap|trap|drill|boom\s*bap|grime/.test(g)) return "Pop";
  if (/chinese|c-pop|mandopop/.test(g)) return "Chinese Style";
  if (/ballad|slow jam|love song/.test(g)) return "R&B";
  if (/pop|variete|variety|k-?pop|j-?pop|dream pop|indie pop/.test(g)) return "Pop";
  return "Pop";
}
