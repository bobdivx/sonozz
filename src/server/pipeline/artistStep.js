import { generateVisual } from "../images.js";
import { checkArtistNameAvailability } from "../styleReference.js";
import { isUsableRasterImage, materializeImageForStorage } from "../imagePersist.js";
import { slugify } from "../artists.js";
import { coalesceGenres } from "../../lib/musicLane.js";
import { llmJson, requireTextLlm } from "../llm.js";
import {
  FREE_NAME_PER_ROUND,
  formatNameCollisions,
  resolveFreeGeneratedStageName,
} from "../artistName.js";
import {
  resolveLanguage,
  languagePromptName,
  genderVisualLock,
  normalizeAge,
  normalizeSelfPhotos,
  normalizeVoiceSample,
  serializeStyleLock,
  resolveArtistStyleLock,
  withGenderInPrompt,
  promptJson,
} from "./util.js";

export async function runArtist({
  keys,
  name,
  bioHint,
  trends,
  genre,
  genres,
  language,
  styleArtist,
  styleArtistPick,
  styleArtistPicks,
  styleTrackPick,
  allowTakenName = false,
  mode = "fiction",
  age,
  gender: forcedGender,
  photos = [],
  city,
  legalName,
  voiceSample = null,
  onStatus,
}) {
  requireTextLlm(keys);
  const isSelf = String(mode || "").toLowerCase() === "self";
  const lang = resolveLanguage(language);
  const langName = languagePromptName(lang);
  const userStyles = Array.isArray(genres)
    ? genres.map((g) => String(g || "").trim()).filter(Boolean)
    : String(genre || "")
        .split(/\s*[×xX|/]\s*|\s*,\s*/)
        .map((x) => x.trim())
        .filter(Boolean);
  const forcedName = String(name || "")
    .trim()
    .slice(0, 80);
  const forceTaken = Boolean(allowTakenName);
  const selfAge = normalizeAge(age);
  const selfPhotos = normalizeSelfPhotos(photos);
  const selfVoiceSample = normalizeVoiceSample(voiceSample);

  if (isSelf) {
    if (!forcedName) {
      throw new Error("Indique ton nom de scène.");
    }
    if (!forcedGender) {
      throw new Error("Indique ton sexe / présentation (homme ou femme).");
    }
    if (selfAge == null) {
      throw new Error("Indique un âge valide (13–99).");
    }
    if (!selfPhotos.length) {
      throw new Error("Ajoute au moins une photo de toi.");
    }
  }

  if (forcedName && !forceTaken) {
    const availability = await checkArtistNameAvailability(keys, forcedName);
    if (!availability.available) {
      throw new Error(
        `Le nom « ${forcedName} » est déjà pris sur les plateformes de streaming : ${formatNameCollisions(availability.collisions)}. Choisis un autre nom de scène.`,
      );
    }
  }

  /** @type {Awaited<ReturnType<typeof resolveStyleReference>> | null} */
  let styleLock = await resolveArtistStyleLock({
    keys,
    styleArtist,
    styleArtistPick,
    styleArtistPicks,
    styleTrackPick,
  });

  if (isSelf && !styleLock) {
    throw new Error(
      "Choisis et valide au moins un artiste que tu aimes — le son des morceaux sera calé dessus.",
    );
  }

  const styleArtistHint = String(
    styleArtist ||
      styleArtistPick?.name ||
      (Array.isArray(styleArtistPicks) && styleArtistPicks[0]?.name) ||
      "",
  )
    .trim()
    .slice(0, 120);

  // Mix : DNA de référence (lock) ∪ styles ajoutés par l'utilisateur (jamais un remplacement)
  const lockGenres = Array.isArray(styleLock?.genres) ? styleLock.genres : [];
  const finalGenres = styleLock
    ? coalesceGenres([...lockGenres, ...userStyles])
    : coalesceGenres(userStyles);
  const extrasOnly = userStyles.filter(
    (g) => !lockGenres.some((lg) => String(lg).toLowerCase() === String(g).toLowerCase()),
  );
  const extraStyleNote =
    styleLock && extrasOnly.length
      ? `
STYLES AJOUTÉS PAR L'UTILISATEUR (supplément — à MÉLANGER à la DNA ci-dessus, JAMAIS un remplacement) :
${JSON.stringify(extrasOnly)}
Le mix final = DNA de référence ∪ ces ajouts.`
      : "";
  const finalGenre = styleLock
    ? extrasOnly.length
      ? `${styleLock.genreSummary || lockGenres.join(" × ") || finalGenres.join(" × ")} + ${extrasOnly.join(" + ")}`
      : styleLock.genreSummary || finalGenres.join(" × ")
    : finalGenres.join(" × ");
  const stylePrompt = finalGenres.length
    ? finalGenres.length === 1
      ? finalGenres[0]
      : `fusion cohérente de: ${finalGenres.join(" + ")}`
    : "";

  const selfGenderLock = isSelf ? genderVisualLock(forcedGender, selfAge) : null;
  const favoriteNames = Array.isArray(styleLock?.refs)
    ? styleLock.refs.map((r) => r.matchedName).filter(Boolean)
    : styleLock?.matchedName
      ? [styleLock.matchedName]
      : [];

  const data = await llmJson(
    keys,
    isSelf
      ? `Tu construis le profil artiste d'une PERSONNE RÉELLE qui se recrée comme artiste sur SONOZZ.
Ce n'est PAS un personnage fictionnel inventé : respecte l'identité fournie.

NOM DE SCÈNE OBLIGATOIRE (copie exacte) : "${forcedName}"
"name" et "aka" = exactement "${forcedName}".
${legalName?.trim() ? `Nom légal fourni: "${String(legalName).trim().slice(0, 120)}"` : `legalName = prénom + nom réalistes cohérents avec le sexe (pour la distribution).`}
Âge OBLIGATOIRE: ${selfAge} ans — mentionne-le dans bio / look si pertinent.
Sexe / présentation OBLIGATOIRE: "${selfGenderLock.code}" — voice, look, wardrobe et bio DOIVENT coller.
${city?.trim() ? `Ville / base: "${String(city).trim().slice(0, 80)}"` : "Ville: propose une ville crédible si absente."}

═══ ARTISTES AIMÉS (LOCK STYLE — les morceaux doivent SONNER comme ça) ═══
Favoris: ${favoriteNames.join(" · ") || styleLock?.matchedName}
${
  styleLock
    ? `Match: "${styleLock.matchedName}" (${styleLock.source})
PARAMÈTRES VERROUILLÉS :
- genreSummary: ${styleLock.genreSummary}
- genres: ${JSON.stringify(styleLock.genres)}
- mood: ${styleLock.mood}
- energy: ${styleLock.energy}
- tempoFeel: ${styleLock.tempoFeel || ""}
- bpm: ${styleLock.bpm || "n/a"}
- timbre: ${styleLock.timbre || ""}
- rhythmFeel: ${styleLock.rhythmFeel || ""}
- instruments: ${JSON.stringify(styleLock.instruments || [])}
- production: ${styleLock.production}
- vocalStyle: ${styleLock.vocalStyle}
- vocalRegister: ${styleLock.vocalRegister || ""}
- sonicKeywords: ${JSON.stringify(styleLock.sonicKeywords)}
- writingStyle: ${styleLock.writingStyle}
- influences: ${JSON.stringify(styleLock.influences)}
- INTERDIT: ${JSON.stringify(styleLock.doNot)}
${styleLock.audioListened ? "- DNA audio: extrait preview réellement écouté" : ""}`
    : ""
}${extraStyleNote}
═══════════════════════════════════════════════════════════════════════════

Langue des chansons: ${langName} (code ${lang}).
Indices perso / univers: ${bioHint || "aucun"}
Tendances (secondaires): ${promptJson({})}

Le profil doit parler d'ELLE/LUI à la 3e personne, comme un dossier presse réaliste.
Ne change PAS le sexe ni l'âge. Ne invente PAS un autre visage.

JSON strict:
{
  "name": "${forcedName}",
  "aka": "${forcedName}",
  "legalName": string,
  "gender": "${selfGenderLock.code}",
  "age": ${selfAge},
  "genre": string,
  "genres": [string],
  "language": "${lang}",
  "mood": string,
  "city": string,
  "bio": string,
  "voice": string,
  "palette": ["#hex","#hex","#hex","#hex"],
  "influences": [string, string, string],
  "targetPersona": string,
  "visualIdentity": {
    "look": string,
    "wardrobe": string,
    "photographyStyle": string,
    "logoConcept": string,
    "portraitPrompt": string
  }
}
"genre" DOIT être: "${finalGenre}". "genres" DOIT être: ${JSON.stringify(finalGenres)}.
"mood" proche de: "${styleLock?.mood || ""}". "voice" colle à: "${styleLock?.vocalStyle || selfGenderLock.voiceHint}".
portraitPrompt = anglais, décrit la personne réelle (~${selfAge} ans, ${selfGenderLock.en}), pour retouche éventuelle — square photo, no text.`
      : `Crée un profil d'artiste musical fictionnel mais ultra-réaliste,
avec une identité visuelle cohérente (look, style photo, wardrobe).

${
  forcedName
    ? `NOM DE SCÈNE OBLIGATOIRE (copie exacte) : "${forcedName}"
"name" et "aka" = exactement "${forcedName}".`
    : `Nom de scène : génère un nom crédible, ORIGINAL et rare sur les stores, adapté au marché et au style ci-dessous (PAS le nom de la référence). Évite les prénoms seuls et les mots trop courants : compose un nom inventé / un mononyme distinctif.`
}

${
  styleLock
    ? `═══ LOCK STYLE — ARTISTE RÉEL TROUVÉ (${styleLock.source}, confiance ${styleLock.confidence}) ═══
Requête: "${styleLock.query}"
Match catalogue: "${styleLock.matchedName}"
${styleLock.url ? `URL: ${styleLock.url}` : ""}
${
  styleLock.seedTrack?.title
    ? `MORCEAU SEED (priorité DNA): "${styleLock.seedTrack.title}"${styleLock.seedTrack.artistName ? ` — ${styleLock.seedTrack.artistName}` : ""}`
    : `Titres phares: ${(styleLock.topTracks || []).join(" · ") || "n/a"}`
}
Albums: ${(styleLock.albums || []).join(" · ") || "n/a"}
Related: ${(styleLock.related || []).slice(0, 5).join(", ") || "n/a"}

PARAMÈTRES VERROUILLÉS (copie / respecte STRICTEMENT) :
- genreSummary: ${styleLock.genreSummary}
- genres: ${JSON.stringify(styleLock.genres)}
- mood: ${styleLock.mood}
- energy: ${styleLock.energy}
- tempoFeel: ${styleLock.tempoFeel}
- bpm: ${styleLock.bpm || "n/a"}
- timbre: ${styleLock.timbre || ""}
- rhythmFeel: ${styleLock.rhythmFeel || ""}
- instruments: ${JSON.stringify(styleLock.instruments || [])}
- production: ${styleLock.production}
- vocalStyle: ${styleLock.vocalStyle}
- vocalRegister: ${styleLock.vocalRegister || ""}
- sonicKeywords: ${JSON.stringify(styleLock.sonicKeywords)}
- writingStyle: ${styleLock.writingStyle}
- visualVibe: ${styleLock.visualVibe}
- influences OBLIGATOIRES (dans cet ordre): ${JSON.stringify(styleLock.influences)}
- INTERDIT (doNot): ${JSON.stringify(styleLock.doNot)}
${styleLock.audioListened ? "- Un extrait preview a été ÉCOUTÉ — colle au timbre/groove/BPM ci-dessus." : ""}
${extraStyleNote}

Le nouvel artiste doit sonner comme s'il était dans la MÊME famille que "${styleLock.matchedName}" :
même groove, même énergie, même type de prod, même approche d'écriture.
Identité fictionnelle DISTINCTE (nom, visage, bio) — PAS un clone légal / PAS une parody.
Les tendances charts ci-dessous sont IGNORÉES si elles contredisent ce lock.
═══════════════════════════════════════════════════════════════════════════════`
    : `Style(s) musical(aux) imposé(s): ${stylePrompt || "choisis un style cohérent avec les tendances (explicite et précis)"}`
}

Langue des chansons imposée: ${langName} (code ${lang}) — le catalogue et les paroles seront dans cette langue.
Indices personnalité / univers (PAS le style musical): ${bioHint || "aucun"}
Tendances (contexte marché${styleLock ? " — SECONDARY, ne pas écraser le lock" : ""}): ${promptJson(styleLock ? {} : trends || {})}

IMPORTANT — SEXE / PRÉSENTATION (à ne PAS confondre avec le style musical « genre ») :
- Choisis UN seul gender: "male" | "female" | "nonbinary"${forcedGender ? ` — FORCÉ: "${genderVisualLock(forcedGender, selfAge).code}"` : ""}.
- Tout le profil DOIT coller : name / legalName / aka / bio / voice / look / wardrobe / portraitPrompt.
- Si gender=male → chanteur homme, voix masculine, portrait d'un homme adulte.
- Si gender=female → chanteuse femme, voix féminine, portrait d'une femme adulte.
- Interdit : bio au masculin + portrait féminin (et l'inverse).

JSON strict:
{
  "name": string,
  "aka": string,
  "legalName": string,
  "gender": "male" | "female" | "nonbinary",
  "genre": string,
  "genres": [string],
  "language": "${lang}",
  "mood": string,
  "city": string,
  "bio": string,
  "voice": string,
  "palette": ["#hex","#hex","#hex","#hex"],
  "influences": [string, string, string],
  "targetPersona": string,
  "visualIdentity": {
    "look": string,
    "wardrobe": string,
    "photographyStyle": string,
    "logoConcept": string,
    "portraitPrompt": string
  }
}
${
  styleLock
    ? `"genre" DOIT être: "${finalGenre}". "genres" DOIT être: ${JSON.stringify(finalGenres)}. "mood" DOIT être proche de: "${styleLock.mood}". "voice" DOIT coller à: "${styleLock.vocalStyle}".`
    : finalGenre
      ? `Le champ "genre" DOIT résumer le STYLE MUSICAL: "${finalGenre}". "genres" = ${JSON.stringify(finalGenres)}. Ce n'est PAS le sexe.`
      : ""
}
"language" doit être exactement "${lang}".
legalName = prénom + nom de famille réalistes cohérents avec gender (obligatoire pour la distribution).
portraitPrompt = anglais, DOIT commencer par le sexe explicite ("adult man..." ou "adult woman..." ou androgyne), puis âge, traits, coiffure, tenue, lumière, décor${styleLock?.visualVibe ? ` ; vibe visuelle: ${styleLock.visualVibe}` : ""} ; square photo ; no text in image.`,
  );

  const lock = genderVisualLock(
    isSelf ? forcedGender || data.gender : forcedGender || data.gender,
    isSelf ? selfAge : normalizeAge(data.age) || selfAge,
  );
  const resolvedAge = isSelf ? selfAge : normalizeAge(data.age) || selfAge;

  if (forcedName) {
    data.name = forcedName;
    data.aka = forcedName;
  } else if (data.name && !forceTaken) {
    const styleHint = String(finalGenre || styleLock?.matchedName || "")
      .trim()
      .slice(0, 80);
    const picked = await resolveFreeGeneratedStageName({
      initialName: data.name,
      checkAvailability: (query) => checkArtistNameAvailability(keys, query),
      onStatus,
      proposeNames: ({ blocked, lastName, lastCollisions }) => {
        const taken = formatNameCollisions(lastCollisions);
        const forbidden = blocked.map((n) => `"${n}"`).join(", ");
        return llmJson(
          keys,
          `Le nom de scène "${lastName}" est DÉJÀ PRIS sur Spotify / Apple Music / Deezer${taken ? ` (${taken})` : ""}.
Propose ${FREE_NAME_PER_ROUND} autres noms de scène FICTIONNELS, crédibles${
            styleHint ? `, adaptés au style « ${styleHint} »` : ""
          }, clairement DISTINCTS les uns des autres.
Noms déjà refusés (INTERDITS, y compris variantes orthographiques proches) : ${forbidden}.
Privilégie des noms inventés / composés rares (pas un prénom seul, pas un mot trop courant).
JSON strict: { "names": [string, string, string, string], "name": string, "aka": string }
"name" = le meilleur candidat. "names" = ${FREE_NAME_PER_ROUND} options distinctes. "aka" = le même que "name".`,
        );
      },
    });
    data.name = picked.name;
    data.aka = picked.name;
  }

  if (legalName?.trim()) {
    data.legalName = String(legalName).trim().slice(0, 120);
  }
  if (city?.trim()) {
    data.city = String(city).trim().slice(0, 80);
  }

  // Force paramètres depuis le style lock (la vérité catalogue+LLM)
  const lockedMood = styleLock?.mood || data.mood;
  const lockedVoice = styleLock?.vocalStyle || data.voice || lock.voiceHint;
  const lockedInfluences = styleLock?.influences?.length
    ? styleLock.influences
    : Array.isArray(data.influences)
      ? data.influences.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

  const resolvedGenres = finalGenres.length
    ? finalGenres
    : Array.isArray(data.genres) && data.genres.length
      ? data.genres.map((g) => String(g).trim()).filter(Boolean)
      : [data.genre || "Pop"].filter(Boolean);
  const resolvedGenre = finalGenre || resolvedGenres.join(" × ") || data.genre || "Pop";

  const rawPortrait =
    data.visualIdentity?.portraitPrompt ||
    `Cinematic portrait of music artist ${data.name}, ${resolvedGenre} vibe, ${lockedMood} mood, wardrobe ${data.visualIdentity?.wardrobe || "contemporary streetwear"}, ${data.visualIdentity?.photographyStyle || "film grain night portrait"}, square composition, photorealistic`;
  const portraitPrompt = withGenderInPrompt(rawPortrait, lock.en);

  /** @type {{ imageUrl: string, warning?: string, provider: string }} */
  let portrait;
  /** @type {string[]} */
  let persistedPhotos = [];

  if (isSelf && selfPhotos.length) {
    persistedPhotos = [];
    for (const photo of selfPhotos) {
      try {
        const persisted = await materializeImageForStorage(photo);
        if (persisted && isUsableRasterImage(persisted)) {
          persistedPhotos.push(persisted);
        }
      } catch {
        /* skip bad photo */
      }
    }
    if (!persistedPhotos.length) {
      throw new Error("Impossible de lire tes photos — réessaie avec des JPEG/PNG plus légers.");
    }
    portrait = {
      imageUrl: persistedPhotos[0],
      provider: "user-upload",
      warning: undefined,
    };
  } else {
    portrait = await generateVisual({
      keys,
      prompt: portraitPrompt,
      kind: "portrait",
    });
  }

  const styleArtistNames = favoriteNames.length
    ? favoriteNames
    : styleLock?.matchedName
      ? [styleLock.matchedName]
      : styleArtistHint
        ? [styleArtistHint]
        : [];

  let profile = {
    ...data,
    name: forcedName || data.name,
    aka: forcedName || data.aka,
    gender: lock.code,
    age: resolvedAge || undefined,
    mode: isSelf ? "self" : "fiction",
    genre: resolvedGenre,
    genres: resolvedGenres,
    mood: lockedMood,
    language: lang,
    styleArtist: styleArtistNames[0] || undefined,
    styleArtists: styleArtistNames.length ? styleArtistNames : undefined,
    styleLock: serializeStyleLock(styleLock),
    styleTrack: styleLock?.seedTrack
      ? `${styleLock.seedTrack.title}${styleLock.seedTrack.artistName ? ` — ${styleLock.seedTrack.artistName}` : ""}`
      : undefined,
    influences: lockedInfluences,
    voice: lockedVoice,
    slug: slugify((forcedName || data.aka || data.name) || "artiste"),
    imageUrl: portrait.imageUrl,
    photos: persistedPhotos.length ? persistedPhotos : undefined,
    voiceSample: isSelf && selfVoiceSample ? selfVoiceSample : undefined,
    imageFallback: false,
    imageWarning: portrait.warning,
    imageProvider: portrait.provider,
    localAsset: false,
    portraitPrompt,
    // Label imprint : réglage global, sinon (mode moi) le nom de scène
    recordLabel:
      keys?.distrokidLabel?.trim() ||
      (isSelf ? forcedName || data.name : undefined) ||
      undefined,
    visualIdentity: {
      ...(data.visualIdentity || {}),
      genderLock: lock.en,
      ...(styleLock?.visualVibe ? { vibeFromRef: styleLock.visualVibe } : {}),
      ...(isSelf ? { fromUserPhotos: true } : {}),
    },
  };

  // Timbre figé dès la création IA — sans obliger l’utilisateur à enregistrer sa voix.
  try {
    const { lockSynthesizedTimbre, ensureArtistTimbre } = await import("./artistTimbre.js");
    if (isSelf && selfVoiceSample && keys?.geminiApiKey) {
      const analyzed = await ensureArtistTimbre(keys, profile, { force: true });
      if (analyzed?.artist) profile = analyzed.artist;
    } else {
      profile = lockSynthesizedTimbre(profile);
    }
  } catch (e) {
    console.warn("[timbre] lock à la création:", e.message);
  }

  return profile;
}
