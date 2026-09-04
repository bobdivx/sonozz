import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseLlmJson } from "../parseLlmJson.js";
import { modelQueue } from "./models.js";

function client(apiKey) {
  return new GoogleGenerativeAI(apiKey);
}

function errText(err) {
  return String(err?.message || err || "");
}

function isQuotaError(err) {
  const msg = errText(err);
  return (
    msg.includes("429") ||
    msg.includes("Too Many Requests") ||
    msg.includes("quota") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

function isRetriableModelError(err) {
  const msg = errText(err);
  return (
    isQuotaError(err) ||
    /not found|404|not supported|is not found|NOT_FOUND/i.test(msg)
  );
}

function friendlyQuotaMessage(err, model) {
  return [
    `Quota Gemini dépassé sur ${model}.`,
    "Utilise gemini-2.5-flash-lite ou gemini-2.5-flash (recommandés free tier).",
    "Solutions : changer le modèle dans Paramètres, attendre le reset, ou activer la facturation AI Studio.",
    `Détail : ${errText(err).slice(0, 220)}`,
  ].join(" ");
}

async function generateWithFallback(apiKey, prompt, { preferredModel, json = false } = {}) {
  const models = modelQueue(preferredModel);
  let lastError;

  for (const model of models) {
    try {
      const genAI = client(apiKey);
      const m = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: json ? 0.9 : 0.95,
          ...(json ? { responseMimeType: "application/json" } : {}),
        },
      });
      const result = await m.generateContent(prompt);
      const text = result.response.text().trim();
      return { text, model };
    } catch (err) {
      lastError = err;
      if (isRetriableModelError(err)) {
        continue;
      }
      throw err;
    }
  }

  if (isQuotaError(lastError)) {
    throw new Error(friendlyQuotaMessage(lastError, models[0]));
  }
  throw lastError || new Error("Gemini indisponible");
}

export async function geminiJson(apiKey, prompt, { model } = {}) {
  const { text } = await generateWithFallback(apiKey, prompt, {
    preferredModel: model,
    json: true,
  });
  return parseLlmJson(text);
}

export async function geminiText(apiKey, prompt, { model } = {}) {
  const { text } = await generateWithFallback(apiKey, prompt, {
    preferredModel: model,
    json: false,
  });
  return text;
}
