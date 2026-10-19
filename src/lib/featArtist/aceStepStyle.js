import {
  vocalLockForArtist,
  soloizeFeatVocalForDuo,
  contrastSameSexVocalHints,
  isGospelFeatLock,
  aceStepSameSexDuoNegatives,
  aceLeadVocalPhrase,
} from "./vocalLock.js";

/** Genre lead raccourci (évite « Afro-trap Électro-Oriental » × 4 dans le prompt). */
function shortGenre(raw, fallback = "hip hop") {
  const g = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!g) return fallback;
  const first = g.split(/[/×,+]| feat\.?/i)[0].trim();
  // Un seul libellé court (Afro-trap, Hip Hop, R&B…)
  const token = first.split(/\s+/).slice(0, 2).join(" ");
  if (token.length <= 18) return token || fallback;
  return first.split(/\s+/)[0].slice(0, 18) || fallback;
}


/**
 * Genre Studio (ACE tags courts). Bob Dominator réel (AllMusic : folk/Viking metal,
 * alternative ; Deezer/Qobuz : electro + rap, orchestrations épiques) — PAS du dubstep.
 * Tests ACE r4 (oct. 2026) : « dark folk metal, alternative rock » donne la voix
 * d'homme rauque (HNR ~6 dB) ; les tags electro/trap/dubstep la rendent propre (HNR 14–21).
 */
function duoStudioGenre(raw, lock) {
  const blob = `${raw || ""} ${(Array.isArray(lock?.genres) ? lock.genres.join(" ") : "")} ${lock?.genreSummary || ""}`.toLowerCase();
  if (/viking|nordic|norse|fjord|scandinav|folk|metal|rock|dark/.test(blob)) {
    return "dark folk metal, alternative rock";
  }
  const parts = [];
  if (/electro-?pop|electropop/.test(blob)) parts.push("electro-pop");
  else if (/electro|edm|electronic|synth.?pop/.test(blob)) parts.push("electro");
  if (/dubstep|brostep/.test(blob)) parts.push("dubstep");
  if (parts.length) return parts.slice(0, 2).join(" ");
  return shortGenre(raw, "electro-pop");
}

/** Bed rock/metal mesuré le plus proche de Bob Dominator (tests r4). */
const DUO_ROCK_BED = ["heavy distorted guitars", "war drums", "deep bass", "epic choir"];

/**
 * Timbre male Studio — vocabulaire rock (rauque/distordu) en tête.
 * Bob Dominator mesuré : F0 ~280 Hz, HNR ~5.7 dB, shimmer ~15 %, F1 ~750 Hz (crié ouvert).
 */
function duoStudioMalePhrase(profile, lockArtist) {
  const blob = [profile?.range, lockArtist?.timbreHint].filter(Boolean).join(" ").toLowerCase();
  const range = /baritone|bass\b/.test(blob) && !/high/.test(blob) ? "baritone" : "tenor";
  return `high-pitched raspy male ${range}, distorted shouted vocals, gravelly belting`;
}

/** Timbre female Studio — « powerful husky » (testé r4 avec la voix d'homme rauque). */
function duoStudioFemalePhrase() {
  return "powerful husky female vocal";
}

function shortBed(leadGenre) {
  const g = leadGenre.toLowerCase();
  if (/trap|drill|hip.?hop|rap|afro/.test(g)) return "808, trap drums, pads";
  if (/r&?b|soul/.test(g)) return "drums, bass, keys, pads";
  if (/gospel/.test(g)) return "drums, bass, piano, organ";
  if (/rock|metal/.test(g)) return "drums, bass, guitars";
  if (/indie|folk|pop|acoustic/.test(g)) return "guitar, bass, drums, keys";
  if (/electro|edm|synth|oriental/.test(g)) return "808, synths, drums, pads";
  return "drums, bass, keys, pads";
}

/** Mots qui poussent ACE vers du RAP : on les remappe en chant rythmé. */
function softenRapPushWords(s) {
  return String(s || "")
    .replace(/\brapped?\b/gi, "sung")
    .replace(/\bspoken\b/gi, "sung")
    .replace(/\bscand[eé]\b/gi, "rhythmic")
    .replace(/chanted-?shouted|shouted chant/gi, "shout-sung")
    .replace(/\bshouted\b/gi, "shout-sung")
    .replace(/\bchanted\b/gi, "rhythmic sung");
}

