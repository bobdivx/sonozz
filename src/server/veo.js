import { GoogleGenAI, GenerateVideosOperation } from "@google/genai";
import sharp from "sharp";
import { resolveReferenceImage } from "./gemini.js";
import { isUsableRasterImage } from "./imagePersist.js";
import { listenTrackForVeo } from "./musicListen.js";

const VEO_MODELS = [
  "veo-3.1-generate-preview",
  "veo-3.1-fast-generate-preview",
  "veo-3.0-generate-001",
];

/** Extrait thème / refrain des paroles (sans tags MiniMax), pour ancrer le clip. */
function lyricsFocus(lyrics, max = 260) {
  const raw = String(lyrics?.text || lyrics || "");
  if (!raw.trim()) return "";
  const chorus = raw.match(/\[Chorus\]([\s\S]*?)(?=\[|$)/i);
  const verse = raw.match(/\[Verse[^\]]*\]([\s\S]*?)(?=\[|$)/i);
  const chunk = (chorus?.[1] || verse?.[1] || raw)
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return chunk.slice(0, max);
}

function sanitizeVisualBit(s, max = 140) {
  return String(s || "")
    .replace(/\b(feat\.?|ft\.?|with)\s+[A-Z][\w'-]+/gi, "")
    .replace(/\bby\s+["']?[\w .'-]{2,40}["']?/gi, "")
    .replace(/["«»]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Prompt cinéma 9:16 — sans noms réels (filtre Veo « celebrity / likeness »).
 * Ancré sur le morceau (style, BPM, paroles, veoPromptHint) + look artiste.
 */
export function buildVeoShortPrompt(
  { artist, track, cover, social, lyrics, audioBrief },
  { safe = false } = {},
) {
  const vi = artist?.visualIdentity || {};
  const palette = (artist?.palette || []).slice(0, 4).join(", ");
  const scenesFromSocial = (social?.scenes || [])
    .slice(0, 3)
    .map((s) => sanitizeVisualBit(s, 120))
    .filter(Boolean);
  const scenesFromAudio = Array.isArray(audioBrief?.visualBeats)
    ? audioBrief.visualBeats.map((s) => sanitizeVisualBit(s, 120)).filter(Boolean)
    : [];
  // Priorité : battements calés sur l’audio entendu
  const scenes = (scenesFromAudio.length ? scenesFromAudio : scenesFromSocial).join(" → ");

  const mood = audioBrief?.mood || track?.mood || artist?.mood || "emotional";
  const genre = audioBrief?.genreFeel || track?.style || artist?.genre || "pop";
  const bpmRaw = audioBrief?.bpmEstimate || track?.bpm;
  const bpm = Number(bpmRaw) > 0 ? Math.round(Number(bpmRaw)) : null;
  const key = track?.key ? String(track.key).slice(0, 8) : "";
  const titleTheme = sanitizeVisualBit(track?.title || lyrics?.title || lyrics?.theme || "", 80);
  const lyricBit = lyricsFocus(lyrics, 220);
  const veoHint = sanitizeVisualBit(social?.veoPromptHint || "", 200);
  const heard = formatAudioBriefInline(audioBrief);
  const look = vi.look || mood || "cinematic";
  const wardrobe = vi.wardrobe || "contemporary stage outfit";
  const photo = vi.photographyStyle || "film grain, shallow depth of field";
  const energyLabel = audioBrief?.energy || "";
  const energy =
    energyLabel === "high" || (bpm && bpm >= 120)
      ? "high-energy, rhythmic camera moves and body language matching the heard beat"
      : energyLabel === "low" || (bpm && bpm <= 85)
        ? "slow, intimate, contemplative pacing matching the heard ballad"
        : "mid-tempo emotional energy locked to the heard groove";

  if (safe) {
    return [
      "Native vertical 9:16 TikTok frame, FULL BLEED edge-to-edge, ZERO letterboxing, ZERO black bars, ZERO widescreen mattes inside the frame.",
      "Photorealistic live-action. The lead is an original fictional musician matching the attached reference image (same face and style).",
      heard
        ? `CRITICAL — visuals MUST match this heard soundtrack excerpt: ${heard}`
        : `Song vibe: ${genre}, ${mood}${bpm ? `, ~${bpm} BPM` : ""}.`,
      titleTheme ? `Song theme (imagery only): ${titleTheme}.` : "",
      lyricBit ? `Lyric imagery: ${lyricBit}.` : "",
      `Look: ${look}. Wardrobe: ${wardrobe}. Motion: ${energy}.`,
      "Prefer wide and mid shots, silhouette, hands, environment — AVOID tight mouth/singing close-ups (no reliable lip-sync).",
      "Cinematic camera. No celebrities, logos, watermarks, or on-screen text.",
      "Do NOT invent a different song — motion follows the provided track energy only.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Native vertical 9:16 TikTok phone frame, FULL BLEED edge-to-edge — ZERO letterboxing, ZERO black bars, ZERO cinematic widescreen crop inside the frame.",
    "Photorealistic live-action music-video short, shot on ARRI Alexa / 35mm cinema lens, portrait orientation only.",
    "Lead performer: original fictional musician matching the attached reference portrait (face, hair, skin tone, age, vibe) — natural pores, real fabric, believable light.",
    heard
      ? `CRITICAL — a real music excerpt was analyzed; MATCH THIS HEARD TRACK: ${heard}`
      : `THIS CLIP MUST MATCH THE SONG — genre ${genre}, mood ${mood}${bpm ? `, ~${bpm} BPM` : ""}${key ? `, key ${key}` : ""}.`,
    `Body language and camera energy locked to audio: ${energy}. Do NOT attempt lip-sync or mouth phonemes.`,
    titleTheme ? `Central theme (visualize, no text): ${titleTheme}.` : "",
    lyricBit ? `Storyboard from lyrics (no readable captions): ${lyricBit}.` : "",
    veoHint ? `Director hint: ${veoHint}.` : "",
    `Visual direction: ${look}; wardrobe ${wardrobe}; photography ${photo}.`,
    `Color world: palette ${palette || "warm brass and deep ink"}, naturalistic color grade, subtle film grain.`,
    cover?.style || cover?.prompt
      ? `Cover art mood (colors/composition only): ${sanitizeVisualBit(cover.style || cover.prompt, 120)}.`
      : "",
    `Narrative beats synced to the music rhythm: ${scenes || "wide establishing → lyric metaphor environment → mid shot silhouette / hands on mic"}.`,
    "Camera: handheld micro-movement + slow push-ins timed to the heard beat. Prefer wide/mid; AVOID tight singing mouth close-ups.",
    "Fictional original character only — not a celebrity.",
    "No logos, watermarks, UI, or on-screen text.",
    "Do not invent another soundtrack; visuals only — the final edit will use the user's real track.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatAudioBriefInline(audioBrief) {
  if (!audioBrief) return "";
  try {
    // import dynamique évité — duplication légère pour garder veo.js autonome
    const beats = Array.isArray(audioBrief.visualBeats)
      ? audioBrief.visualBeats.map((s) => String(s).trim()).filter(Boolean).slice(0, 3).join(" → ")
      : "";
    return [
      audioBrief.veoDirection ? String(audioBrief.veoDirection).trim().slice(0, 400) : "",
      `energy ${audioBrief.energy || "mid"}, mood ${audioBrief.mood || ""}, feel ${audioBrief.genreFeel || ""}`,
      audioBrief.bpmEstimate ? `~${Math.round(audioBrief.bpmEstimate)} BPM` : "",
      beats ? `beats: ${beats}` : "",
    ]
      .filter(Boolean)
      .join(" | ")
      .slice(0, 700);
  } catch {
    return "";
  }
}

const NEGATIVE =
  "celebrity, famous person, real public figure, known actor, named star, cartoon, anime, illustration, slideshow, UI, watermark, logo, text overlay, distorted hands, plastic skin, uncanny valley, morphing face, low quality, oversmoothed, SONOZZ branding, letterboxing, black bars, widescreen matte, cinema bars, lip sync, singing mouth close-up, karaoke face, phoneme mouth shapes, horizontal 16:9 framing";

function client(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/**
 * Compacte l’image pour Veo (JPEG ≤1280).
 * @param {{ optional?: boolean }} [opts] — si optional, 404 → null au lieu de throw
 */
async function toVeoImage(url, { optional = false } = {}) {
  if (!isUsableRasterImage(url)) return null;
  try {
    const ref = await resolveReferenceImage(url);
    if (!ref?.data) return null;

    const raw = Buffer.from(ref.data, "base64");
    const jpeg = await sharp(raw)
      .rotate()
      .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    return {
      imageBytes: jpeg.toString("base64"),
      mimeType: "image/jpeg",
    };
  } catch (e) {
    if (optional) {
      console.warn("[veo] image optionnelle ignorée:", e.message);
      return null;
    }
    throw e;
  }
}

function friendlyVeoError(err) {
  const msg = String(err?.message || err || "");
  if (/expiré|temporaire|Régénère l’étape/i.test(msg)) {
    return msg.slice(0, 400);
  }
  // Plafond mensuel ≠ facturation absente (souvent confondu)
  if (/spending.?cap|spend.?cap|monthly.?spend/i.test(msg)) {
    return (
      "Plafond de dépense mensuel Gemini atteint (pas un souci de « facturation absente »). " +
      "Va sur https://ai.studio/spend → Monthly spend cap → Edit → augmente ou désactive le cap, " +
      "attends ~10 min. Si le plafond de ton Tier (compte) est aussi atteint, il faut attendre le 1er du mois ou monter de Tier. " +
      `Détail: ${msg.slice(0, 180)}`
    );
  }
  if (/billing|payment|paid|enable.?billing|consumer.?paid/i.test(msg)) {
    return `Veo nécessite la facturation Gemini (paid preview). Active la facturation sur AI Studio / Google Cloud. Détail: ${msg.slice(0, 240)}`;
  }
  if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg)) {
    return `Quota Veo dépassé. Attends un peu ou vérifie ton plan / spend cap. Détail: ${msg.slice(0, 240)}`;
  }
  if (/403|PERMISSION|not.+enabled|ACCESS/i.test(msg)) {
    return `Accès Veo refusé — clé ou projet sans droit vidéo. Détail: ${msg.slice(0, 240)}`;
  }
  if (/modèle Veo introuvable|NOT_FOUND/i.test(msg) && !/image|portrait|jaquette|HTTP 404/i.test(msg)) {
    return `Modèle Veo introuvable pour cette clé/région. Détail: ${msg.slice(0, 240)}`;
  }
  return msg.slice(0, 500);
}

async function prepareVeoInputs({
  artist,
  track,
  cover,
  social,
  lyrics,
  safePrompt = false,
  audioBrief = null,
}) {
  const portraitUrl = artist?.imageUrl;
  const coverUrl = cover?.imageUrl;

  if (!isUsableRasterImage(portraitUrl) && !isUsableRasterImage(coverUrl)) {
    throw new Error(
      "Portrait artiste photo requis pour Veo (pas de SVG). Ouvre Modifier le profil et régénère la photo.",
    );
  }

  const prompt = buildVeoShortPrompt(
    { artist, track, cover, social, lyrics, audioBrief },
    { safe: safePrompt },
  );

  // Portrait obligatoire ; si URL morte, tenter la jaquette comme ancre visuelle
  let portrait = null;
  let portraitError = null;
  if (isUsableRasterImage(portraitUrl)) {
    try {
      portrait = await toVeoImage(portraitUrl);
    } catch (e) {
      portraitError = e;
      console.warn("[veo] portrait KO:", e.message);
    }
  }

  // En mode safe : pas de jaquette en ref (évite prompts cover avec noms)
  const coverImg =
    !safePrompt && isUsableRasterImage(coverUrl)
      ? await toVeoImage(coverUrl, { optional: true })
      : null;

  if (!portrait && coverImg) {
    portrait = coverImg;
    console.info("[veo] fallback : jaquette utilisée comme frame de départ");
  }

  if (!portrait) {
    throw new Error(
      portraitError?.message ||
        "Impossible de charger le portrait pour Veo. Ouvre Modifier le profil (photo durable), puis relance.",
    );
  }

  return {
    prompt,
    portrait,
    coverImg: coverImg && coverImg !== portrait ? coverImg : null,
    usedPortrait: Boolean(portraitUrl && !portraitError),
    usedCover: Boolean(coverImg),
    safePrompt: Boolean(safePrompt),
    audioBrief,
  };
}

function isUsableAudioBrief(brief) {
  if (!brief || typeof brief !== "object") return false;
  return Boolean(
    brief.veoDirection ||
      brief.energy ||
      brief.mood ||
      (Array.isArray(brief.visualBeats) && brief.visualBeats.length),
  );
}

/**
 * Démarre Veo via le SDK officiel (@google/genai).
 * Modes : i2v (portrait animé) → refs → texte.
 * Avant génération : Gemini écoute l’extrait (réutilisé si déjà en cache social).
 */
export async function startVeoShort({
  apiKey,
  artist,
  track,
  cover,
  social,
  lyrics,
  safePrompt = false,
  audioExcerptBase64,
  audioExcerptMimeType,
  forceAudioListen = false,
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");

  let audioBrief = null;
  let audioListenWarning;
  let reusedAudioBrief = false;
  const cached = social?.audioBrief || social?.veo?.audioBrief || null;
  if (!forceAudioListen && isUsableAudioBrief(cached)) {
    audioBrief = cached;
    reusedAudioBrief = true;
    console.info(
      `[veo] audio brief réutilisé (éco) · energy=${audioBrief?.energy} · bpm≈${audioBrief?.bpmEstimate}`,
    );
  } else if (track?.audioUrl || audioExcerptBase64) {
    try {
      console.info("[veo] écoute du morceau (Gemini)…");
      audioBrief = await listenTrackForVeo(apiKey.trim(), {
        audioUrl: track?.audioUrl,
        audioExcerptBase64,
        mimeType: audioExcerptMimeType,
        track,
        lyrics,
        durationSec: 28,
      });
      console.info(
        `[veo] audio brief ok · energy=${audioBrief?.energy} · bpm≈${audioBrief?.bpmEstimate}`,
      );
    } catch (e) {
      audioListenWarning = e.message || "Écoute audio impossible";
      console.warn("[veo] écoute audio skip:", audioListenWarning);
    }
  }

  const inputs = await prepareVeoInputs({
    artist,
    track,
    cover,
    social,
    lyrics,
    safePrompt,
    audioBrief,
  });
  const ai = client(apiKey.trim());
  const errors = [];

  const attempts = [];
  for (const model of VEO_MODELS) {
    // 1) Image→vidéo : anime le portrait (vrai clip)
    attempts.push({
      model,
      mode: "i2v",
      params: {
        model,
        prompt: inputs.prompt,
        image: inputs.portrait,
        config: {
          aspectRatio: "9:16",
          durationSeconds: 8,
          personGeneration: "allow_adult",
          negativePrompt: NEGATIVE,
          numberOfVideos: 1,
        },
      },
    });

    // 2) Références (Veo 3.1) — skip en mode safe (moins de risque likeness)
    if (!safePrompt && !model.startsWith("veo-3.0")) {
      const refs = [{ image: inputs.portrait, referenceType: "ASSET" }];
      if (inputs.coverImg) {
        refs.push({ image: inputs.coverImg, referenceType: "ASSET" });
      }
      attempts.push({
        model,
        mode: "refs",
        params: {
          model,
          prompt: inputs.prompt,
          config: {
            aspectRatio: "9:16",
            durationSeconds: 8,
            personGeneration: "allow_adult",
            negativePrompt: NEGATIVE,
            numberOfVideos: 1,
            referenceImages: refs,
          },
        },
      });
    }

    // 3) Texte seul — skip en safe (sans image le filtre celebrity est pire)
    if (!safePrompt) {
      attempts.push({
        model,
        mode: "text",
        params: {
          model,
          prompt: inputs.prompt,
          config: {
            aspectRatio: "9:16",
            durationSeconds: 8,
            personGeneration: "allow_adult",
            negativePrompt: NEGATIVE,
            numberOfVideos: 1,
          },
        },
      });
    }
  }

  for (const attempt of attempts) {
    try {
      console.info(
        `[veo] start ${attempt.model} mode=${attempt.mode}${safePrompt ? " safe" : ""}…`,
      );
      const operation = await ai.models.generateVideos(attempt.params);
      if (!operation?.name) {
        throw new Error("Pas d’operation name renvoyée");
      }
      return {
        operationName: operation.name,
        model: attempt.model,
        mode: attempt.mode,
        prompt: inputs.prompt,
        safePrompt: Boolean(safePrompt),
        usedPortrait: attempt.mode !== "text",
        usedCover: attempt.mode === "refs" ? inputs.usedCover : false,
        audioBrief: audioBrief
          ? {
              energy: audioBrief.energy,
              bpmEstimate: audioBrief.bpmEstimate,
              mood: audioBrief.mood,
              genreFeel: audioBrief.genreFeel,
              vocalPresence: audioBrief.vocalPresence,
              visualBeats: audioBrief.visualBeats,
              veoDirection: audioBrief.veoDirection,
              cameraRhythm: audioBrief.cameraRhythm,
              instruments: audioBrief.instruments,
            }
          : null,
        warning: [
          reusedAudioBrief
            ? "Brief audio réutilisé (économie) → prompt Veo."
            : audioBrief
              ? "Morceau écouté (Gemini) → prompt Veo calé sur l’extrait."
              : "",
          audioListenWarning ? `Écoute audio: ${audioListenWarning}` : "",
          safePrompt ? "Prompt sécurisé (sans noms) — filtre celebrity contourné." : "",
          attempt.mode === "text" ? "Génération texte→vidéo (sans ancrage image)." : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
      };
    } catch (e) {
      const friendly = friendlyVeoError(e);
      console.error(`[veo] ${attempt.model}/${attempt.mode}:`, friendly);
      errors.push(`${attempt.model}/${attempt.mode}: ${friendly}`);
      // Plafond mensuel / billing : inutile de tester les autres modèles
      if (/spending.?cap|spend.?cap|monthly.?spend|billing|payment|enable.?billing/i.test(
        String(e?.message || e || "") + friendly,
      )) {
        break;
      }
    }
  }

  throw new Error(
    [
      "Veo 3 n’a pas pu démarrer.",
      errors[0] || "erreur inconnue",
      /spend|cap|quota|429/i.test(errors[0] || "")
        ? "Alternative : bascule sur Seedance (Replicate) dans Clips, ou augmente le cap sur https://ai.studio/spend."
        : "Veo = paid preview : facturation + clé du projet payant sur https://aistudio.google.com",
    ].join(" — "),
  );
}

export async function downloadVeoVideo(apiKey, uri) {
  const res = await fetch(uri, {
    headers: { "x-goog-api-key": apiKey },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Téléchargement Veo HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:video/mp4;base64,${buf.toString("base64")}`;
}

/**
 * Poll + télécharge si terminé.
 * Important : le SDK exige une vraie instance GenerateVideosOperation
 * (pas un plain `{ name }` — sinon `_fromAPIResponse is not a function`).
 */
export async function finishVeoShort({ apiKey, operationName } = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");
  if (!operationName?.trim()) throw new Error("operationName manquant");

  const ai = client(apiKey.trim());
  const seed = new GenerateVideosOperation();
  seed.name = operationName.trim();

  let operation;
  try {
    operation = await ai.operations.getVideosOperation({ operation: seed });
  } catch (e) {
    // Fallback REST si le SDK échoue encore
    try {
      operation = await pollVeoOperationRest(apiKey.trim(), operationName.trim());
    } catch (e2) {
      throw new Error(friendlyVeoError(e?.message || e2));
    }
  }

  if (!operation?.done) return { done: false };

  if (operation.error) {
    const msg =
      operation.error.message ||
      operation.error.status ||
      JSON.stringify(operation.error);
    throw new Error(friendlyVeoError(msg));
  }

  const reasons = operation.response?.raiMediaFilteredReasons;
  if (
    Array.isArray(reasons) &&
    reasons.length &&
    !operation.response?.generatedVideos?.length
  ) {
    const reason = reasons.join("; ");
    if (/celebrity|real people|likeness|people'?s names/i.test(reason)) {
      const err = new Error(
        `VEO_CELEBRITY_FILTER: ${reason}`,
      );
      err.code = "VEO_CELEBRITY_FILTER";
      throw err;
    }
    throw new Error(`Contenu filtré Veo: ${reason}`);
  }

  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) throw new Error("Veo terminé sans vidéo");

  let videoBase64 = null;
  if (video.videoBytes) {
    videoBase64 = `data:video/mp4;base64,${video.videoBytes}`;
  } else if (video.uri) {
    videoBase64 = await downloadVeoVideo(apiKey.trim(), video.uri);
  }

  if (!videoBase64) throw new Error("Vidéo Veo vide");

  return {
    done: true,
    videoBase64,
    videoUrl: videoBase64,
    /** URI Google — requis pour étendre le clip (scene extension). */
    videoUri: video.uri || null,
    mimeType: video.mimeType || "video/mp4",
    aspectRatio: "9:16",
    durationSeconds: 8,
  };
}

/**
 * Démarre une extension de scène Veo (+~7 s) à partir d’une URI vidéo Veo.
 */
export async function extendVeoShort({
  apiKey,
  videoUri,
  videoBase64,
  prompt,
  model = "veo-3.1-generate-preview",
} = {}) {
  if (!apiKey?.trim()) throw new Error("Clé Gemini requise pour Veo 3");
  if (!videoUri && !videoBase64) {
    throw new Error("Vidéo source manquante pour l’extension Veo");
  }

  const ai = client(apiKey.trim());
  const extendPrompt =
    prompt?.trim() ||
    "Continue the same fictional music-video scene seamlessly, same original character, cinematic motion, no logos, no text, no celebrities.";

  const videoInput = videoUri
    ? { uri: videoUri }
    : {
        videoBytes: String(videoBase64).replace(/^data:video\/[^;]+;base64,/, ""),
        mimeType: "video/mp4",
      };

  try {
    console.info(`[veo] extend ${model}…`);
    const operation = await ai.models.generateVideos({
      model,
      prompt: extendPrompt,
      video: videoInput,
      config: {
        aspectRatio: "9:16",
        numberOfVideos: 1,
        negativePrompt: NEGATIVE,
      },
    });
    if (!operation?.name) throw new Error("Extension Veo : pas d’operation name");
    return {
      operationName: operation.name,
      model,
      mode: "extend",
      prompt: extendPrompt,
    };
  } catch (e) {
    throw new Error(friendlyVeoError(e));
  }
}

/** Prompts d’extension sûrs — scènes + vibe du morceau. */
export function buildExtendPrompts(social = {}, track = {}) {
  const scenes = (social?.scenes || [])
    .map((s) => sanitizeVisualBit(s, 140))
    .filter(Boolean);
  const genre = track?.style || "";
  const mood = track?.mood || "";
  const vibe = [genre, mood].filter(Boolean).join(", ");
  const hint = sanitizeVisualBit(social?.veoPromptHint || "", 100);
  const defaults = [
    `Continue seamlessly: environment that mirrors the song${vibe ? ` (${vibe})` : ""}, cinematic follow, emotional energy.`,
    "Continue seamlessly: intimate close-up, shallow depth of field, character looks to camera, music-video lighting.",
    "Continue seamlessly: wider shot, dynamic movement matching the track energy, same fictional character.",
  ];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const beat = scenes[i] || defaults[i];
    out.push(
      [
        "Continue the music video seamlessly, staying faithful to the song's mood and lyrics imagery.",
        `Next beat: ${String(beat).slice(0, 140)}.`,
        hint && i === 0 ? `Keep director hint: ${hint}.` : "",
        "Same fictional character, no celebrities, no text, no logos, no invented song.",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
  return out;
}

/** Poll REST brut — indépendant de l’instance SDK. */
async function pollVeoOperationRest(apiKey, operationName) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${operationName}`,
    { headers: { "x-goog-api-key": apiKey } },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Veo poll HTTP ${res.status}`);

  if (!data.done) return { done: false };

  if (data.error) {
    return { done: true, error: data.error };
  }

  const sample =
    data.response?.generateVideoResponse?.generatedSamples?.[0] ||
    data.response?.generateVideoResponse?.generatedVideos?.[0] ||
    data.response?.generatedVideos?.[0];

  const video = sample?.video
    ? {
        uri: sample.video.uri || sample.video.url || null,
        videoBytes: sample.video.videoBytes || sample.video.bytesBase64Encoded || null,
        mimeType: sample.video.mimeType || "video/mp4",
      }
    : null;
  const reasons =
    data.response?.generateVideoResponse?.raiMediaFilteredReasons ||
    data.response?.raiMediaFilteredReasons;

  return {
    done: true,
    error: null,
    response: {
      generatedVideos: video ? [{ video }] : [],
      raiMediaFilteredReasons: reasons,
    },
  };
}

/**
 * Génère un short 9:16 via Veo (synchrone — scripts).
 */
export async function generateVeoShort(opts = {}) {
  const started = await startVeoShort(opts);
  const key = opts.apiKey.trim();

  for (let i = 0; i < 60; i++) {
    const finished = await finishVeoShort({
      apiKey: key,
      operationName: started.operationName,
    });
    if (finished.done) {
      return {
        provider:
          started.mode === "i2v" || started.mode === "refs"
            ? started.model
            : `${started.model}-${started.mode}`,
        videoBase64: finished.videoBase64,
        videoUrl: finished.videoBase64,
        mimeType: "video/mp4",
        aspectRatio: "9:16",
        durationSeconds: 8,
        prompt: started.prompt,
        usedPortrait: started.usedPortrait,
        usedCover: started.usedCover,
        warning: started.warning,
      };
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }

  throw new Error("Timeout Veo (~10 min)");
}
