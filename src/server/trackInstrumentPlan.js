/**
 * Plan instrumental PAR PISTE (pas les règles ACE globales).
 * Solo : LLM choisit rôle + arc.
 * Album : rôle d’arc imposé, LLM (ou fallback) personnalise arc/lead/features
 * pour que les titres ne se ressemblent pas.
 */
import { llmText, requireTextLlm, isOllamaProvider } from "./llm.js";
import { resolveOllamaModel } from "./ollama.js";
import { parseLlmJson } from "./parseLlmJson.js";
import { FEATURE_TAGS, LEAD_INSTRUMENTS } from "../lib/musicArrange.js";
import {
  SONIC_ROLE_IDS,
  applySonicVariation,
  artistWithSonicVariation,
  normalizeSonicRole,
  composeInstrumentArc,
  albumTrackContrastBit,
} from "../lib/sonicVariation.js";

const FEATURE_IDS = new Set(FEATURE_TAGS.map((f) => f.id));
const LEAD_IDS = new Set(
  LEAD_INSTRUMENTS.map((x) => x.id).filter(Boolean),
);

function canUseTextLlm(keys) {
  if (!keys || typeof keys !== "object") return false;
  if (isOllamaProvider(keys)) return Boolean(resolveOllamaModel(keys));
  return Boolean(String(keys?.geminiApiKey || "").trim());
}

