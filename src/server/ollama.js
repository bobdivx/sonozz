import { parseLlmJson } from "./parseLlmJson.js";

const DEFAULT_BASE = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2";

export function resolveOllamaBaseUrl(keys) {
  const raw = keys?.ollamaBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

export function resolveOllamaModel(keys) {
  return keys?.ollamaModel?.trim() || DEFAULT_MODEL;
}

function errText(err) {
  return String(err?.message || err || "");
}

async function ollamaFetch(baseUrl, path, { method = "GET", body } = {}) {
  const url = `${baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(
      `Ollama injoignable (${baseUrl}). Lance \`ollama serve\` et vérifie l’URL. ${errText(e).slice(0, 120)}`,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Ollama HTTP ${res.status} sur ${path}`);
  }
  return data;
}

export async function listOllamaModels(keys) {
  const base = resolveOllamaBaseUrl(keys);
  const data = await ollamaFetch(base, "/api/tags");
  return (data?.models || []).map((m) => m.name).filter(Boolean);
}

export async function testOllama(keys) {
  const base = resolveOllamaBaseUrl(keys);
  const model = resolveOllamaModel(keys);
  const models = await listOllamaModels(keys);
  if (!models.length) {
    throw new Error(`Ollama OK (${base}) mais aucun modèle — \`ollama pull ${model}\``);
  }
  const exact = models.includes(model);
  const prefix = models.some((m) => m === model || m.startsWith(`${model}:`));
  if (!exact && !prefix) {
    throw new Error(
      `Modèle « ${model} » absent. Disponibles : ${models.slice(0, 8).join(", ")}${models.length > 8 ? "…" : ""}`,
    );
  }
  await ollamaText(keys, 'Réponds uniquement: "ok"');
  return { base, model, models };
}

async function generate(keys, prompt, { json = false } = {}) {
  const base = resolveOllamaBaseUrl(keys);
  const model = resolveOllamaModel(keys);
  const data = await ollamaFetch(base, "/api/chat", {
    method: "POST",
    body: {
      model,
      stream: false,
      ...(json ? { format: "json" } : {}),
      messages: [
        {
          role: "user",
          content: json
            ? `${prompt}\n\nRéponds uniquement avec du JSON valide, sans markdown.`
            : prompt,
        },
      ],
      options: {
        temperature: json ? 0.7 : 0.9,
      },
    },
  });
  const text = String(data?.message?.content || "").trim();
  if (!text) throw new Error(`Ollama (${model}) : réponse vide`);
  return { text, model };
}

export async function ollamaJson(keys, prompt) {
  const { text, model } = await generate(keys, prompt, { json: true });
  try {
    return { data: parseLlmJson(text), model };
  } catch {
    throw new Error(`Réponse Ollama (${model}) non JSON`);
  }
}

export async function ollamaText(keys, prompt) {
  const { text, model } = await generate(keys, prompt, { json: false });
  return { text, model };
}
