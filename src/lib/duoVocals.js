/**
 * Artiste DUO (une voix femme + une voix homme) : profils vocaux, interaction, partenaire.
 * Réutilise le pipeline feat/duo existant (featArtist → [singer 1]/[singer 2] ACE-Step).
 */

const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);

export function normalizeVocalists(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((v) => v && typeof v === "object")
    .map((v) => {
      const g = String(v.gender || "").toLowerCase();
      return {
        gender: g === "female" || g === "male" ? g : "unknown",
        range: clip(v.range, 80),
        texture: clip(v.texture, 80),
        delivery: clip(v.delivery, 80),
        effects: clip(v.effects, 60),
        share: ["lead", "co-lead", "backing"].includes(v.share) ? v.share : "lead",
      };
    })
    .slice(0, 4);
}

function mergeVocalist(list) {
  if (!list.length) return null;
  const pick = (k) => {
    const vals = list.map((v) => v[k]).filter(Boolean);
    // le plus détaillé
    return vals.sort((a, b) => b.length - a.length)[0] || "";
  };
  return {
    gender: list[0].gender,
    range: pick("range"),
    texture: pick("texture"),
    delivery: pick("delivery"),
    effects: pick("effects"),
    heardIn: list.length,
  };
}

/**
 * Fusionne les voix entendues sur plusieurs extraits.
 * Duo = au moins une voix lead/co-lead FEMME et une HOMME sur l'ensemble des écoutes.
 * @returns {{ female, male, interaction, listens } | null}
 */
export function mergeDuoVocals(dnas = []) {
  const list = (Array.isArray(dnas) ? dnas : []).filter((d) => d && typeof d === "object");
  const leads = list.flatMap((d) =>
    normalizeVocalists(d.vocalists).filter((v) => v.share !== "backing"),
  );
  const female = mergeVocalist(leads.filter((v) => v.gender === "female"));
  const male = mergeVocalist(leads.filter((v) => v.gender === "male"));
  if (!female || !male) return null;
  const interactions = list.map((d) => clip(d.vocalInteraction, 200)).filter(Boolean);
  return {
    female,
    male,
    interaction: interactions.sort((a, b) => b.length - a.length)[0] || "alternating verses, both on the chorus",
    chorus: duoChorusMode(interactions.join(" ")),
    listens: list.length,
  };
}

/** Qui chante le refrain : "both" (harmonisé) | "call-and-response" | "female" | "male". */
export function duoChorusMode(text = "") {
  const t = String(text || "").toLowerCase();
  if (/call[\s-]*(and|&|-)?[\s-]*response|trade lines|back-and-forth|answer/.test(t)) return "call-and-response";
  if (/(female|woman|she)[^.;,]*(chorus|hook)/.test(t) && !/both|together|harmon/.test(t)) return "female";
  if (/(male|man|he)[^.;,]*(chorus|hook)/.test(t) && !/both|together|harmon/.test(t)) return "male";
  return "both";
}

/** Ligne timbre courte (ACE / SongGen) pour UNE voix. */
export function vocalistTimbreLine(v, max = 70) {
  if (!v) return "";
  const word = (x, n) => {
    const t = clip(x, 200);
    if (t.length <= n) return t;
    const c = t.slice(0, n);
    return c.slice(0, Math.max(c.lastIndexOf(","), c.lastIndexOf(" "))).replace(/[,\s]+$/, "");
  };
  const parts = [v.range, v.texture, v.delivery].map((x) => word(x, 40)).filter(Boolean);
  const out = parts.join(", ");
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "))).replace(/[,\s]+$/, "");
}

export function isDuoArtist(artist) {
  return Boolean(
    artist &&
      typeof artist === "object" &&
      artist.duo &&
      artist.duoPartner &&
      String(artist.duoPartner.name || "").trim(),
  );
}

/**
 * Construit le partenaire (singer 2) d'un duo comme un « featArtist » interne.
 * @param {object} profile profil duo (lead = singer 1)
 * @param {{ name?: string, vocal?: object }} opts
 */
