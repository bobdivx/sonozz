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

/**
 * Origine publique (HTTPS) derrière Coolify / Cloudflare / reverse-proxy.
 * `new URL(request.url).origin` reste souvent en http:// interne → casse OAuth Google.
 */
export function publicOrigin(request) {
  const url = new URL(request.url);
  const headers = request.headers;
  const xfProto = (headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  const xfHost = (headers.get("x-forwarded-host") || headers.get("host") || "")
    .split(",")[0]
    .trim();

  let protocol = xfProto || url.protocol.replace(":", "") || "http";
  let host = xfHost || url.host;

  const isLocal =
    /^localhost(?::\d+)?$/i.test(host) ||
    /^127\.0\.0\.1(?::\d+)?$/i.test(host) ||
    /^\[::1\](?::\d+)?$/i.test(host);

  // Prod : jamais http pour OAuth (Google exige le match exact HTTPS)
  if (!isLocal && protocol === "http") {
    protocol = "https";
  }

  return `${protocol}://${host}`.replace(/\/$/, "");
}

export function requireGemini(keys) {
  const key = keys?.geminiApiKey?.trim();
  if (!key) {
    throw new Error("Clé Gemini manquante. Configure-la dans Paramètres.");
  }
  return key;
}
