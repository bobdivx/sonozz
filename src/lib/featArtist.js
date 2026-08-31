import { resolveArtistGender, ARTIST_GENDER_LABELS } from "./artistGender.js";
import {
  ACE_COMMERCIAL_LYRICS_STRUCTURE,
  aceStepCommercialArrangementBits,
  composeAceStepStyle,
} from "./musicLane.js";

/**
 * Duo / feat. — deux identités vocales + stylistiques distinctes.
 * Ne jamais fusionner les styleLock (mergeStyleLocks) : le lead garde la lane
 * production ; le feat apporte SA voix et SA couleur, sans écraser le lead.
 */

function slimStyleLock(lock) {
  if (!lock || typeof lock !== "object") return null;
  return {
    matchedName: lock.matchedName || null,
    genreSummary: lock.genreSummary || null,
    genres: Array.isArray(lock.genres) ? lock.genres.slice(0, 6) : undefined,
    mood: lock.mood || null,
    energy: lock.energy || null,
    vocalStyle: lock.vocalStyle || null,
    timbre: lock.timbre || null,
    writingStyle: lock.writingStyle || null,
    rhythmFeel: lock.rhythmFeel || null,
    bpm: lock.bpm ?? null,
    instruments: Array.isArray(lock.instruments) ? lock.instruments.slice(0, 8) : undefined,
    sonicKeywords: Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords.slice(0, 8) : undefined,
    doNot: Array.isArray(lock.doNot) ? lock.doNot.slice(0, 4) : undefined,
    musicPrompt: lock.musicPrompt ? String(lock.musicPrompt).slice(0, 280) : null,
  };
}

function slimVoiceSample(sample) {
  if (!sample || typeof sample !== "object") return null;
  const timbre =
    sample.songGenTimbre || sample.analyzedTimbre || sample.timbreHint || null;
  if (!timbre && !sample.guideMode) return null;
  return {
    guideMode: "timbre",
    songGenTimbre: timbre ? String(timbre).slice(0, 80) : undefined,
    analyzedTimbre: sample.analyzedTimbre
      ? String(sample.analyzedTimbre).slice(0, 80)
      : undefined,
  };
}

/** Snapshot léger depuis une entrée catalogue `/api/artists` ou un profil projet. */
export function snapshotFeatArtist(entry) {
  if (!entry || typeof entry !== "object") return null;
  const profile = entry.profile && typeof entry.profile === "object" ? entry.profile : entry;
  const slug = String(entry.slug || profile.slug || "").trim();
  const name = String(entry.name || profile.name || "").trim();
  if (!name) return null;

  const gender =
    profile.gender ||
    profile.visualIdentity?.gender ||
    profile.visualIdentity?.genderLock ||
    null;

  const photos = Array.isArray(profile.photos) ? profile.photos : [];
  const imageUrl =
    [entry.imageUrl, profile.imageUrl, ...photos]
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .find(
        (u) =>
          /^https?:\/\//i.test(u) ||
          /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(u) ||
          u.startsWith("/api/"),
      ) || undefined;

  return {
    slug: slug || undefined,
    name,
    gender: gender || undefined,
    age: profile.age ?? undefined,
    genre: profile.genre || undefined,
    genres: Array.isArray(profile.genres) ? profile.genres.slice(0, 6) : undefined,
    mood: profile.mood || undefined,
    voice: profile.voice ? String(profile.voice).slice(0, 160) : undefined,
    language: profile.language || undefined,
    imageUrl,
    styleLock: slimStyleLock(profile.styleLock),
    voiceSample: slimVoiceSample(profile.voiceSample),
    visualIdentity: profile.visualIdentity?.genderLock
      ? { genderLock: profile.visualIdentity.genderLock }
      : undefined,
  };
}

export function normalizeFeatArtist(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name || "").trim();
  if (!name) return null;
  return snapshotFeatArtist(raw);
}

export function featuringCredit(feat) {
  const n = String(feat?.name || "").trim();
  return n || "";
}

