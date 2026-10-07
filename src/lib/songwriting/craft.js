/**
 * Règles d’écriture « vrai artiste » : voix, concret, anti-clichés.
 */
import { clicheBanBlock } from "./cliches.js";

function clip(v, n) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : "";
}

function listish(v, n = 300) {
  if (Array.isArray(v)) return clip(v.filter(Boolean).join(", "), n);
  return clip(v, n);
}

/** Bloc « voix d’auteur » de l’artiste (qui écrit, comment il/elle parle). */
export function buildVoiceBlock(artist = {}) {
  const writingVoice = clip(artist?.writingVoice, 600);
  const favorite = listish(artist?.favoriteTopics);
  const avoid = listish(artist?.avoidTopics);
  const lines = [
    "VOIX D’AUTEUR (qui chante — la bio sert à savoir QUI parle et COMMENT, pas DE QUOI parle chaque chanson) :",
  ];
  if (artist?.city) lines.push(`- Ancrage géographique possible: ${clip(artist.city, 80)} (lieux, accents, références locales crédibles — sans en faire le sujet à chaque fois)`);
  if (artist?.age) lines.push(`- Âge: ${artist.age} ans → vocabulaire, références et préoccupations de cet âge`);
  if (artist?.targetPersona) lines.push(`- Public visé: ${clip(artist.targetPersona, 200)}`);
  if (writingVoice) lines.push(`- Manière d’écrire propre à l’artiste (PRIORITAIRE): ${writingVoice}`);
  if (favorite) lines.push(`- Sujets de prédilection (à utiliser parfois, pas toujours): ${favorite}`);
  if (avoid) lines.push(`- Sujets / mots à NE JAMAIS traiter: ${avoid}`);
  lines.push(
    "- writingStyle / lock de référence = flow, registre, longueur de phrase, type de rimes — PAS une liste de sujets imposés.",
    "- Un vrai artiste a un lexique à lui : expressions récurrentes, humour, détails de sa vie. Invente 1–2 tics d’écriture crédibles et garde-les.",
  );
  return lines.join("\n");
}

/** Règles concrètes d’écriture + clichés bannis pour la langue des paroles. */
export function buildWritingRulesBlock(lang = "fr") {
  return `ÉCRITURE (exigence d’un vrai auteur-compositeur, pas d’un générateur) :
- Montre, ne dis pas : pas « je suis triste / j’ai mal / je me sens libre » → une action, un objet, un détail qui le fait sentir.
- Au moins une image concrète et visuelle toutes les 2 lignes (objets, lieux, gestes, couleurs précises, marques génériques, chiffres).
- Spécifique > universel : un objet nommé, un lieu nommé, un détail matériel ou un chiffre plutôt qu’une catégorie générale (« mes souvenirs », « la ville », « les gens »). Invente TES détails — ne recopie aucun exemple de ce brief.
- Verbes précis, peu d’adjectifs, zéro empilement de noms abstraits (rêve, espoir, destin, âme, liberté).
- Le hook doit être une phrase qu’un humain dirait vraiment (tournure parlée, double sens, détail inattendu) — pas un concept.
- Rimes : riches ou assonances, mais JAMAIS au prix du sens ; varie la longueur des lignes ; pas de rimes « -é / -er » en boucle.
- Le couplet 2 doit faire AVANCER l’histoire (nouvelle info, nouveau lieu ou retournement), pas répéter le couplet 1 avec d’autres mots.
- Évite l’ouverture « Dans la nuit / Je marche seul / Encore une fois ».
${clicheBanBlock(lang)}`;
}
