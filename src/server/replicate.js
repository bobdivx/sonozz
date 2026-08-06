/** Versions connues de meta/musicgen (community → /v1/predictions + version hash). */
const VERSIONS = [
  "671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb",
  "b05b1dff1d8c6dc63d14b0cdb42135378dcb87f6373b0d3d341ede46e59e2b38",
];

async function replicateJson(token, path, { wait = false, waitSeconds = 60, ...options } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  // Replicate n’accepte que wait entre 1 et 60
  if (wait) headers.Prefer = `wait=${Math.min(60, Math.max(1, waitSeconds))}`;

  const res = await fetch(`https://api.replicate.com/v1${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

function errorText(data, status) {
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail)) return data.detail.map((d) => d.msg || d).join("; ");
  return data?.error || data?.title || `HTTP ${status}`;
}

function isThrottle(res, data) {
  const msg = errorText(data, res.status);
  return res.status === 429 || /throttled|rate limit/i.test(msg);
}

function isNotFound(res, data) {
  const msg = errorText(data, res.status);
  return res.status === 404 || /could not be found|not found/i.test(msg);
}

function parseRetrySeconds(message) {
  const m = String(message).match(/resets? in ~?(\d+)\s*s/i);
  return m ? Number(m[1]) + 1 : 12;
}

function billingHint(message) {
  if (/payment method|billing|throttled|rate limit/i.test(message)) {
    return `${message} → Ajoute un moyen de paiement : https://replicate.com/account/billing#billing (sinon limite ~1 req/min).`;
  }
  return message;
}

async function resolveMusicgenVersion(token) {
  const { res, data } = await replicateJson(token, "/models/meta/musicgen");
  if (res.ok) {
    const version = data?.latest_version?.id || data?.latest_version;
    if (version) return String(version);
  }
  return VERSIONS[0];
}

function buildInput(prompt, duration) {
  return {
    prompt: String(prompt || "emotional modern pop instrumental").slice(0, 500),
    duration: Math.min(30, Math.max(5, Number(duration) || 15)),
    model_version: "stereo-large",
    output_format: "mp3",
    normalization_strategy: "peak",
  };
}

async function createPrediction(token, version, input) {
  return replicateJson(token, "/predictions", {
    method: "POST",
    wait: true,
    body: JSON.stringify({ version, input }),
  });
}

function extractOutputUrl(out) {
  if (!out) return null;
  if (typeof out === "string") return out;
  if (Array.isArray(out)) return extractOutputUrl(out[0]);
  if (typeof out === "object") {
    return out.url || out.image || out.href || out.audio || out.song || null;
  }
  return null;
}

export async function waitPrediction(token, prediction, { maxPolls = 180 } = {}) {
  let current = prediction;

  for (let i = 0; i < maxPolls; i++) {
    if (current.status === "succeeded") {
      const url = extractOutputUrl(current.output);
      if (!url) throw new Error("Replicate a réussi mais sans URL de fichier");
      return String(url);
    }
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(current.error || "Génération audio échouée");
    }
    if (!current.id) {
      throw new Error(errorText(current, 400));
    }

    await new Promise((r) => setTimeout(r, 2000));
    const { res, data } = await replicateJson(token, `/predictions/${current.id}`);
    if (!res.ok) {
      throw new Error(errorText(data, res.status));
    }
    current = data;
  }

  throw new Error("Timeout génération audio Replicate (~6 min)");
}

/** MiniMax attend des tags EN : [Verse], [Chorus], [Bridge]… */
function normalizeLyrics(lyricsText = "") {
  return String(lyricsText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\[Couplet(?:\s*\d+)?\]/gi, "[Verse]")
    .replace(/\[Refrain\]/gi, "[Chorus]")
    .replace(/\[Pré[- ]?refrain\]/gi, "[Pre Chorus]")
    .replace(/\[Pont\]/gi, "[Bridge]")
    .replace(/\[Outro\]/gi, "[Outro]")
    .replace(/\[Intro\]/gi, "[Intro]")
    .trim()
    .slice(0, 3500);
}

function minimaxMusicInput({ prompt, lyrics }) {
  const lyricsText = normalizeLyrics(lyrics);
  const stylePrompt = String(prompt || "modern french pop, emotional vocals").slice(0, 2000);
  return lyricsText
    ? {
        prompt: stylePrompt,
        lyrics: lyricsText,
        is_instrumental: false,
        lyrics_optimizer: false,
      }
    : {
        prompt: stylePrompt,
        is_instrumental: false,
        lyrics_optimizer: true,
      };
}