function firstWordsBed(x) {
  return String(x || "").replace(/\s+(and|with|for|on)\s+.*/i, "").split(/\s+/).slice(0, 3).join(" ");
}

/** Coupe à une frontière de mot / virgule. */
function cutWords(raw, max) {
  const t = String(raw || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const at = Math.max(c.lastIndexOf(","), c.lastIndexOf(";"));
  const cut = at > max * 0.5 ? c.slice(0, at) : c.slice(0, c.lastIndexOf(" "));
  return cut.replace(/[,;:\s]+$/, "");
}

/** Assemble des phrases sans couper au milieu (plafond dure). */
function joinBudget(parts, max) {
  let out = "";
  for (const raw of parts) {
    const p = String(raw || "").trim();
    if (!p) continue;
    const next = out ? `${out}. ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  return out;
}

/**
 * Style ACE-Step duo — DURCI COURT (≤~380c, phrases entières).
 * Les pavés Sister Act / fusion / DNA → mur de bruit + troncature à 700.
 */
export function buildAceStepDuoStyle(lead, feat, { genreSummary, mood, styleLock, styleBase } = {}) {
  const a = vocalLockForArtist(lead);
  let b = vocalLockForArtist(feat);
  if (!a || !b) return "";
  b = soloizeFeatVocalForDuo(b);

  const contrast = contrastSameSexVocalHints(a, b);
  const lock = styleLock && typeof styleLock === "object" ? styleLock : null;
  const leadGenre = shortGenre(
    a.genre || lock?.genreSummary || genreSummary || styleBase,
    "hip hop",
  );
  const featGospel = isGospelFeatLock(b) || /gospel|soul|choir|church/i.test(`${b.genre || ""}`);
  const g1 = contrast.leadTag || a.genderCode || "lead";
  const g2 = contrast.featTag || b.genderCode || "feat";

  // Voix très courtes — les pavés « intelligible lyrics » mangent le budget.
  const leadVoice = featGospel
    ? `dry ${g1} rap`
    : (contrast.leadHint || aceLeadVocalPhrase(a, leadGenre) || "dry natural voice")
        .replace(/,?\s*intelligible lyrics/gi, "")
        .replace(/dry studio take/gi, "dry")
        .slice(0, 48);
  const featVoice = featGospel
    ? "gospel lead, choir on hooks only"
    : (contrast.featHint || aceLeadVocalPhrase(b, b.genre || leadGenre) || "dry natural voice")
        .replace(/,?\s*intelligible lyrics/gi, "")
        .replace(/dry studio take/gi, "dry")
        .slice(0, 48);

  // Artiste DUO (2 voix du même projet) : vrais timbres + instruments du DNA + interaction.
  const internalDuo = Boolean(lead?.duo && (feat?.duoMember || lead?.duoPartner));
  const lockInstr = Array.isArray(lock?.instruments) ? lock.instruments.slice(0, 4).join(", ") : "";
  const bed = featGospel
    ? `${shortBed(leadGenre)}; chorus organ+choir`
    : internalDuo && lockInstr
      ? cutWords(lock.instruments.slice(0, 4).map((x) => firstWordsBed(x)).join(", "), 72)
      : shortBed(leadGenre);
  const profiles = Array.isArray(lead?.vocalProfiles) ? lead.vocalProfiles : [];
  const firstWords = (x, n) => String(x || "").split(/[,;]/)[0].trim().split(/\s+/).slice(0, n).join(" ");
  const duoVoice = (lockArtist, idx) => {
    const p = profiles[idx];
    if (p) {
      return cutWords(
        softenRapPushWords(
          [firstWords(p.range, 3), firstWords(p.texture, 3), firstWords(p.delivery, 4)].filter(Boolean).join(", "),
        ),
        62,
      );
    }
    const t = String(lockArtist?.timbreHint || "").trim();
    const d = String(lockArtist?.vocalStyle || "").trim();
    const txt = [t, d && !t.toLowerCase().includes(d.toLowerCase().slice(0, 12)) ? d : ""]
      .filter(Boolean)
      .join(", ")
      .replace(/conversational|spoken-?word|vocoder/gi, "")
      .replace(/\s*,\s*,/g, ",")
      .trim();
    return cutWords(txt, 62);
  };


  const leadVoiceFinal = internalDuo ? duoVoice(a, 0) || leadVoice : leadVoice;
  const featVoiceFinal = internalDuo ? duoVoice(b, 1) || featVoice : featVoice;
  const interaction = internalDuo
    ? (() => {
        const chorus = String(lead?.duoInteraction?.chorus || "");
        const sum = String(lead?.duoInteraction?.summary || lead?.styleLock?.duoVocals?.interaction || "").trim();
        if (sum && sum.length <= 70) return sum;
        if (chorus === "call-and-response") return "they trade lines, call-and-response hooks";
        if (chorus === "female" || chorus === "male") return `${chorus} voice carries the hook, other answers`;
        return sum ? cutWords(sum, 60) : "alternating verses, both voices on the hook";
      })()
    : "";

  const moodBit = String(mood || lock?.mood || a.mood || "")
    .trim()
    .slice(0, 20);

  const sameSexBit =
    contrast.sameSex && !featGospel
      ? `distinct voices; ${aceStepSameSexDuoNegatives()}`
      : null;

  // Duo interne : noms des MEMBRES (pas le nom du groupe) et les 2 voix AVANT la ligne d'arc
  // (sinon le budget 380c coupe singer 2).
  const name1 = internalDuo ? String(lead?.duoMembers?.[0]?.name || a.name) : a.name;
  const name2 = internalDuo ? String(feat?.name || lead?.duoMembers?.[1]?.name || b.name) : b.name;
  if (internalDuo) {
    // Format ACE Studio (tags courts) — tests r4 : dark folk metal + male rauque distordu.
    // Ordre : genre → male raspy → female → instruments → BPM (pas de noms / pas de pavé).
    const studioGenre = duoStudioGenre(
      a.genre || lock?.genreSummary || genreSummary || styleBase || leadGenre,
      lock,
    );
    const femaleProf = profiles.find((p) => String(p?.gender || "").toLowerCase() === "female") || profiles[0];
    const maleProf = profiles.find((p) => String(p?.gender || "").toLowerCase() === "male") || profiles[1];
    const maleBit = duoStudioMalePhrase(maleProf, g1 === "male" ? a : b);
    const femaleBit = duoStudioFemalePhrase(femaleProf, g1 === "female" ? a : b);
    const studioLockInstr = Array.isArray(lock?.instruments)
      ? lock.instruments
          .slice(0, 4)
          .map((x) => firstWordsBed(x))
          .filter(Boolean)
      : [];
    const rockLane = /metal|rock/.test(studioGenre);
    const genreBed = rockLane
      ? DUO_ROCK_BED
      : /dubstep/.test(studioGenre)
        ? ["wobble bass", "analog synths", "heavy sub bass"]
        : /electro/.test(studioGenre)
          ? ["analog synths", "heavy sub bass"]
          : [];
    const instr = [...new Set([...genreBed, ...studioLockInstr, ...String(bed || "").split(/,\s*/)])]
      .map((x) => String(x || "").trim())
      .filter((x) => x && !/^drums?$/i.test(x) && !/^pads?$/i.test(x) && !(rockLane && /dubstep|wobble/i.test(x)))
      .slice(0, 4);
    const bpmRaw = Number(lock?.bpm || lead?.bpm || lead?.musicArrange?.bpm || 0);
    const bpmBit = bpmRaw >= 60 && bpmRaw <= 200 ? `${Math.round(bpmRaw)} BPM` : null;
    const parts = [
      studioGenre,
      maleBit,
      femaleBit,
      instr.length ? instr.join(", ") : bed,
      bpmBit,
      interaction && /call/.test(interaction) ? "call and response" : null,
    ].filter(Boolean);
    return cutWords(parts.join(", "), 320);
  }

  // Priorité : identité + band + singers + singers. Mood / sameSex optionnels.
  const must = [
    featGospel
      ? `${leadGenre} duet, gospel hooks, ONE clean song`
      : `${leadGenre} duet, ONE lane, full band, clean mix`,
    `band: ${bed}`,
    "instrument layers change: verse sparse → chorus adds layers → thin bridge → densest final",
    `singer 1 ${a.name} (${g1}): ${leadVoiceFinal}`,
    `singer 2 ${b.name} (${g2}): ${featVoiceFinal}`,
    featGospel
      ? "verses=singer1; chorus=singer2 gospel; no two songs glued"
      : "obey [singer 1]/[singer 2]; voices clear",
  ];
  const optional = [moodBit, sameSexBit];

  return joinBudget([...must, ...optional], 380);
}