export function buildDuoPartner(profile, { name, vocal } = {}) {
  const v = vocal || profile?.duoVocals?.male || null;
  const gender = v?.gender && v.gender !== "unknown" ? v.gender : "male";
  const timbre = vocalistTimbreLine(v, 80);
  const lock = profile?.styleLock && typeof profile.styleLock === "object" ? profile.styleLock : {};
  return {
    name: clip(name || profile?.duoMembers?.[1]?.name || `${profile?.name || "Duo"} B`, 80),
    gender,
    genre: profile?.genre,
    genres: profile?.genres,
    mood: profile?.mood,
    language: profile?.language,
    voice: clip([v?.delivery, v?.texture, v?.effects].filter(Boolean).join(", "), 160) || undefined,
    styleLock: {
      genreSummary: lock.genreSummary,
      genres: lock.genres,
      mood: lock.mood,
      energy: lock.energy,
      bpm: lock.bpm,
      instruments: lock.instruments,
      timbre: timbre || undefined,
      vocalStyle: clip(v?.delivery, 100) || undefined,
      vocalRegister: clip(v?.range, 40) || undefined,
      writingStyle: lock.writingStyle,
    },
    voiceSample: timbre ? { guideMode: "timbre", songGenTimbre: timbre, analyzedTimbre: timbre, timbreSource: "duo-ref" } : undefined,
    duoMember: true,
  };
}

/**
 * Un artiste duo génère TOUJOURS avec ses deux voix : injecte le partenaire comme feat
 * si aucun feat explicite n'est choisi.
 */
export function withDuoPartner(artist) {
  if (!isDuoArtist(artist)) return artist;
  const feat = artist.featArtist;
  if (feat && typeof feat === "object" && String(feat.name || "").trim()) return artist;
  return { ...artist, featArtist: { ...artist.duoPartner, duoMember: true } };
}

/** Le duo est-il interne (partenaire du même artiste) — pas de « feat. » au crédit. */
export function isInternalDuoFeat(feat) {
  return Boolean(feat && typeof feat === "object" && feat.duoMember);
}

/**
 * Transforme un profil en artiste DUO à partir des voix entendues (styleLock.duoVocals).
 * singer 1 = voix femme (lead A), singer 2 = voix homme (lead B).
 */
export function applyDuoToProfile(profile, { duoVocals, members } = {}) {
  const dv = duoVocals || profile?.styleLock?.duoVocals;
  if (!profile || !dv?.female || !dv?.male) return profile;
  const list = Array.isArray(members) ? members : [];
  const fName = clip(list.find((m) => m?.gender === "female")?.name, 60) || `${profile.name} (voix A)`;
  const mName = clip(list.find((m) => m?.gender === "male")?.name, 60) || `${profile.name} (voix B)`;
  const fLine = vocalistTimbreLine(dv.female, 80);
  const summary = clip(dv.interaction, 200);
  const next = {
    ...profile,
    duo: true,
    gender: "female",
    duoMembers: [
      { name: fName, gender: "female", role: "singer 1" },
      { name: mName, gender: "male", role: "singer 2" },
    ],
    vocalProfiles: [
      { role: "singer 1", name: fName, ...dv.female },
      { role: "singer 2", name: mName, ...dv.male },
    ],
    duoInteraction: { summary, chorus: dv.chorus || duoChorusMode(summary) },
    voice: clip([dv.female.delivery, dv.female.texture, dv.female.effects].filter(Boolean).join(", "), 160) || profile.voice,
    voiceSample: fLine
      ? { ...(profile.voiceSample || {}), guideMode: "timbre", songGenTimbre: fLine, analyzedTimbre: fLine, vocalRegister: dv.female.range || undefined, timbreSource: "duo-ref" }
      : profile.voiceSample,
    styleLock: profile.styleLock
      ? {
          ...profile.styleLock,
          duoVocals: dv,
          timbre: fLine || profile.styleLock.timbre,
          vocalStyle: dv.female.delivery || profile.styleLock.vocalStyle,
        }
      : profile.styleLock,
  };
  next.duoPartner = buildDuoPartner(next, { name: mName, vocal: dv.male });
  return next;
}