/** Crée la prediction MiniMax sans attendre (évite timeout proxy). */
export async function startMinimaxMusic(token, { prompt, lyrics } = {}) {
  const input = minimaxMusicInput({ prompt, lyrics });

  let { res, data } = await replicateJson(token, "/models/minimax/music-2.6/predictions", {
    method: "POST",
    wait: false,
    body: JSON.stringify({ input }),
  });

  if (isThrottle(res, data)) {
    const waitSec = parseRetrySeconds(errorText(data, res.status));
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    ({ res, data } = await replicateJson(token, "/models/minimax/music-2.6/predictions", {
      method: "POST",
      wait: false,
      body: JSON.stringify({ input }),
    }));
  }

  if (isThrottle(res, data)) {
    throw new Error(billingHint(errorText(data, res.status)));
  }
  if (!res.ok && !data?.id) {
    console.error("[replicate] MiniMax create failed", res.status, data);
    throw new Error(billingHint(errorText(data, res.status)));
  }

  console.info("[replicate] MiniMax start", data.id, data.status);
  return {
    generationId: data.id,
    provider: "minimax-music-2.6",
    status: data.status || "starting",
  };
}

/** Un tick de poll prediction MiniMax. */
export async function pollMinimaxMusic(token, generationId) {
  const id = String(generationId || "").trim();
  if (!id) throw new Error("predictionId MiniMax manquant");

  const { res, data } = await replicateJson(token, `/predictions/${id}`);
  if (!res.ok) throw new Error(billingHint(errorText(data, res.status)));

  if (data.status === "succeeded") {
    const url = extractOutputUrl(data.output);
    if (!url) throw new Error("Replicate a réussi mais sans URL de fichier");
    return {
      done: true,
      status: "succeeded",
      url: String(url),
      provider: "minimax-music-2.6",
      durationLabel: "~2–4 min",
      hasVocals: true,
      generationId: id,
    };
  }
  if (data.status === "failed" || data.status === "canceled") {
    throw new Error(data.error || "Génération audio échouée");
  }
  return { done: false, status: data.status || "processing", generationId: id };
}

/**
 * MiniMax Music 2.6 — chanson complète avec voix + paroles (2–4 min typique).
 */
async function generateWithMinimax(token, { prompt, lyrics }) {
  const started = await startMinimaxMusic(token, { prompt, lyrics });
  const url = await waitPrediction(token, { id: started.generationId, status: started.status }, {
    maxPolls: 180,
  });
  return { url, provider: "minimax-music-2.6", durationLabel: "~2–4 min", hasVocals: true };
}

async function createWithRetryOnThrottle(token, version, input) {
  let { res, data } = await createPrediction(token, version, input);

  if (isThrottle(res, data)) {
    const waitSec = parseRetrySeconds(errorText(data, res.status));
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    ({ res, data } = await createPrediction(token, version, input));
  }

  return { res, data };
}

async function generateWithMusicgen(token, { prompt, duration = 30 }) {
  const input = buildInput(prompt, duration);

  let version = VERSIONS[0];
  try {
    version = await resolveMusicgenVersion(token);
  } catch {
    /* use fallback */
  }

  let { res, data } = await createWithRetryOnThrottle(token, version, input);

  if (isThrottle(res, data)) {
    throw new Error(billingHint(errorText(data, res.status)));
  }

  if (isNotFound(res, data) || (!res.ok && !data?.id)) {
    const alt = VERSIONS.find((v) => v !== version) || VERSIONS[0];
    const second = await createWithRetryOnThrottle(token, alt, {
      prompt: input.prompt,
      duration: input.duration,
      model_version: "large",
    });
    res = second.res;
    data = second.data;

    if (isThrottle(res, data)) {
      throw new Error(billingHint(errorText(data, res.status)));
    }
  }

  if (!res.ok && !data?.id) {
    throw new Error(billingHint(errorText(data, res.status)));
  }

  const url = await waitPrediction(token, data, { maxPolls: 90 });
  return {
    url,
    provider: "replicate-musicgen",
    durationLabel: `~${input.duration}s`,
    hasVocals: false,
    warning: "MusicGen = instrumental uniquement (pas de paroles chantées), max ~30s.",
  };
}

/**
 * MiniMax Music 2.6 uniquement (voix + paroles).
 * Pas de fallback MusicGen silencieux — sinon on retombe sur de l’instrumental 20–30s.
 */
export async function generateMusicWithReplicate(token, { prompt, lyrics } = {}) {
  console.info("[replicate] MiniMax music-2.6…");
  try {
    const result = await generateWithMinimax(token, { prompt, lyrics });
    console.info("[replicate] MiniMax OK", result.provider);
    return result;
  } catch (miniErr) {
    console.error("[replicate] MiniMax échec:", miniErr.message);
    throw new Error(
      `MiniMax Music 2.6: ${miniErr.message} (pas de fallback MusicGen — ce modèle est instrumental court).`,
    );
  }
}

export async function testReplicateToken(token) {
  const { res, data } = await replicateJson(token, "/account");
  if (!res.ok) {
    throw new Error(billingHint(errorText(data, res.status)));
  }
  return data;
}

