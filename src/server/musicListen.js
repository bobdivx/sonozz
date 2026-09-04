import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "./gemini.js";
import { parseLlmJson } from "./parseLlmJson.js";

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
  return parseLlmJson(text);
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

/**
 * QA Gemini d’un take (bouillie ACE, mash duo, etc.).
 * Écoute l’audio ; contexte métadonnées minimal (sans paroles didascaliques).
 */
export async function analyzeTrackQuality(
  apiKey,
  {
    audioUrl,
    audioS3Key,
    track = null,
    artist = null,
    featArtist = null,
    lyrics = null,
    generation = null,
    model,
  } = {},
) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour analyser le morceau");

  let audio;
  try {
    audio = await resolveTrackAudioBytes({ audioUrl });
  } catch (e) {
    const key = String(audioS3Key || "").trim();
    if (key) {
      const { isS3Configured, downloadClipBuffer } = await import("./s3.js");
      if (isS3Configured()) {
        const dl = await downloadClipBuffer(key);
        const buf = dl.buffer;
        if (!buf?.length) throw new Error("Fichier S3 audio vide");
        if (buf.length > MAX_AUDIO_BYTES) {
          throw new Error("Fichier audio trop lourd pour analyse (max ~12 Mo)");
        }
        audio = {
          mimeType: dl.mimeType || "audio/mpeg",
          data: buf.toString("base64"),
          bytes: buf.length,
          source: "s3",
        };
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  }

  const preferred = resolveGeminiTextModel(model) || DEFAULT_GEMINI_TEXT_MODEL;
  const models = ["gemini-2.5-flash", preferred, "gemini-2.0-flash"].filter(
    (m, i, arr) => arr.indexOf(m) === i,
  );

  const credit = [artist?.name, featArtist?.name].filter(Boolean).join(" feat. ");
  const aceGen =
    (generation && typeof generation === "object" ? generation : null) ||
    (track?.aceGen && typeof track.aceGen === "object" ? track.aceGen : null);

  let inferred = null;
  try {
    const modelId = aceGen?.model || track?.aceStepModel || null;
    if (modelId) {
      const { aceStepInferenceForModel, aceStepModelLabel } = await import("./aceStep.js");
      const infer = aceStepInferenceForModel(modelId);
      inferred = {
        modelLabel: aceStepModelLabel(modelId),
        defaultInferenceSteps: infer.inferenceSteps,
        defaultGuidanceScale: infer.guidanceScale,
        isTurbo: Boolean(infer.isTurbo),
      };
    }
  } catch {
    /* ignore */
  }

  const lyricsText = String(
    aceGen?.lyrics || lyrics?.text || track?.lyrics || "",
  ).trim();

  const generationParams = {
    title: track?.title || null,
    artists: credit || null,
    duo: Boolean(featArtist?.name || aceGen?.duo),
    lead: artist
      ? { name: artist.name || null, gender: artist.gender || null, genre: artist.genre || null }
      : null,
    feat: featArtist?.name
      ? {
          name: featArtist.name,
          gender: featArtist.gender || null,
          genre: featArtist.genre || null,
        }
      : null,
    provider: track?.provider || null,
    model: aceGen?.model || track?.aceStepModel || track?.quality || null,
    modelMeta: inferred,
    pickReason: aceGen?.pickReason || track?.pickReason || null,
    taskType: aceGen?.taskType || (aceGen?.usedReference ? "cover" : null) || null,
    usedReference:
      aceGen?.usedReference != null
        ? Boolean(aceGen.usedReference)
        : track?.usedReference != null
          ? Boolean(track.usedReference)
          : null,
    referenceAudioTitle: aceGen?.referenceAudioTitle || null,
    audioCoverStrength: aceGen?.audioCoverStrength ?? null,
    coverNoiseStrength: aceGen?.coverNoiseStrength ?? null,
    inferenceSteps: aceGen?.inferenceSteps ?? inferred?.defaultInferenceSteps ?? null,
    guidanceScale: aceGen?.guidanceScale ?? inferred?.defaultGuidanceScale ?? null,
    durationSec: aceGen?.durationSec ?? null,
    bpm: aceGen?.bpm ?? track?.bpm ?? null,
    vocalLanguage: aceGen?.vocalLanguage || track?.language || lyrics?.language || null,
    style: aceGen?.style || track?.style || null,
    instruction: aceGen?.instruction || null,
    lyricsExcerpt: lyricsText ? lyricsText.slice(0, 1800) : null,
    gpuAtStart: aceGen?.gpu || null,
    lab: aceGen?.lab ?? null,
    preview: Boolean(track?.isPreview),
    note: "Si aceGen est incomplet (ancien take), les defaults DiT sont déduits du model id.",
  };

  const textPrompt = `Tu es un ingénieur son / QA pour de la musique générée (ACE-Step Studio, SongGen, etc.).

1) Écoute d’abord le fichier audio — c’est la preuve principale (pas de spéculation hors écoute).
2) Croise ensuite avec les PARAMÈTRES DE GÉNÉRATION fournis pour expliquer le défaut et proposer des actions concrètes (ex. cover Spotify en taskType=cover → mur de bruit ; offload CPU / VRAM basse → distorsion numérique ; duo same-sex + tags empilés → mash métallique ; CFG/steps incohérents Turbo vs SFT).

Paramètres de génération (JSON):
${JSON.stringify(generationParams)}

JSON strict:
{
  "verdict": "ok" | "degraded" | "unusable",
  "symptoms": ["..."],
  "likelyCauses": [
    { "cause": "...", "confidence": 0-1, "evidence": "ce que tu entends + lien éventuel avec un param" }
  ],
  "paramIssues": ["params suspects ou absents, sinon []"],
  "structureHeard": "intro/verse/hook… et qui chante si duo",
  "voices": {
    "count": number,
    "distinct": boolean,
    "blendOrMush": boolean,
    "description": "..."
  },
  "production": {
    "muddy": boolean,
    "noiseWall": boolean,
    "distortionDominant": boolean,
    "twoSongsGlued": boolean,
    "instrumentation": "..."
  },
  "lyricsAudible": boolean,
  "recommendations": ["actions concrètes liées aux params si possible, en français"],
  "summary": "2-3 phrases en français"
}`;

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
                      mimeType: /audio\//i.test(audio.mimeType) ? audio.mimeType : "audio/mpeg",
                      data: audio.data,
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
        throw new Error(payload?.error?.message || `Analyse audio HTTP ${res.status}`);
      }
      const text =
        payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("\n") ||
        "";
      if (!text.trim()) throw new Error("Gemini n’a renvoyé aucune analyse");
      const parsed = parseJsonLoose(text);
      return {
        verdict: String(parsed.verdict || "degraded").toLowerCase(),
        symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms.map(String) : [],
        likelyCauses: Array.isArray(parsed.likelyCauses) ? parsed.likelyCauses : [],
        paramIssues: Array.isArray(parsed.paramIssues) ? parsed.paramIssues.map(String) : [],
        structureHeard: String(parsed.structureHeard || "").trim(),
        voices: parsed.voices && typeof parsed.voices === "object" ? parsed.voices : null,
        production:
          parsed.production && typeof parsed.production === "object" ? parsed.production : null,
        lyricsAudible: Boolean(parsed.lyricsAudible),
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations.map(String)
          : [],
        summary: String(parsed.summary || "").trim(),
        generationParams,
        model: m,
        bytes: audio.bytes,
        analyzedAt: new Date().toISOString(),
      };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Analyse audio impossible");
}
