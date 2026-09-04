import { resolveArtistGender, ARTIST_GENDER_LABELS } from "./artistGender.js";
import {
  ACE_COMMERCIAL_LYRICS_STRUCTURE,
  getLyricsFormPreset,
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

/**
 * Feat gospel / chœur : modèle « Sister Act » — lead gospel CLAIR devant un vrai chœur d’église.
 * Le chœur répond / double le feat ; il ne remplace pas singer 2 et ne fusionne pas avec le rappeur.
 */
export function soloizeFeatVocalForDuo(lock) {
  if (!lock || typeof lock !== "object") return lock;
  const blob = `${lock.vocalStyle || ""} ${lock.timbreHint || ""} ${lock.genre || ""}`;
  if (!/\bgospel\b|\bchoir\b|\bensembl\b|\bchorale\b|\bchurch\b/i.test(blob)) return lock;

  const gender = lock.genderCode === "female" ? "woman" : lock.genderCode === "male" ? "man" : "solo";
  return {
    ...lock,
    vocalStyle:
      "Sister Act style gospel lead: powerful soulful belting in front of a joyful church choir, call-and-response with the choir, melismatic ad-libs — choir answers the lead, never replaces them",
    timbreHint: `resonant ${gender} gospel lead like a church soloist (Sister Act energy), bright and passionate; SATB choir behind on hooks only`,
    voiceHint: lock.voiceHint || "male vocals, man singer",
    genre: lock.genre || "Gospel",
  };
}

/** Feat clairement gospel / soul (pas juste un 2e rappeur). */
export function isGospelFeatLock(lock) {
  if (!lock || typeof lock !== "object") return false;
  const blob = `${lock.genre || ""} ${lock.vocalStyle || ""} ${lock.timbreHint || ""}`.toLowerCase();
  return /gospel|soul|choir|chorale|church|sister act/.test(blob);
}

/** Prod gospel type Sister Act (chœur + orgue + claps) — pour sections feat. */
export function sisterActGospelProductionLine() {
  return [
    "REAL Sister Act / contemporary church gospel on hooks",
    "Hammond B3 organ, piano, handclaps, tambourine",
    "joyful SATB choir call-and-response with the gospel lead",
    "uplifting Sunday-service energy, congregation feel",
    "big choir stacks behind singer 2 only — never blend choir with the rapper",
  ].join("; ");
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
 * Duo même sexe : forcer un contraste de registre (sinon ACE mash métallique).
 * Lead = grave / parlé ; feat = aigu / mélodique (ou l’inverse selon genres).
 */
export function contrastSameSexVocalHints(leadLock, featLock) {
  const a = leadLock && typeof leadLock === "object" ? leadLock : null;
  const b = featLock && typeof featLock === "object" ? featLock : null;
  if (!a?.genderCode || !b?.genderCode || a.genderCode !== b.genderCode) {
    return { sameSex: false, leadHint: null, featHint: null, leadTag: null, featTag: null };
  }
  const g = a.genderCode;
  const leadBlob = `${a.genre || ""} ${a.vocalStyle || ""}`.toLowerCase();
  const featBlob = `${b.genre || ""} ${b.vocalStyle || ""}`.toLowerCase();
  const leadRap = /hip.?hop|rap|trap|drill/.test(leadBlob);
  const featGospel = /gospel|soul|choir|chorale/.test(featBlob);

  if (g === "male") {
    if (leadRap && featGospel) {
      return {
        sameSex: true,
        leadHint:
          "deep baritone spoken-sung rap, dry natural male voice",
        featHint:
          "Sister Act style GOSPEL lead — high tenor church soloist, joyful soulful belting, melismatic runs, testimony shout; choir call-and-response BEHIND them on hooks; featured star of the gospel sections, NOT a second rapper",
        leadTag: "male rap baritone",
        featTag: "male gospel tenor",
      };
    }
    return {
      sameSex: true,
      leadHint: "deep baritone male lead, dry natural voice, clear diction",
      featHint:
        "higher tenor male featured lead, brighter timbre, distinct from singer 1, natural voice",
      leadTag: "male baritone",
      featTag: "male tenor",
    };
  }

  if (g === "female") {
    return {
      sameSex: true,
      leadHint: "low alto / mezzo chest voice, dry natural tone",
      featHint: "bright high mezzo / soprano lead, clear and distinct from singer 1",
      leadTag: "female alto",
      featTag: "female soprano",
    };
  }

  return {
    sameSex: true,
    leadHint: "lower-register lead voice, dry natural tone",
    featHint: "higher-register featured voice, clearly different timbre",
    leadTag: "vocal low",
    featTag: "vocal high",
  };
}

export function aceStepSameSexDuoNegatives() {
  return "two distinct clear natural voices";
}

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

  /** Même sexe : ACE fusionne si les deux tags sont juste « male » — on ajoute le rôle. */
  const sameSex = Boolean(a?.genderCode && b?.genderCode && a.genderCode === b.genderCode);
  const singerTag = (lock, role) => {
    const g = singerGender(lock);
    if (!sameSex) return g;
    const genre = `${lock?.genre || ""} ${lock?.vocalStyle || ""}`.toLowerCase();
    if (role === "feat" && /gospel|soul|choir|chorale/.test(genre)) return `${g} gospel`;
    if (role === "lead" && /hip.?hop|rap|trap|drill/.test(genre)) return `${g} rap`;
    if (role === "feat" && /hip.?hop|rap|trap|drill/.test(genre)) return `${g} rap`;
    if (role === "lead" && /gospel|soul/.test(genre)) return `${g} gospel`;
    return g;
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
    // « A & B » / « A and B » seulement — une virgule de didascalie n’est PAS un duo.
    if (/\band\b|&|\//i.test(inner[1]) && leadNames.length && featNames.length) {
      const hasLead = leadNames.some((ln) => n.includes(ln));
      const hasFeat = featNames.some((fn) => n.includes(fn));
      if (hasLead && hasFeat) return "duet";
    }
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
      return [`[singer 1: ${singerTag(a, "lead")}]`, `[singer 2: ${singerTag(b, "feat")}]`];
    }
    if (cue === "feat") return [`[singer 2: ${singerTag(b || a, "feat")}]`];
    return [`[singer 1: ${singerTag(a, "lead")}]`];
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
 *
 * Important : ne pas faire compter Intro/Outro dans l’alternance Verse —
 * sinon le 1er couplet lead devient singer 2 (ex. rap tagué « gospel » → bouillie).
 */
export function ensureAceStepDuoSingerTags(text, lead, feat) {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  if (/\[singer\s*\d+\s*:/i.test(raw)) return raw;

  const a = vocalLockForArtist(lead);
  const b = feat ? vocalLockForArtist(feat) : null;
  if (!a || !b) return raw;

  const g = (lock, role) => {
    const contrast = contrastSameSexVocalHints(a, b);
    if (contrast.sameSex) {
      return role === "feat" ? contrast.featTag || "male tenor" : contrast.leadTag || "male baritone";
    }
    if (!lock?.genderCode) return "vocal";
    const base =
      lock.genderCode === "female"
        ? "female"
        : lock.genderCode === "nonbinary"
          ? "androgynous"
          : "male";
    const genre = `${lock?.genre || ""} ${lock?.vocalStyle || ""}`.toLowerCase();
    if (role === "feat" && /gospel|soul|choir|chorale/.test(genre)) return `${base} gospel`;
    if (role === "lead" && /hip.?hop|rap|trap|drill/.test(genre)) return `${base} rap`;
    return base;
  };
  const g1 = g(a, "lead");
  const g2 = g(b, "feat");

  const structureRe = /^\[([^\]]+)\]\s*$/i;
  const lines = raw.split(/\r?\n/);

  const sectionHasLyrics = (fromIdx) => {
    for (let i = fromIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim();
      if (!t) continue;
      if (structureRe.test(t)) return false;
      if (/^\[singer\s*\d+\s*:/i.test(t)) continue;
      return true;
    }
    return false;
  };

  const sameSex = Boolean(a.genderCode && b.genderCode && a.genderCode === b.genderCode);
  const featGospel = isGospelFeatLock(b);
  const out = [];
  let verseN = 0;
  /** Lignes lyrics du chorus en cours (same-sex sans gospel feat → call & response). */
  let chorusBuf = null;

  const flushChorus = () => {
    if (!chorusBuf) return;
    const { header, lines: lyricLines } = chorusBuf;
    out.push(...header);
    if (!sameSex || lyricLines.length < 2) {
      out.push(...lyricLines);
    } else {
      // Empiler [singer 1]+[singer 2] sur un hook same-sex → mash métallique ACE.
      // Call & response : une ligne / une voix.
      for (let i = 0; i < lyricLines.length; i++) {
        out.push(i % 2 === 0 ? `[singer 1: ${g1}]` : `[singer 2: ${g2}]`);
        out.push(lyricLines[i]);
      }
    }
    chorusBuf = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const m = trimmed.match(structureRe);

    if (chorusBuf && (!m || /^singer\s*\d+\s*:/i.test(m?.[1] || ""))) {
      if (!trimmed || /^\[singer\s*\d+\s*:/i.test(trimmed)) continue;
      if (!m) {
        chorusBuf.lines.push(line);
        continue;
      }
    }

    if (chorusBuf && m && !/^singer\s*\d+\s*:/i.test(m[1])) {
      flushChorus();
    }

    if (!m) {
      out.push(line);
      continue;
    }
    const body = m[1].trim();
    if (/^singer\s*\d+\s*:/i.test(body)) {
      out.push(line);
      continue;
    }
    const header = [`[${body}]`];
    if (!sectionHasLyrics(i)) {
      out.push(...header);
      continue;
    }

    if (/chorus|hook|refrain/i.test(body)) {
      if (sameSex && featGospel) {
        // Rap × gospel : le feat POSSEDE le refrain (sinon ça sonne 2 rappers).
        out.push(...header, `[singer 2: ${g2}]`);
      } else if (sameSex) {
        chorusBuf = { header, lines: [] };
      } else {
        out.push(...header, `[singer 1: ${g1}]`, `[singer 2: ${g2}]`);
      }
    } else if (/^intro$/i.test(body)) {
      out.push(...header, `[singer 1: ${g1}]`);
    } else if (/^outro$/i.test(body)) {
      out.push(
        ...header,
        featGospel ? `[singer 2: ${g2}]` : `[singer 1: ${g1}]`,
        featGospel ? `[singer 1: ${g1}]` : `[singer 2: ${g2}]`,
      );
    } else if (/verse|couplet/i.test(body)) {
      verseN += 1;
      out.push(
        ...header,
        verseN % 2 === 1 ? `[singer 1: ${g1}]` : `[singer 2: ${g2}]`,
      );
    } else if (/bridge|pre-?chorus|build|break|drop/i.test(body)) {
      out.push(...header, `[singer 2: ${g2}]`);
    } else {
      out.push(...header);
    }
  }
  flushChorus();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

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

/** Bloc LLM pour génération de paroles en duo. */
export function duoLyricsInstruction(lead, feat, form = null) {
  const a = vocalLockForArtist(lead);
  const b = vocalLockForArtist(feat);
  if (!a || !b) return "";

  const preset = getLyricsFormPreset(form);
  const arc = preset?.tagsArc || ACE_COMMERCIAL_LYRICS_STRUCTURE;
  const hookTag = preset?.hookTag || "Chorus";
  const hasVerse = /\[Verse\]/i.test(arc);
  const leadCue = genderVocalCue(a.genderCode);
  const featCue = genderVocalCue(b.genderCode);
  const sameGender = a.genderCode && b.genderCode && a.genderCode === b.genderCode;
  const featGospel = isGospelFeatLock(b);
  const verseLeadTag = sameGender
    ? `[Verse]\n[singer 1: ${a.genderCode}]`
    : `[Verse - ${leadCue}]`;
  const verseFeatTag = sameGender
    ? `[Verse]\n[singer 2: ${b.genderCode}]`
    : `[Verse - ${featCue}]`;

  const verseRules = hasVerse
    ? `- Alterne les couplets avec des tags ACE-Step (PAS de ligne "(${a.name})" qui serait chantée) :
  ${verseLeadTag}
  ${verseFeatTag}
- En duo même sexe, n’utilise JAMAIS deux fois « [Verse - ${leadCue}] » : ACE fusionne les voix.
- Les 2 couplets ([Verse]) doivent différer (pas le même texte copié)`
    : `- Alterne les sections narratives entre lead et feat via tags ACE-Step (PAS de ligne "(${a.name})" chantée) :
  [Build]\n[singer 1: ${a.genderCode || "vocal"}]
  [singer 2: ${b.genderCode || "vocal"}]`;

  const hookRules = featGospel
    ? `- Le [${hookTag}] est chanté UNIQUEMENT par le feat gospel « ${b.name} » (énergie Sister Act / chœur d’église) :
  [${hookTag}]
  [singer 2: ${b.genderCode || "vocal"}]
  (refrain JOYEUX GOSPEL — témoignage, hallelujah / lift d’église, PAS un 2e couplet rap)
- Bridge / Outro : singer 2 en mode gospel lead + chœur qui répond.
- Couplets = rap (singer 1). Sur le refrain on doit ENTENDRE le gospel (orgue, clap, chœur), pas seulement une 2e voix hip-hop.`
    : `- Au moins un [${hookTag}] suivi de [singer 1: ${a.genderCode || "vocal"}] et [singer 2: ${b.genderCode || "vocal"}] (les deux chantent le hook).`;

  return `
DUO OBLIGATOIRE — deux chanteurs distincts (ne fusionne JAMAIS en un seul narrateur) :
- Lead « ${a.name} » (${a.genderLabel || "voix lead"}${a.genre ? `, style ${a.genre}` : ""}${a.writingStyle ? `, écriture: ${a.writingStyle}` : ""}${a.vocalStyle ? `, voix: ${a.vocalStyle}` : ""})
- Feat « ${b.name} » (${b.genderLabel || "voix feat"}${b.genre ? `, style ${b.genre}` : ""}${b.writingStyle ? `, écriture: ${b.writingStyle}` : ""}${b.vocalStyle ? `, voix: ${b.vocalStyle}` : ""})
Règles structure dans "text" (titre COMMERCIAL, forme « ${preset.id} », pas linéaire) :
- Arc obligatoire: ${arc}
- Inclure Intro (ambiance), section contraste si présente dans l'arc (Bridge / Breakdown / Break), Outro
${verseRules}
${hookRules}
- Chaque artiste garde SA personnalité d'écriture et son registre — pas de pastiche croisé.
- N'écris PAS les noms d'artistes comme paroles à chanter (sauf si c'est un hook volontaire très court).
- N'écris PAS de didascalies entre parenthèses (pas de « (Sound of…) » — ACE les chante / les mélange).
`.trim();
}
