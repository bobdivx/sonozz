/**
 * Planifie une tracklist d’album à partir du single lead (thèmes distincts).
 */
import { llmJson, requireTextLlm } from "./llm.js";

function fallbackThemes({ lead, artist, count }) {
  const base = String(lead?.theme || lead?.title || artist?.mood || "nuit").trim() || "nuit";
  const genre = artist?.genre || "pop";
  const seeds = [
    `${base} — matin après`,
    `distance et silence (${genre})`,
    `souvenir d’été`,
    `course contre soi`,
    `ville endormie`,
    `promesse non tenue`,
    `dernière danse`,
    `lumière froide`,
    `retour impossible`,
    `horizon ouvert`,
    `écho du refrain`,
    `après la fête`,
  ];
  return seeds.slice(0, Math.max(1, count)).map((theme, i) => ({
    theme,
    workingTitle: `Piste ${i + 2}`,
    trackRole: ["opener", "midtempo", "ballad", "banger", "deep_cut", "midtempo", "banger"][i % 7],
  }));
}

/**
 * @returns {Promise<{ albumTitle: string, concept: string, tracks: { theme: string, workingTitle: string }[] }>}
 */
export async function planAlbumTracklist({
  keys,
  artist,
  leadLyrics,
  leadTrack,
  count = 7,
} = {}) {
  requireTextLlm(keys);
  const n = Math.min(15, Math.max(2, Number(count) || 7));
  const lead = {
    title: leadLyrics?.title || leadTrack?.title || "Single",
    theme: leadLyrics?.theme || leadTrack?.mood || "",
    excerpt: String(leadLyrics?.text || "").slice(0, 600),
  };

  try {
    const data = await llmJson(
      keys,
      `Tu es A&R / auteur pour un artiste. Le single lead est validé ; propose le reste d’un album cohérent.

Artiste: ${JSON.stringify({
        name: artist?.name,
        genre: artist?.genre,
        genres: artist?.genres,
        mood: artist?.mood,
        bio: artist?.bio,
        influences: artist?.influences,
        styleArtists: artist?.styleArtists,
      })}
Single lead (ne pas le répéter): ${JSON.stringify(lead)}

Propose exactement ${n} NOUVELLES pistes (hors lead), chacune avec un thème distinct mais dans la même lane artistique.
Pas de reprises du titre lead. Thèmes chantables, concrets, 1 phrase max.
Varie aussi le rôle sonore (énergie / place dans l’album) — pas 8 fois le même single.

JSON strict:
{
  "albumTitle": string,
  "concept": string,
  "tracks": [
    {
      "theme": string,
      "workingTitle": string,
      "trackRole": "opener" | "midtempo" | "ballad" | "banger" | "deep_cut" | "closer"
    }
  ]
}
"tracks" doit avoir exactement ${n} éléments.
Le dernier titre devrait souvent être "closer". Évite de mettre "banger" sur toutes les pistes.`,
    );

    const tracks = (Array.isArray(data?.tracks) ? data.tracks : [])
      .map((t) => ({
        theme: String(t?.theme || "").trim(),
        workingTitle: String(t?.workingTitle || t?.title || "").trim(),
        trackRole: String(t?.trackRole || t?.role || "").trim() || undefined,
      }))
      .filter((t) => t.theme)
      .slice(0, n);

    if (tracks.length < n) {
      const pad = fallbackThemes({ lead, artist, count: n - tracks.length });
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
      tracks: fallbackThemes({ lead, artist, count: n }),
    };
  }
}
