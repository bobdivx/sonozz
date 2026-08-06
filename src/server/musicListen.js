import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "./gemini.js";

const MAX_AUDIO_BYTES = 12_000_000;

/**
 * Télécharge le morceau (ou utilise un extrait client) pour analyse Gemini.
 * Veo n’accepte PAS d’audio en entrée — on écoute via Gemini, puis on pilote le prompt Veo.
 */
export async function resolveTrackAudioBytes({ audioUrl, audioExcerptBase64, mimeType } = {}) {
  if (audioExcerptBase64) {
    const raw = String(audioExcerptBase64).replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");
    if (!buf.length) throw new Error("Extrait audio vide");
    if (buf.length > MAX_AUDIO_BYTES) throw new Error("Extrait audio trop lourd");
    return {
      mimeType: mimeType || "audio/wav",
      data: buf.toString("base64"),
      bytes: buf.length,
      source: "excerpt",
    };
  }

  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new Error("URL audio du morceau manquante");
  }

  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`Téléchargement audio HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("Fichier audio vide");
  if (buf.length > MAX_AUDIO_BYTES) {
    throw new Error("Fichier audio trop lourd pour analyse (max ~12 Mo) — importe un extrait plus court.");
  }
  const ct = (res.headers.get("content-type") || "audio/mpeg").split(";")[0].trim();
  return {
    mimeType: /audio\//i.test(ct) ? ct : mimeType || "audio/mpeg",
    data: buf.toString("base64"),
    bytes: buf.length,
    source: "url",
  };
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Réponse écoute audio non JSON");
    return JSON.parse(match[0]);
  }
}

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
