export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function requireGemini(keys) {
  const key = keys?.geminiApiKey?.trim();
  if (!key) {
    throw new Error("Clé Gemini manquante. Configure-la dans Paramètres.");
  }
  return key;
}
