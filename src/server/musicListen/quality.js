import { DEFAULT_GEMINI_TEXT_MODEL, resolveGeminiTextModel } from "../gemini.js";
import { MAX_AUDIO_BYTES, parseJsonLoose, resolveTrackAudioBytes } from "./audio.js";

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
      const { isS3Configured, downloadClipBuffer } = await import("../s3.js");
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
      const { aceStepInferenceForModel, aceStepModelLabel } = await import("../aceStep.js");
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
