import { geminiJson, geminiText, resolveGeminiTextModel } from "./gemini.js";
import { ollamaJson, ollamaText, resolveOllamaModel } from "./ollama.js";
import { requireGemini } from "./http.js";

export function isOllamaProvider(keys) {
  return String(keys?.llmProvider || "gemini").trim().toLowerCase() === "ollama";
}

export function resolveTextModel(keys) {
  if (isOllamaProvider(keys)) return resolveOllamaModel(keys);
  return resolveGeminiTextModel(keys?.geminiModel);
}

/** Texte structuré (JSON) — Gemini cloud ou Ollama local. */
export async function llmJson(keys, prompt) {
  if (isOllamaProvider(keys)) {
    const { data } = await ollamaJson(keys, prompt);
    return data;
  }
  const apiKey = requireGemini(keys);
  return geminiJson(apiKey, prompt, { model: resolveGeminiTextModel(keys?.geminiModel) });
}

export async function llmText(keys, prompt) {
  if (isOllamaProvider(keys)) {
    const { text } = await ollamaText(keys, prompt);
    return text;
  }
  const apiKey = requireGemini(keys);
  return geminiText(apiKey, prompt, { model: resolveGeminiTextModel(keys?.geminiModel) });
}

/** Vérifie qu’un provider texte est utilisable. */
export function requireTextLlm(keys) {
  if (isOllamaProvider(keys)) {
    if (!resolveOllamaModel(keys)) {
      throw new Error("Modèle Ollama manquant. Configure-le dans Paramètres.");
    }
    return;
  }
  requireGemini(keys);
}
