import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "../gemini.js";
import { parseJsonLoose, resolveTrackAudioBytes } from "./audio.js";

/**
 * Gemini écoute l’extrait / le morceau et produit une direction cinéma pour Veo.
 */
export async function listenTrackForVeo(
  apiKey,
  {
    audioUrl,
    audioExcerptBase64,
    mimeType,
    track,
    lyrics,
    durationSec = 28,
    model,
  } = {},
) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour écouter le morceau");

  const audio = await resolveTrackAudioBytes({ audioUrl, audioExcerptBase64, mimeType });
  const preferred = resolveGeminiTextModel(model) || DEFAULT_GEMINI_TEXT_MODEL;
  // flash-lite d’abord : brief JSON suffisant, ~coût multimodal bien plus bas
  const models = ["gemini-2.5-flash-lite", preferred, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const textPrompt = `Tu ÉCOUTES cet extrait audio (~${durationSec}s, début du short TikTok) du morceau créé par l'utilisateur.
Tu dois synchroniser un clip music-video 9:16 sur CE son précis (pas un autre style inventé).

Métadonnées:
- titre: ${track?.title || "?"}
- style déclaré: ${track?.style || "?"}
- bpm déclaré: ${track?.bpm || "?"}
- mood: ${track?.mood || "?"}
- paroles (extrait): ${String(lyrics?.text || "").replace(/\[[^\]]+\]/g, " ").slice(0, 500)}

JSON strict uniquement:
{
  "bpmEstimate": number,
  "energy": "low" | "mid" | "high",
  "structure": string,
  "instruments": string[],
  "vocalPresence": boolean,
  "mood": string,
  "genreFeel": string,
  "visualBeats": [string, string, string, string, string],
  "cameraRhythm": string,
  "veoDirection": string
}

Règles:
- visualBeats = 5 plans EN ANGLAIS (~4–5s chacun) calés sur ce que tu ENTENDS (phrases musicales, montées, refrain). Chaque plan = cutaway / silhouette / paysage / détail / métaphore — INTERDIRE gros plans bouche / lip-sync / chant face caméra.
- veoDirection = 2–4 phrases EN ANGLAIS pour Veo : énergie, mouvement caméra, ambiance, sync sur le beat ; aucun nom de célébrité ; pas de texte à l'écran ; cadre 9:16 plein écran sans letterbox ; pas de lip-sync. Mentionner que le montage sera fait en plans courts assemblés.
- Sois fidèle à l'audio réel (tempo, densité, présence vocale), pas aux seuls tags.`;

  let lastError;
  for (const m of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey.trim()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: audio.mimeType, data: audio.data } },
                  { text: textPrompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.4,
            },
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || `Écoute audio HTTP ${res.status}`);
      }
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
        "";
      if (!text.trim()) throw new Error("Gemini n’a renvoyé aucune analyse audio");
      const parsed = parseJsonLoose(text);
      return {
        ...parsed,
        _meta: {
          model: m,
          audioSource: audio.source,
          audioBytes: audio.bytes,
          mimeType: audio.mimeType,
        },
      };
    } catch (e) {
      lastError = e;
      console.warn(`[musicListen] ${m}:`, e.message);
      if (/spending.?cap|spend.?cap|monthly.?spend/i.test(String(e?.message || ""))) {
        break;
      }
    }
  }

  throw new Error(lastError?.message || "Impossible d’analyser l’audio du morceau");
}

/** Phrase prête à injecter dans le prompt Veo. */
export function formatAudioBriefForVeo(brief) {
  if (!brief || typeof brief !== "object") return "";
  const beats = Array.isArray(brief.visualBeats)
    ? brief.visualBeats.map((s) => String(s).trim()).filter(Boolean).slice(0, 5).join(" → ")
    : "";
  return [
    brief.veoDirection ? String(brief.veoDirection).trim() : "",
    `Heard energy: ${brief.energy || "mid"}; mood ${brief.mood || "emotional"}; feel ${brief.genreFeel || ""}${brief.bpmEstimate ? `; ~${Math.round(brief.bpmEstimate)} BPM` : ""}.`,
    brief.vocalPresence
      ? "Vocals present — prefer wide/mid shots, silhouette, hands on mic; AVOID tight mouth close-ups (no reliable lip-sync)."
      : "Instrumental-leaning — atmosphere and motion.",
    beats ? `Audio-synced beats: ${beats}.` : "",
    brief.cameraRhythm ? `Camera rhythm: ${String(brief.cameraRhythm).slice(0, 160)}.` : "",
    Array.isArray(brief.instruments) && brief.instruments.length
      ? `Instruments heard: ${brief.instruments.slice(0, 6).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}
