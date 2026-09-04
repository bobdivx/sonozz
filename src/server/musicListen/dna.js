import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "../gemini.js";
import { parseJsonLoose, resolveTrackAudioBytes } from "./audio.js";

/**
 * Écoute un preview catalogue (~30s Deezer/iTunes/Spotify) pour extraire le DNA sonore
 * (timbre, groove, BPM, instruments) — pas seulement des genres tags.
 */
export async function listenArtistPreviewDna(apiKey, { previewUrl, artistName, topTracks } = {}) {
  if (!apiKey?.trim()) return null;
  const url = String(previewUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return null;

  let audio;
  try {
    audio = await resolveTrackAudioBytes({ audioUrl: url });
  } catch (e) {
    console.warn("[musicListen] preview download:", e.message);
    return null;
  }

  const preferred = resolveGeminiTextModel() || DEFAULT_GEMINI_TEXT_MODEL;
  const models = ["gemini-2.5-flash-lite", preferred, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const textPrompt = `Tu ÉCOUTES un extrait preview (~30s) d'un artiste réel pour cloner son STYLE sonore (pas son identité).

Artiste: ${artistName || "?"}
Titres phares connus: ${(Array.isArray(topTracks) ? topTracks : []).slice(0, 5).join(" · ") || "n/a"}

Analyse UNIQUEMENT ce que tu ENTENDS (pas des tags catalogue inventés).

JSON strict:
{
  "bpmEstimate": number,
  "energy": "low" | "mid" | "high",
  "mood": string,
  "timbre": string,
  "vocalStyle": string,
  "vocalRegister": "tenor" | "baritone" | "bass" | "alto" | "soprano" | "mezzo" | "spoken-sung" | "mixed" | "unknown",
  "rhythmFeel": string,
  "instruments": [string, string, string],
  "productionDensity": "sparse" | "mid" | "dense",
  "genreFeel": string
}

Règles:
- bpmEstimate = tempo réel entendu (60–200).
- timbre = couleur / texture de voix (ex. "breathy soft tenor", "raspy mid baritone").
- rhythmFeel = groove précis (ex. "four-on-floor house", "syncopated boom-bap", "halftime trap 808s").
- instruments = 3–6 éléments clairement audibles.
- Si instrumental ou voix peu claire, vocalRegister = "unknown" et timbre décrit la texture globale.`;

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
              temperature: 0.25,
            },
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message || `Écoute preview HTTP ${res.status}`);
      }
      const text =
        data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
        "";
      if (!text.trim()) throw new Error("Gemini n’a renvoyé aucune analyse preview");
      const parsed = parseJsonLoose(text);
      const bpmNum = Number(parsed.bpmEstimate);
      return {
        bpmEstimate:
          Number.isFinite(bpmNum) && bpmNum >= 60 && bpmNum <= 200 ? Math.round(bpmNum) : null,
        energy: ["low", "mid", "high"].includes(parsed.energy) ? parsed.energy : "mid",
        mood: String(parsed.mood || "").trim(),
        timbre: String(parsed.timbre || "").trim(),
        vocalStyle: String(parsed.vocalStyle || "").trim(),
        vocalRegister: String(parsed.vocalRegister || "").trim(),
        rhythmFeel: String(parsed.rhythmFeel || "").trim(),
        instruments: (Array.isArray(parsed.instruments) ? parsed.instruments : [])
          .map((k) => String(k || "").trim())
          .filter(Boolean)
          .slice(0, 8),
        productionDensity: ["sparse", "mid", "dense"].includes(parsed.productionDensity)
          ? parsed.productionDensity
          : "mid",
        genreFeel: String(parsed.genreFeel || "").trim(),
        _meta: {
          model: m,
          audioSource: audio.source,
          audioBytes: audio.bytes,
          mimeType: audio.mimeType,
          previewUrl: url,
        },
      };
    } catch (e) {
      lastError = e;
      console.warn(`[musicListen] preview ${m}:`, e.message);
      if (/spending.?cap|spend.?cap|monthly.?spend/i.test(String(e?.message || ""))) {
        break;
      }
    }
  }

  if (lastError) console.warn("[musicListen] preview DNA failed:", lastError.message);
  return null;
}
