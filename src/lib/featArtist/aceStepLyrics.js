import { vocalLockForArtist, contrastSameSexVocalHints, isGospelFeatLock } from "./vocalLock.js";

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