export function displayArtistCredit(lead, feat) {
  const leadName = String(lead?.name || "").trim() || "Unknown";
  const featName = featuringCredit(feat);
  return featName ? `${leadName} feat. ${featName}` : leadName;
}

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
 * Fragments prompt audio : deux chanteurs nommés, voix non fusionnées.
 * Le genre SongGen reste celui du lead ; le feat est décrit explicitement.
 */
export function duoVocalPromptBits(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return [];

  const leadDesc = [a.voiceHint, vocalTimbreLine(a)].filter(Boolean).join(", ");
  const featDesc = [b.voiceHint, vocalTimbreLine(b)].filter(Boolean).join(", ");

  const bits = [
    `duet featuring two distinct lead singers — never a single singer or anonymous choir`,
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

/**
 * Convertit les cues duo SONOZZ "(Lead)" / "(Feat)" en tags ACE-Step
 * `[singer 1: male]` / `[singer 2: female]` (format recommandé upstream).
 * Évite que le modèle chante les noms d’artistes.
 */
export function prepareAceStepLyrics(text, lead, feat) {
  const raw = String(text || "");
  if (!raw.trim()) return "";

  const a = vocalLockForArtist(lead);
  const b = feat ? vocalLockForArtist(feat) : null;

  const singerGender = (lock) => {
    if (!lock?.genderCode) return "vocal";
    if (lock.genderCode === "female") return "female";
    if (lock.genderCode === "nonbinary") return "androgynous";
    return "male";
  };

  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const leadNames = [a?.name, lead?.name].map(norm).filter(Boolean);
  const featNames = b ? [b.name, feat?.name].map(norm).filter(Boolean) : [];

  const isNameCue = (line) => {
    const inner = line.match(/^\((.+)\)$/);
    if (!inner) return null;
    const n = norm(inner[1]);
    if (!n) return null;
    const both =
      leadNames.some((ln) => n.includes(ln)) && featNames.some((fn) => n.includes(fn));
    if (both) return "duet";
    if (leadNames.some((ln) => n === ln || n.includes(ln))) return "lead";
    if (featNames.some((fn) => n === fn || n.includes(fn))) return "feat";
    if (/&|\/|,|\band\b/i.test(inner[1])) return "duet";
    return "drop";
  };

  const structureRe = /^\[([^\]]+)\]\s*$/i;
  const isSingerTag = (body) => /^singer\s*\d+\s*:/i.test(String(body || "").trim());

  const cleanStructureBody = (tagBody) =>
    String(tagBody || "Verse")
      .replace(/\s*-\s*(male|female|androgynous)?\s*vocals?/gi, "")
      .replace(/\s*-\s*duet.*/i, "")
      .replace(/^singer\s*\d+\s*:.*$/i, "")
      .trim() || "Verse";

  const singerLinesFor = (cue) => {
    if (cue === "duet") {
      return [`[singer 1: ${singerGender(a)}]`, `[singer 2: ${singerGender(b)}]`];
    }
    if (cue === "feat") return [`[singer 2: ${singerGender(b || a)}]`];
    return [`[singer 1: ${singerGender(a)}]`];
  };

  const lines = raw.split(/\r?\n/);
  const out = [];
  let pendingCue = null;

  const attachCueToLastStructure = (cue) => {
    for (let i = out.length - 1; i >= 0; i--) {
      const prev = out[i].trim();
      if (!prev) continue;
      const m = prev.match(structureRe);
      if (!m || isSingerTag(m[1])) {
        pendingCue = cue;
        return false;
      }
      out[i] = `[${cleanStructureBody(m[1])}]`;
      // retire d’anciens singer tags collés juste après
      while (i + 1 < out.length && structureRe.test(out[i + 1].trim()) && isSingerTag(out[i + 1].match(structureRe)?.[1])) {
        out.splice(i + 1, 1);
      }
      out.splice(i + 1, 0, ...singerLinesFor(cue));
      pendingCue = null;
      return true;
    }
    pendingCue = cue;
    return false;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }

    const cue = isNameCue(trimmed);
    if (cue === "drop") continue;
    if (cue) {
      attachCueToLastStructure(cue);
      continue;
    }

    const sm = trimmed.match(structureRe);
    if (sm) {
      if (isSingerTag(sm[1])) continue;
      const body = cleanStructureBody(sm[1]);
      out.push(`[${body}]`);
      if (pendingCue) {
        out.push(...singerLinesFor(pendingCue));
        pendingCue = null;
      }
      continue;
    }

    if (pendingCue) {
      out.push(...singerLinesFor(pendingCue));
      pendingCue = null;
    }
    out.push(line);
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Si les paroles duo n’ont aucun tag [singer N: …], en ajoute sur Verse/Chorus
 * (sinon ACE improvise une seule voix).
 */
export function ensureAceStepDuoSingerTags(text, lead, feat) {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  if (/\[singer\s*\d+\s*:/i.test(raw)) return raw;

  const a = vocalLockForArtist(lead);
  const b = feat ? vocalLockForArtist(feat) : null;
  if (!a || !b) return raw;

  const g = (lock) => {
    if (!lock?.genderCode) return "vocal";
    if (lock.genderCode === "female") return "female";
    if (lock.genderCode === "nonbinary") return "androgynous";
    return "male";
  };
  const g1 = g(a);
  const g2 = g(b);

  const structureRe = /^\[([^\]]+)\]\s*$/i;
  const lines = raw.split(/\r?\n/);
  const out = [];
  let verseN = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(structureRe);
    if (!m) {
      out.push(line);
      continue;
    }
    const body = m[1].trim();
    if (/^singer\s*\d+\s*:/i.test(body)) {
      out.push(line);
      continue;
    }
    out.push(`[${body}]`);
    if (/chorus|hook|refrain/i.test(body)) {
      out.push(`[singer 1: ${g1}]`, `[singer 2: ${g2}]`);
    } else if (/verse|couplet|bridge|pre-?chorus|outro|intro/i.test(body)) {
      verseN += 1;
      out.push(verseN % 2 === 1 ? `[singer 1: ${g1}]` : `[singer 2: ${g2}]`);
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Style ACE-Step duo : d’abord un VRAI titre (prod / instruments),
 * puis le casting vocal. Un prompt 90 % « vocal duet » pousse ACE vers l’a cappella.
 * On n’injecte pas le vocalStyle / matchedName du lock (DNA mono-voix type Eminem).
 */
export function buildAceStepDuoStyle(lead, feat, { genreSummary, mood, styleLock, styleBase } = {}) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return "";

  const leadTimbre = vocalTimbreLine(a) || a.voiceHint;
  const featTimbre = vocalTimbreLine(b) || b.voiceHint;
  const mixed = a.genderCode && b.genderCode && a.genderCode !== b.genderCode;
  const lock = styleLock && typeof styleLock === "object" ? styleLock : null;

  // Prod sans DNA mono-artiste (matchedName / « X style rap ») ni vocalStyle solo.
  let scrubbedBase = String(styleBase || "").trim();
  const bannedName = String(lock?.matchedName || "").trim();
  if (bannedName) {
    scrubbedBase = scrubbedBase.split(bannedName).join("").replace(/\s{2,}/g, " ").trim();
  }
  scrubbedBase = scrubbedBase
    .replace(/\b[\w'.-]+\s+style\b[^.,;]*/gi, "")
    .replace(/\bmale vocals?\b/gi, "")
    .replace(/\bfemale vocals?\b/gi, "")
    .replace(/[,\s]+$/g, "")
    .replace(/^[,\s]+/g, "")
    .trim();

  const duoLock = lock
    ? {
        genreSummary: lock.genreSummary || null,
        sonicKeywords: Array.isArray(lock.sonicKeywords) ? lock.sonicKeywords.slice(0, 6) : undefined,
        production: lock.production || null,
        rhythmFeel: lock.rhythmFeel || null,
        instruments: Array.isArray(lock.instruments) ? lock.instruments.slice(0, 6) : undefined,
        doNot: Array.isArray(lock.doNot) ? lock.doNot : undefined,
        // pas de vocalStyle / matchedName → évite « male rap only »
      }
    : null;

  const genreBlob =
    String(lock?.genreSummary || genreSummary || a.genre || scrubbedBase || "pop, radio-ready").trim();
  const production = composeAceStepStyle(scrubbedBase || genreBlob, duoLock);
  const commercial = aceStepCommercialArrangementBits(lock || { genreSummary: genreBlob }, { duo: true });

  return [
    ...commercial,
    production,
    mood || lock?.mood || a.mood || b.mood || null,
    mixed ? "mixed-gender vocal duet over the full band" : "two-singer vocal duet over the full band",
    `singer 1 (${a.name}): ${a.genderCode || "lead"} — ${leadTimbre}`,
    `singer 2 (${b.name}): ${b.genderCode || "featured"} — ${featTimbre}`,
    a.timbreHint ? `LOCK singer 1 timbre = ${a.timbreHint}` : null,
    b.timbreHint ? `LOCK singer 2 timbre = ${b.timbreHint}` : null,
    `obey [singer 1: ${a.genderCode || "vocal"}] / [singer 2: ${b.genderCode || "vocal"}] tags; keep both voices distinct`,
    `production lane stays with lead ${a.name}${a.genre ? ` (${a.genre})` : ""}`,
  ]
    .filter(Boolean)
    .join(". ")
    .slice(0, 1200);
}

/**
 * Style : lead = lane production dominante ; feat = couleur vocale + genre hint léger.
 * Pas de merge de BPM / instruments / musicPrompt.
 */
export function duoStylePromptBits(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return [];

  const bits = [
    `production lane stays with lead ${a.name}${a.genre ? ` (${a.genre})` : ""}`,
  ];
  if (b.genre) {
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

/** Bloc LLM pour génération de paroles en duo. */
export function duoLyricsInstruction(lead, feat) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return "";

  return `
DUO OBLIGATOIRE — deux chanteurs distincts (ne fusionne JAMAIS en un seul narrateur) :
- Lead « ${a.name} » (${a.genderLabel || "voix lead"}${a.genre ? `, style ${a.genre}` : ""}${a.writingStyle ? `, écriture: ${a.writingStyle}` : ""}${a.vocalStyle ? `, voix: ${a.vocalStyle}` : ""})
- Feat « ${b.name} » (${b.genderLabel || "voix feat"}${b.genre ? `, style ${b.genre}` : ""}${b.writingStyle ? `, écriture: ${b.writingStyle}` : ""}${b.vocalStyle ? `, voix: ${b.vocalStyle}` : ""})
Règles structure dans "text" (titre COMMERCIAL, pas linéaire) :
- Arc obligatoire proche de: ${ACE_COMMERCIAL_LYRICS_STRUCTURE}
- Inclure [Intro] (ambiance / peu de paroles), [Pre-Chorus] (montée), [Bridge] (contraste), [Outro]
- Les 2 couplets ([Verse]) doivent différer (pas le même texte copié)
- Alterne les couplets avec des tags ACE-Step (PAS de ligne "(${a.name})" qui serait chantée) :
  [Verse - ${a.genderCode === "female" ? "female vocal" : a.genderCode === "nonbinary" ? "androgynous vocal" : "male vocal"}]
  [Verse - ${b.genderCode === "female" ? "female vocal" : b.genderCode === "nonbinary" ? "androgynous vocal" : "male vocal"}]
  [Chorus - duet ${a.genderCode || "lead"} and ${b.genderCode || "featured"} vocals]
- Au moins un [Chorus - duet …] chanté par les deux ; le dernier chorus peut être plus long / ad-libs.
- Chaque artiste garde SA personnalité d'écriture et son registre — pas de pastiche croisé.
- Tags structure MiniMax/ACE: [Intro], [Verse], [Pre-Chorus], [Chorus], [Bridge], [Outro] — le genre vocal va DANS le tag avec un tiret, jamais entre parenthèses sur une ligne seule.
- N'écris PAS les noms d'artistes comme paroles à chanter (sauf si c'est un hook volontaire très court).
`.trim();
}
