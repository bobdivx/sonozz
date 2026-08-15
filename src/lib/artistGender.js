/** Libellés UI pour le code voix / présentation. */
export const ARTIST_GENDER_LABELS = {
  male: "Homme",
  female: "Femme",
  nonbinary: "Non-binaire",
};

/**
 * Normalise un texte libre (code, FR, EN, genderLock) vers male | female | nonbinary.
 * Ne choisit PAS un défaut : null si vraiment illisible.
 */
export function parseGenderCode(raw) {
  const g = String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  if (!g) return null;
  if (g === "male" || g === "female" || g === "nonbinary") return g;
  if (
    /^(female|woman|femme|f|fille)$/.test(g) ||
    /\bfemale\b|\bfemme\b|\bwoman\b|\bwomen\b|\bgirl\b|\bsoprano\b|\bmezzo\b/.test(g)
  ) {
    return "female";
  }
  if (
    /^(nonbinary|non-binary|nonbinaire|nb|androgyne)$/.test(g) ||
    /\bnon-?binary\b|\bnonbinaire\b|\bandrogyn/.test(g)
  ) {
    return "nonbinary";
  }
  if (
    /^(male|man|homme|m|garcon|masculin)$/.test(g) ||
    /\bmale\b|\bhomme\b|\bman\b|\bmen\b|\bmasculine\b|\bbaritone\b|\btenor\b/.test(g)
  ) {
    return "male";
  }
  return null;
}

/**
 * Voix / sexe déjà enregistrés sur le profil (création, genderLock, voice…).
 * @returns {{ code: "male"|"female"|"nonbinary", label: string } | null}
 */
export function resolveArtistGender(artist) {
  if (!artist || typeof artist !== "object") return null;
  const sources = [
    artist.gender,
    artist.visualIdentity?.gender,
    artist.visualIdentity?.genderLock,
    artist.voice,
    artist.styleLock?.vocalStyle,
  ];
  for (const src of sources) {
    const code = parseGenderCode(src);
    if (code) return { code, label: ARTIST_GENDER_LABELS[code] };
  }
  return null;
}

/** Réécrit `artist.gender` au code canonique si on peut l’inférer du profil sauvé. */
export function withResolvedArtistGender(artist) {
  if (!artist || typeof artist !== "object") return artist;
  const resolved = resolveArtistGender(artist);
  if (!resolved || artist.gender === resolved.code) return artist;
  return { ...artist, gender: resolved.code };
}
