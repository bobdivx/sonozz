/**
 * Planifie une tracklist d’album à partir du single lead (thèmes distincts).
 * Chaque piste reçoit un brief (angle / point de vue / ton / ancrages) pour que
 * l’album ne soit pas 8 fois la même chanson, et pour ne pas refaire le catalogue.
 */
import { llmJson, requireTextLlm } from "./llm.js";
import {
  SONG_ANGLES,
  SONG_POVS,
  SONG_TONES,
  buildAntiRepeatBlock,
  newsProbability,
  pickSongBrief,
} from "../lib/songwriting/index.js";
import { loadArtistSongHistory, loadArtistWritingSettings } from "./songwriting/history.js";

const ROLES = ["opener", "midtempo", "ballad", "banger", "deep_cut", "midtempo", "banger"];

/** Tracklist de secours : tirage d’angles distincts (plus de liste figée « dernière danse / ville endormie »). */
export function fallbackThemes({ artist, count, history = [], excludeCategories = [], startIndex = 2, total = null, rng = Math.random }) {
  const used = [...excludeCategories];
  const out = [];
  const last = (total || startIndex + count - 1);
  for (let i = 0; i < Math.max(1, count); i++) {
    const recent = [...out.map((t) => t.brief).reverse(), ...history];
    const brief = pickSongBrief({ artist, recent, excludeCategories: used, rng });
    used.push(brief.category);
    const index = startIndex + i;
    out.push({
      theme: brief.angle,
      workingTitle: `Piste ${index}`,
      trackRole: index === last && last > 3 ? "closer" : ROLES[(index - 2) % ROLES.length],
      brief: { ...brief, useNews: false },
    });
  }
  return out;
}

function str(v, n) {
  return String(v ?? "").trim().slice(0, n);
}

/**
 * @returns {Promise<{ albumTitle: string, concept: string, tracks: { theme: string, workingTitle: string, trackRole?: string, brief?: object }[] }>}
 */
export async function planAlbumTracklist({
  keys,
  artist: artistIn,
  leadLyrics,
  leadTrack,
  count = 7,
} = {}) {
  requireTextLlm(keys);
  const n = Math.min(15, Math.max(2, Number(count) || 7));
  const writing = await loadArtistWritingSettings(artistIn?.slug);
  const artist = { ...(artistIn || {}), ...writing };
  const lead = {
    title: leadLyrics?.title || leadTrack?.title || "Single",
    theme: leadLyrics?.theme || leadTrack?.mood || "",
    excerpt: String(leadLyrics?.text || "").slice(0, 600),
  };
  const history = await loadArtistSongHistory({ slug: artist?.slug, name: artist?.name, limit: 12 });
  const newsP = newsProbability(artist);
  const newsSlots = newsP >= 0.5 ? 2 : newsP > 0 ? 1 : 0;
  const categories = [...new Set(SONG_ANGLES.map((a) => a.cat))];

  try {
    const data = await llmJson(
      keys,
      `Tu es A&R / directeur·rice artistique d’un album. Le single lead est validé ; construis le reste d’un album qui ressemble à celui d’un VRAI artiste : une identité forte, mais des chansons qui parlent de choses DIFFÉRENTES.

Artiste: ${JSON.stringify({
        name: artist?.name,
        genre: artist?.genre,
        genres: artist?.genres,
        mood: artist?.mood,
        city: artist?.city,
        age: artist?.age,
        bio: String(artist?.bio || "").slice(0, 900),
        influences: artist?.influences,
        styleArtists: artist?.styleArtists,
        writingVoice: artist?.writingVoice,
        favoriteTopics: artist?.favoriteTopics,
        avoidTopics: artist?.avoidTopics,
      })}
Single lead (ne pas le répéter): ${JSON.stringify(lead)}
${buildAntiRepeatBlock(history, { label: "CATALOGUE EXISTANT" })}

Propose exactement ${n} NOUVELLES pistes (hors lead).
RÈGLES DE DIVERSITÉ (obligatoires) :
- Un concept d’album = un fil rouge (une période de vie, un lieu, une année, une question) — PAS « toutes les chansons parlent de la même chose ».
- Chaque piste a une "category" DIFFÉRENTE, choisie dans : ${categories.join(", ")}. Max 1 piste « amour ».
- Varie le point de vue ("pov" parmi : ${SONG_POVS.join(" | ")}) et le ton ("tone" parmi : ${SONG_TONES.join(" | ")}) : jamais 2 pistes consécutives avec le même pov ou le même ton.
- "theme" = une SITUATION concrète en 1 phrase (un personnage + un lieu + un événement), jamais un sentiment ou un concept (« la solitude », « la nuit », « l’espoir » interdits). Invente des situations propres à CET artiste.
- "anchors" = 2–3 détails concrets à placer dans les paroles (un prénom, un lieu, un objet, un chiffre…).
- Titres : courts, concrets, parlés ; jamais un mot abstrait seul (Liberté, Lumière, Nuit, Rêves…).
${newsSlots ? `- Marque "useNews": true sur ${newsSlots} piste(s) maximum qui partiront d’une actualité récente (choisie plus tard) — sinon false.` : `- "useNews" = false partout.`}
- Varie aussi le rôle sonore (énergie / place dans l’album) — pas 8 fois le même single.

JSON strict:
{
  "albumTitle": string,
  "concept": string,
  "tracks": [
    {
      "theme": string,
      "workingTitle": string,
      "trackRole": "opener" | "midtempo" | "ballad" | "banger" | "deep_cut" | "closer",
      "category": string,
      "pov": string,
      "tone": string,
      "anchors": [string],
      "useNews": boolean
    }
  ]
}
"tracks" doit avoir exactement ${n} éléments.
Le dernier titre devrait souvent être "closer". Évite de mettre "banger" sur toutes les pistes.`,
      { temperature: 1 },
    );

    let newsLeft = newsSlots;
    const tracks = (Array.isArray(data?.tracks) ? data.tracks : [])
      .map((t) => {
        const useNews = Boolean(t?.useNews) && newsLeft > 0;
        if (useNews) newsLeft -= 1;
        const theme = str(t?.theme, 300);
        return {
          theme,
          workingTitle: str(t?.workingTitle || t?.title, 80),
          trackRole: str(t?.trackRole || t?.role, 20) || undefined,
          brief: {
            angleId: "album",
            category: str(t?.category, 40) || undefined,
            angle: theme,
            pov: str(t?.pov, 80),
            tone: str(t?.tone, 60),
            anchors: Array.isArray(t?.anchors) ? t.anchors.map((a) => str(a, 120)).filter(Boolean).slice(0, 4) : [],
            useNews,
          },
        };
      })
      .filter((t) => t.theme)
      .slice(0, n);

    if (tracks.length < n) {
      const pad = fallbackThemes({
        artist,
        count: n - tracks.length,
        history,
        excludeCategories: tracks.map((t) => t.brief?.category).filter(Boolean),
        startIndex: tracks.length + 2,
        total: n + 1,
      });
      tracks.push(...pad);
    }

    return {
      albumTitle: String(data?.albumTitle || `${artist?.name || "Album"}`).slice(0, 80),
      concept: String(data?.concept || "Album construit autour du single lead.").slice(0, 400),
      tracks: tracks.slice(0, n),
    };
  } catch (e) {
    console.warn("[album] plan LLM fallback:", e.message);
    return {
      albumTitle: `${artist?.name || "Album"} — ${lead.title}`,
      concept: "Tracklist de secours (LLM indisponible).",
      tracks: fallbackThemes({ artist, count: n, history, total: n + 1 }),
    };
  }
}
