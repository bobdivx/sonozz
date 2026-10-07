/**
 * Règles d’écriture « vrai artiste » : voix, concret, anti-clichés.
 */
import { clicheBanBlock } from "./cliches.js";
import { FILLER_TAGS, lineRulesFor } from "./defects.js";
import { getLyricsFormPreset } from "../musicLane/lyricsForms.js";

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

/** Métrique / rimes / refrain selon la forme (genre). */
export function buildMeterBlock(form = null) {
  const preset = getLyricsFormPreset(form);
  const rules = lineRulesFor(preset);
  const isRap = preset.id === "rap_trap";
  const hook = preset.hookTag || "Chorus";
  return `MÉTRIQUE & RIMES (c’est une chanson, pas de la prose) :
- Longueur de ligne: ${rules.label} — JAMAIS plus de ${rules.max} mots sur une ligne (hors ad-libs entre parenthèses). Une idée longue = deux lignes.
${
  isRap
    ? `- Couplets de 8 ou 16 mesures (1 ligne = 1 mesure), le MÊME nombre dans chaque [Verse].
- Rimes: chaque ligne rime en fin avec sa voisine (AABB) ; ajoute des rimes internes, multisyllabiques et des assonances ; flow régulier, syllabes comptées.`
    : `- Rimes de fin AABB ou ABAB (assonances OK), lignes de longueur régulière dans une même section pour qu’elles se chantent sur la même mélodie.`
}
- [${hook}]: 2 à 4 lignes COURTES (≤ ${rules.hookMax} mots chacune), punchy, faciles à chanter en chœur ; répété à l’identique à chaque [${hook}] (c’est voulu).`;
}

/** Règles concrètes d’écriture + clichés bannis pour la langue des paroles. */
export function buildWritingRulesBlock(lang = "fr", { form = null, artistName = "" } = {}) {
  const preset = getLyricsFormPreset(form);
  const code = String(lang || "fr").slice(0, 2);
  const fillers = FILLER_TAGS[code] || FILLER_TAGS.fr;
  const fillerList = [...fillers.tagEnd, ...fillers.anywhere].map((f) => `« ${f} »`).join(", ");
  const name = String(artistName || "").trim();
  return `${buildMeterBlock(preset)}
TOUT EST CHANTÉ :
- Aucune didascalie : ne décris JAMAIS le beat, l’instru, la mélodie, la prod, le son qui monte / s’arrête, le silence ou l’ambiance musicale dans les paroles (interdit : « le beat monte », « une mélodie orientale », « Silence. Presque. »). Chaque ligne sous un tag est chantée ou rappée.
- [Intro] / [Outro] = 0 à 3 lignes chantables courtes ou ad-libs entre parenthèses (« (yeah) », « (eh-oh) »), jamais une mise en scène.
- Tics de remplissage en fin de phrase (${fillerList}) : 1 fois MAXIMUM dans toute la chanson.
${
  name
    ? `- L’artiste ne se nomme pas (« ${name} » n’apparaît pas dans les paroles)${preset.id === "rap_trap" ? ", sauf éventuellement UNE signature ad-lib entre parenthèses en intro ou outro" : ""}.`
    : "- L’artiste ne se nomme pas dans ses propres paroles."
}
ÉCRITURE (exigence d’un vrai auteur-compositeur, pas d’un générateur) :
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