const IMAGE_MODELS = [
  {
    path: "black-forest-labs/flux-schnell",
    input: (prompt) => ({
      prompt,
      aspect_ratio: "1:1",
      output_format: "jpg",
      output_quality: 80,
      num_outputs: 1,
    }),
  },
  {
    path: "black-forest-labs/flux-dev",
    input: (prompt) => ({
      prompt,
      aspect_ratio: "1:1",
      output_format: "jpg",
      output_quality: 80,
      num_outputs: 1,
    }),
  },
  {
    path: "stability-ai/stable-diffusion-3.5-large-turbo",
    input: (prompt) => ({
      prompt,
      aspect_ratio: "1:1",
      output_format: "jpg",
      output_quality: 80,
    }),
  },
  {
    path: "bytedance/seedream-3",
    input: (prompt) => ({
      prompt,
      aspect_ratio: "1:1",
      size: "regular",
    }),
  },
];

function isAdapterError(message = "") {
  return /no adapter found|adapter/i.test(String(message));
}

/**
 * Crée une prediction modèle officiel SANS Prefer:wait
 * (sinon Replicate peut renvoyer "No adapter found for model").
 * Si l’endpoint modèle échoue, tente /predictions avec le hash de version.
 */
export async function createModelPrediction(token, modelPath, input) {
  let { res, data } = await replicateJson(token, `/models/${modelPath}/predictions`, {
    method: "POST",
    wait: false,
    body: JSON.stringify({ input }),
  });

  if (isThrottle(res, data)) {
    const waitSec = parseRetrySeconds(errorText(data, res.status));
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    ({ res, data } = await replicateJson(token, `/models/${modelPath}/predictions`, {
      method: "POST",
      wait: false,
      body: JSON.stringify({ input }),
    }));
  }

  const msg = errorText(data, res.status);
  if ((res.ok || data?.id) && !isAdapterError(msg)) {
    return { res, data };
  }

  // Secours : résoudre latest_version puis POST /v1/predictions (sans Prefer:wait)
  if (isAdapterError(msg) || isNotFound(res, data) || (!res.ok && !data?.id)) {
    try {
      const meta = await replicateJson(token, `/models/${modelPath}`);
      const version = meta.data?.latest_version?.id || meta.data?.latest_version;
      if (version && meta.res.ok) {
        console.info(`[replicate] ${modelPath} → fallback version ${String(version).slice(0, 12)}…`);
        const viaVersion = await replicateJson(token, "/predictions", {
          method: "POST",
          wait: false,
          body: JSON.stringify({ version: String(version), input }),
        });
        if (viaVersion.res.ok || viaVersion.data?.id) {
          return viaVersion;
        }
        return viaVersion;
      }
    } catch (e) {
      console.error(`[replicate] fallback version ${modelPath}:`, e.message);
    }
  }

  return { res, data };
}

const KONTEXT_MODELS = [
  {
    path: "black-forest-labs/flux-kontext-pro",
    input: (prompt, image) => ({
      prompt,
      input_image: image,
      aspect_ratio: "1:1",
      output_format: "png",
    }),
  },
  {
    path: "black-forest-labs/flux-kontext-dev",
    input: (prompt, image) => ({
      prompt,
      input_image: image,
      aspect_ratio: "1:1",
      output_format: "png",
    }),
  },
];

/**
 * Image via Replicate.
 * Avec référence : Flux Kontext (img→img) d’abord.
 * Sinon : Flux Schnell → SD3.5 → Seedream.
 */
export async function generateImageWithReplicate(
  token,
  { prompt, kind = "image", referenceImageUrl } = {},
) {
  const enhanced =
    kind === "portrait"
      ? `photorealistic portrait photo, square crop, music artist, ${prompt}, sharp focus, no text, no watermark, do not change the stated sex or gender of the person`
      : kind === "cover"
        ? referenceImageUrl
          ? `Transform this artist into a square cinematic album cover, same person clearly recognizable, same sex/gender as reference, ${prompt}, high detail, no watermark, no text`
          : `square album cover art, cinematic, ${prompt}, high detail, no watermark`
        : prompt;

  const promptText = String(enhanced).slice(0, 1500);
  const errors = [];

  const models =
    referenceImageUrl && kind === "cover"
      ? [
          ...KONTEXT_MODELS.map((m) => ({
            path: m.path,
            input: () => m.input(promptText, referenceImageUrl),
          })),
          // Secours texte seul si Kontext KO (moins fidèle)
          ...IMAGE_MODELS,
        ]
      : IMAGE_MODELS;

  for (const model of models) {
    try {
      console.info(`[replicate] image via ${model.path}…`);
      const input = typeof model.input === "function" ? model.input(promptText) : model.input;
      const { res, data } = await createModelPrediction(token, model.path, input);

      if (!res.ok && !data?.id) {
        const msg = billingHint(errorText(data, res.status));
        console.error(`[replicate] ${model.path} create failed`, res.status, msg);
        errors.push(`${model.path}: ${msg}`);
        continue;
      }

      const url = await waitPrediction(token, data, { maxPolls: 90 });
      console.info(`[replicate] image OK ${model.path}`);
      return url;
    } catch (e) {
      console.error(`[replicate] ${model.path} échec:`, e.message);
      errors.push(`${model.path}: ${e.message}`);
    }
  }

  throw new Error(errors.slice(0, 3).join(" · ") || "Aucun modèle image Replicate disponible");
}
