const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * ONCE exige un nom légal complet (writer registrations).
 * Règle : ≥ 2 parties séparées, chaque partie Latin ≥ 2 caractères
 * (une partie 100 % CJK peut être 1 caractère).
 * Renvoie null si aucun candidat valide — l'appelant doit alors demander
 * un nom légal à l'utilisateur au lieu d'en fabriquer un.
 */
export function pickLegalPersonName(...candidates) {
  for (const raw of candidates) {
    const name = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const parts = name.split(/\s+|·/).filter(Boolean);
    if (parts.length < 2) continue;
    const allValid = parts.every((p) => (CJK_SCRIPT.test(p) ? true : p.length >= 2));
    if (allValid) return name;
  }
  return null;
}

/**
 * Crédit Producer (global Paramètres), sinon writer légal, sinon nom d'artiste.
 */
export function resolveProducerName(keys, { writerLegalName = "", artistName = "" } = {}) {
  const fromKeys = String(keys?.distrokidProducerName || "").trim();
  if (fromKeys) return fromKeys;
  const writer = String(writerLegalName || "").trim();
  if (writer) return writer;
  return String(artistName || "").trim() || "Unknown Producer";
}
