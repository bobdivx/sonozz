export async function replicateJson(token, path, { wait = false, waitSeconds = 60, ...options } = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  // Replicate n'accepte que wait entre 1 et 60
  if (wait) headers.Prefer = `wait=${Math.min(60, Math.max(1, waitSeconds))}`;

  const res = await fetch(`https://api.replicate.com/v1${path}`, {
    ...options,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export function errorText(data, status) {
  if (typeof data?.detail === "string") return data.detail;
  if (Array.isArray(data?.detail)) return data.detail.map((d) => d.msg || d).join("; ");
  return data?.error || data?.title || `HTTP ${status}`;
}

export function isThrottle(res, data) {
  const msg = errorText(data, res.status);
  if (isNoCredit(res, data, msg)) return false;
  return res.status === 429 || /throttled|rate limit/i.test(msg);
}

/** Compte Replicate à sec : inutile d'enchaîner d'autres modèles. */
export function isNoCredit(res, data, message = "") {
  const msg = `${errorText(data, res?.status)} ${message}`;
  return res?.status === 402 || /insufficient credit|less than \$5/i.test(msg);
}

export function isNotFound(res, data) {
  const msg = errorText(data, res.status);
  return res.status === 404 || /could not be found|not found/i.test(msg);
}

export function parseRetrySeconds(message) {
  const m = String(message).match(/resets? in ~?(\d+)\s*s/i);
  return m ? Number(m[1]) + 1 : 12;
}

export function billingHint(message) {
  if (/payment method|billing|throttled|rate limit/i.test(message)) {
    return `${message} → Ajoute un moyen de paiement : https://replicate.com/account/billing#billing (sinon limite ~1 req/min).`;
  }
  return message;
}

export function extractOutputUrl(out) {
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

export async function testReplicateToken(token) {
  const { res, data } = await replicateJson(token, "/account");
  if (!res.ok) {
    throw new Error(billingHint(errorText(data, res.status)));
  }
  return data;
}

export function isAdapterError(message = "") {
  return /no adapter found|adapter/i.test(String(message));
}
