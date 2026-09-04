import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "../gemini.js";
import { parseJsonLoose } from "./audio.js";

/**
 * Analyse un extrait de la VRAIE voix de l’utilisateur (a cappella / micro).
 * Ne doit PAS être envoyé comme prompt_audio SongGen (sinon sortie voix seule).
 * → On en tire un brief timbre texte pour les descriptions.
 */
export async function listenVoiceTimbreFromBytes(
  apiKey,
  { buffer, mimeType = "audio/wav", artistName } = {},
) {
  if (!apiKey?.trim() || !buffer?.length) return null;

  const data = Buffer.isBuffer(buffer)
    ? buffer.toString("base64")
    : Buffer.from(buffer).toString("base64");
  const preferred = resolveGeminiTextModel() || DEFAULT_GEMINI_TEXT_MODEL;
  const models = ["gemini-2.5-flash-lite", preferred, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const textPrompt = `Tu ÉCOUTES un extrait de la VOIX RÉELLE d'une personne (~5–10s, souvent a cappella).
But: décrire le TIMBRE pour guider une génération de chanson COMPLÈTE (voix + instruments) — pas cloner un style instrumental.

Personne: ${artistName || "?"}

JSON strict:
{
  "timbre": string,
  "vocalStyle": string,
  "vocalRegister": "tenor" | "baritone" | "bass" | "alto" | "soprano" | "mezzo" | "spoken-sung" | "mixed" | "unknown",
  "genderFeel": "male" | "female" | "ambiguous",
  "songGenTimbre": string
}

Règles:
- timbre = couleur précise (ex. "warm breathy tenor", "bright raspy baritone").
- songGenTimbre = 3–8 mots ANGLAIS pour le champ timbre SongGeneration (ex. "warm soft tenor", "bright airy mezzo").
- Ignore l'absence d'instruments — ce n'est PAS un style musical à cloner.`;

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
                  {
                    inlineData: {
                      mimeType: /audio\//i.test(mimeType) ? mimeType : "audio/wav",
                      data,
                    },
                  },
                  { text: textPrompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.message || `Écoute voix HTTP ${res.status}`);
      }
      const text =
        payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
        "";
      if (!text.trim()) throw new Error("Gemini n’a renvoyé aucune analyse de voix");
      const parsed = parseJsonLoose(text);
      return {
        timbre: String(parsed.timbre || "").trim(),
        vocalStyle: String(parsed.vocalStyle || "").trim(),
        vocalRegister: String(parsed.vocalRegister || "").trim(),
        genderFeel: String(parsed.genderFeel || "").trim(),
        songGenTimbre: String(parsed.songGenTimbre || parsed.timbre || "")
          .trim()
          .slice(0, 80),
        _meta: { model: m },
      };
    } catch (e) {
      lastError = e;
      console.warn(`[musicListen] voice timbre ${m}:`, e.message);
      if (/spending.?cap|spend.?cap|monthly.?spend/i.test(String(e?.message || ""))) {
        break;
      }
    }
  }

  if (lastError) console.warn("[musicListen] voice timbre failed:", lastError.message);
  return null;
}

/**
 * Analyse la voix PRINCIPALE dans un morceau mixé (voix + instruments).
 * Pour backfill timbre des artistes existants sans extrait a cappella.
 */
export async function listenTrackLeadVocalTimbreFromBytes(
  apiKey,
  { buffer, mimeType = "audio/mpeg", artistName } = {},
) {
  if (!apiKey?.trim() || !buffer?.length) return null;

  const data = Buffer.isBuffer(buffer)
    ? buffer.toString("base64")
    : Buffer.from(buffer).toString("base64");
  const preferred = resolveGeminiTextModel() || DEFAULT_GEMINI_TEXT_MODEL;
  const models = ["gemini-2.5-flash-lite", preferred, "gemini-2.5-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const textPrompt = `Tu ÉCOUTES un MORCEAU MIXÉ (voix + instruments).
But: isoler et décrire UNIQUEMENT le TIMBRE de la voix principale chantée (lead) — ignore guitares, basse, drums, FX.

Artiste déclaré: ${artistName || "?"}

JSON strict:
{
  "timbre": string,
  "vocalStyle": string,
  "vocalRegister": "tenor" | "baritone" | "bass" | "alto" | "soprano" | "mezzo" | "spoken-sung" | "mixed" | "unknown",
  "genderFeel": "male" | "female" | "ambiguous",
  "songGenTimbre": string
}

Règles:
- timbre = couleur précise de la VOIX lead (ex. "warm breathy tenor", "bright raspy baritone").
- songGenTimbre = 3–8 mots ANGLAIS pour le champ timbre SongGeneration.
- N'invente pas d'instruments dans songGenTimbre.
- Si plusieurs voix, décris la plus présente / lead.`;

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
                  {
                    inlineData: {
                      mimeType: /audio\//i.test(mimeType) ? mimeType : "audio/mpeg",
                      data,
                    },
                  },
                  { text: textPrompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error?.message || `Écoute lead vocal HTTP ${res.status}`);
      }
      const text =
        payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
        "";
      if (!text.trim()) throw new Error("Gemini n’a renvoyé aucune analyse de voix lead");
      const parsed = parseJsonLoose(text);
      return {
        timbre: String(parsed.timbre || "").trim(),
        vocalStyle: String(parsed.vocalStyle || "").trim(),
        vocalRegister: String(parsed.vocalRegister || "").trim(),
        genderFeel: String(parsed.genderFeel || "").trim(),
        songGenTimbre: String(parsed.songGenTimbre || parsed.timbre || "")
          .trim()
          .slice(0, 80),
        _meta: { model: m, mode: "track-lead" },
      };
    } catch (e) {
      lastError = e;
      console.warn(`[musicListen] track lead timbre ${m}:`, e.message);
      if (/spending.?cap|spend.?cap|monthly.?spend/i.test(String(e?.message || ""))) {
        break;
      }
    }
  }

  if (lastError) console.warn("[musicListen] track lead timbre failed:", lastError.message);
  return null;
}
