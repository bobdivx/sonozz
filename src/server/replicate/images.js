import {
  replicateJson,
  errorText,
  isThrottle,
  isNoCredit,
  isNotFound,
  billingHint,
  waitPrediction,
  isAdapterError,
} from "./client.js";

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

function parseRetrySeconds(message) {
  const m = String(message).match(/resets? in ~?(\d+)\s*s/i);
  return m ? Number(m[1]) + 1 : 12;
}

/**
 * Crée une prediction modèle officiel SANS Prefer:wait
 * (sinon Replicate peut renvoyer "No adapter found for model").
 * Si l'endpoint modèle échoue, tente /predictions avec le hash de version.
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

  if (isNoCredit(res, data, msg)) {
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

/**
 * Image via Replicate.
 * Avec référence : Flux Kontext (img→img) d'abord.
 * Sinon : Flux Schnell → SD3.5 → Seedream.
 */
export async function generateImageWithReplicate(
  token,
  { prompt, kind = "image", referenceImageUrl } = {},
) {
  const enhanced =
    kind === "portrait"
      ? referenceImageUrl
        ? `Restyle this exact same person (keep face, age, hair, skin tone, identity). Photorealistic square music-artist portrait. ${prompt}. Sharp focus, no text, no watermark, do not change sex, age or identity`
        : `photorealistic portrait photo, square crop, music artist, ${prompt}, sharp focus, no text, no watermark, do not change the stated sex or gender of the person`
      : kind === "cover"
        ? referenceImageUrl
          ? `Transform this artist into a square cinematic album cover, same person clearly recognizable, same sex/gender as reference, ${prompt}, high detail, no watermark, no text`
          : `square album cover art, cinematic, ${prompt}, high detail, no watermark`
        : prompt;

  const promptText = String(enhanced).slice(0, 1500);
  const errors = [];

  const models =
    referenceImageUrl && (kind === "cover" || kind === "portrait")
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
        const raw = errorText(data, res.status);
        const msg = billingHint(raw);
        console.error(`[replicate] ${model.path} create failed`, res.status, msg);
        errors.push(`${model.path}: ${msg}`);
        if (isNoCredit(res, data, raw)) {
          throw new Error(
            "Replicate sans crédit — portraits/jaquettes via Gemini Image (pas besoin de payer Replicate).",
          );
        }
        continue;
      }

      const url = await waitPrediction(token, data, { maxPolls: 90 });
      console.info(`[replicate] image OK ${model.path}`);
      return url;
    } catch (e) {
      console.error(`[replicate] ${model.path} échec:`, e.message);
      if (/sans crédit|insufficient credit/i.test(e.message)) throw e;
      errors.push(`${model.path}: ${e.message}`);
    }
  }

  throw new Error(errors.slice(0, 3).join(" · ") || "Aucun modèle image Replicate disponible");
}