function lyricsSnippet(lyrics, max = 420) {
  const text = String(lyrics?.text || lyrics || "")
    .replace(/\r/g, "")
    .trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function sanitizeArc(raw) {
  let s = String(raw || "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ");
  if (s.length < 24) return null;
  if (!/\b(verse|chorus|bridge|arc|layer|sparse|dens|final|intro)\b/i.test(s)) {
    return null;
  }
  return s.slice(0, 220);
}

function sanitizeFeatures(list) {
  if (!Array.isArray(list)) return [];
  return [
    ...new Set(
      list
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((id) => FEATURE_IDS.has(id)),
    ),
  ].slice(0, 3);
}

function sanitizeLead(raw) {
  const id = String(raw || "")
    .trim()
    .toLowerCase();
  return LEAD_IDS.has(id) ? id : null;
}

/**
 * Demande au LLM un plan pour CETTE piste (JSON court).
 * @param {{ lockRole?: string|null }} opts — album : rôle imposé, LLM ne change que arc/lead/features
 */
async function llmPickTrackPlan(
  keys,
  {
    title,
    theme,
    genre,
    lyrics,
    usedRoles = [],
    usedLeads = [],
    usedArcs = [],
    usedFeatures = [],
    lockRole = null,
    trackIndex = null,
    trackTotal = null,
  },
) {
  const roles = SONIC_ROLE_IDS.join(", ");
  const feats = FEATURE_TAGS.map((f) => f.id).join(", ");
  const leads = LEAD_INSTRUMENTS.map((x) => x.id).filter(Boolean).join(", ");
  const used = (Array.isArray(usedRoles) ? usedRoles : [])
    .map(normalizeSonicRole)
    .filter(Boolean);
  const locked = normalizeSonicRole(lockRole);
  const albumBit =
    Number(trackTotal) > 1
      ? `This is album track ${trackIndex}/${trackTotal}. It MUST sound different from sibling tracks (unique lead + unique section layers).`
      : "";

  const prompt = `You plan INSTRUMENT LAYERS for ONE song (not vocals). Same artist DNA, DIFFERENT arrangement.
Output ONLY JSON: {"role":"...","instrumentArc":"...","features":["..."],"leadInstrument":"..."}
${locked ? `- role: MUST be exactly "${locked}" (album pacing).` : `- role: exactly one of [${roles}]`}
- instrumentArc: ONE English sentence (max 180 chars) — verse → chorus → bridge → final, name instruments that enter/exit. Never "same loop". Must NOT copy previous arcs.
- features: 0–2 ids from [${feats}]
- leadInstrument: one of [${leads}] — prefer unused
Avoid already used roles: ${used.length ? used.join(", ") : "(none)"}.
Avoid already used leads: ${usedLeads.length ? usedLeads.join(", ") : "(none)"}.
Avoid already used features: ${usedFeatures.length ? usedFeatures.join(", ") : "(none)"}.
Previous arcs (do NOT repeat): ${usedArcs.length ? usedArcs.map((a) => `"${String(a).slice(0, 80)}"`).join(" | ") : "(none)"}.
${albumBit}
Genre lane: ${genre || "unknown"}. Title: ${title || "?"}. Theme: ${theme || "?"}.
Lyrics excerpt:
${lyricsSnippet(lyrics) || "(no lyrics)"}`;

  requireTextLlm(keys);
  const raw = await llmText(keys, prompt);
  let parsed;
  try {
    parsed = parseLlmJson(raw);
  } catch {
    return { role: null, instrumentArc: null, features: [], leadInstrument: null, source: "llm-bad" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { role: null, instrumentArc: null, features: [], leadInstrument: null, source: "llm-bad" };
  }
  let role = normalizeSonicRole(parsed.role);
  if (locked) role = locked;
  const instrumentArc = sanitizeArc(parsed.instrumentArc || parsed.arc);
  const features = sanitizeFeatures(parsed.features);
  const leadInstrument = sanitizeLead(parsed.leadInstrument || parsed.lead);
  return {
    role,
    instrumentArc,
    features,
    leadInstrument,
    source: role || instrumentArc || leadInstrument ? "llm" : "llm-empty",
  };
}

/**
 * Résout le plan instrumental de la piste + artiste enrichi pour ACE/SongGen.
 * @returns {Promise<{ artist, variation, source: 'llm'|'deterministic'|'existing' }>}
 */
export async function resolveTrackInstrumentPlan(
  keys,
  {
    artist,
    lyrics = null,
    musicArrange = null,
    title = "",
    explicitRole = null,
    trackIndex = null,
    trackTotal = null,
    usedRoles = [],
    usedLeads = [],
    usedDrums = [],
    usedFeatures = [],
    usedArcs = [],
    /** Si true : skip LLM même si dispo. */
    skipLlm = false,
    preview = false,
  } = {},
) {
  const lead = artist && typeof artist === "object" ? artist : {};
  const arrangeIn = musicArrange ?? lead.musicArrange;
  const styleLock = lead.styleLock || null;
  const trackTitle = String(title || lyrics?.title || "").trim();
  const artistKey = lead.slug || lead.name || "";
  const albumTotal = Number(trackTotal ?? lead.albumTrackTotal) || null;
  const albumIndex = Number(trackIndex ?? lead.albumTrackIndex) || null;
  const albumMode = Number(albumTotal) > 1;
  const usedR = usedRoles.length
    ? usedRoles
    : Array.isArray(lead.usedSonicRoles)
      ? lead.usedSonicRoles
      : [];
  const usedL = usedLeads.length
    ? usedLeads
    : Array.isArray(lead.usedLeads)
      ? lead.usedLeads
      : [];
  const usedD = usedDrums.length
    ? usedDrums
    : Array.isArray(lead.usedDrums)
      ? lead.usedDrums
      : [];
  const usedF = usedFeatures.length
    ? usedFeatures
    : Array.isArray(lead.usedFeatures)
      ? lead.usedFeatures
      : [];
  const usedA = usedArcs.length
    ? usedArcs
    : Array.isArray(lead.usedInstrumentArcs)
      ? lead.usedInstrumentArcs
      : [];

  const forcedRole = normalizeSonicRole(
    explicitRole || lead.trackRoleForced || lead.albumTrackRole,
  );

  // Régénération solo / piste figée : garder le plan (pas album first-pass).
  const lockedArc = String(lead.instrumentArc || "").trim();
  const already =
    lockedArc.length > 20 &&
    normalizeSonicRole(forcedRole || lead.sonicRole) &&
    !lead.forceFreshInstrumentPlan;

  if (already) {
    const variation = applySonicVariation({
      musicArrange: arrangeIn,
      styleLock,
      role: forcedRole || lead.sonicRole,
      title: trackTitle,
      artistKey,
      trackIndex: albumIndex,
      trackTotal: albumTotal,
      usedRoles: usedR,
      usedLeads: usedL,
      usedDrums: usedD,
      usedFeatures: usedF,
      instrumentArc: lockedArc,
    });
    return {
      artist: decorateAlbumArtist(lead, variation, { albumIndex, albumTotal }),
      variation,
      source: "existing",
    };
  }

  let llmPlan = {
    role: null,
    instrumentArc: null,
    features: [],
    leadInstrument: null,
    source: "skip",
  };

  // Album avec rôle imposé : LLM affine quand même arc/lead (anti-clones).
  const wantLlm =
    !skipLlm &&
    !preview &&
    !lockedArc &&
    canUseTextLlm(keys);

  if (wantLlm) {
    try {
      llmPlan = await llmPickTrackPlan(keys, {
        title: trackTitle,
        theme: lyrics?.theme || lead.mood || "",
        genre: styleLock?.genreSummary || lead.genre || "",
        lyrics,
        usedRoles: usedR,
        usedLeads: usedL,
        usedArcs: usedA,
        usedFeatures: usedF,
        lockRole: forcedRole,
        trackIndex: albumIndex,
        trackTotal: albumTotal,
      });
      if (llmPlan.source === "llm") {
        console.info(
          "[track-plan] LLM",
          albumMode ? `album ${albumIndex}/${albumTotal}` : "solo",
          llmPlan.role || forcedRole || "—",
          llmPlan.leadInstrument || "—",
          llmPlan.instrumentArc ? `${llmPlan.instrumentArc.length}c` : "no-arc",
        );
      }
    } catch (e) {
      console.warn("[track-plan] LLM fallback:", e?.message || e);
      llmPlan = {
        role: null,
        instrumentArc: null,
        features: [],
        leadInstrument: null,
        source: "llm-error",
      };
    }
  }

  const role = forcedRole || llmPlan.role || normalizeSonicRole(lead.sonicRole) || undefined;

  let variation = applySonicVariation({
    musicArrange: arrangeIn,
    styleLock,
    role,
    title: trackTitle,
    artistKey,
    trackIndex: albumIndex,
    trackTotal: albumTotal,
    usedRoles: usedR,
    usedLeads: usedL,
    usedDrums: usedD,
    usedFeatures: usedF,
    instrumentArc: llmPlan.instrumentArc || null,
  });

  if (variation.musicArrange?.source !== "manual") {
    const nextArrange = { ...variation.musicArrange };
    if (llmPlan.leadInstrument) {
      nextArrange.leadInstrument = llmPlan.leadInstrument;
    }
    if (llmPlan.features?.length) {
      nextArrange.features = [
        ...new Set([...(nextArrange.features || []), ...llmPlan.features]),
      ].slice(0, 6);
    }
    variation = {
      ...variation,
      musicArrange: nextArrange,
      instrumentArc:
        llmPlan.instrumentArc ||
        composeInstrumentArc(variation.sonicRole, nextArrange),
    };
  }

  const source =
    llmPlan.source === "llm" &&
    (llmPlan.role || llmPlan.instrumentArc || llmPlan.leadInstrument)
      ? "llm"
      : "deterministic";

  return {
    artist: decorateAlbumArtist(lead, variation, { albumIndex, albumTotal }),
    variation,
    source,
  };
}

function decorateAlbumArtist(lead, variation, { albumIndex, albumTotal }) {
  const artist = artistWithSonicVariation(lead, variation);
  const contrast = albumTrackContrastBit({
    trackIndex: albumIndex,
    trackTotal: albumTotal,
    sonicRole: variation.sonicRole,
  });
  if (!contrast) return artist;
  return {
    ...artist,
    albumContrastBit: contrast,
    albumTrackIndex: albumIndex,
    albumTrackTotal: albumTotal,
  };
}
