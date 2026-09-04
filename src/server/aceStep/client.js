import {
  aceStepModelMeta,
  aceStepModelLabel,
  isAceStepEngineDit,
} from "./models.js";

export const DEFAULT_GPU_ARBITER = "http://10.1.0.88:8790";
export const POLL_MS = 3000;
export const MAX_POLLS = 400;
const AUTH_USER = "sonozz";

const tokenCache = new Map();

function errText(err) {
  return String(err?.cause?.code || err?.message || err || "");
}

function isLanOrLoopbackHost(hostname) {
  const h = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Astro public (Cloudflare) ne peut pas joindre une IP LAN Pinokio. */
export function aceStepLanHint(baseUrl, requestHost) {
  let studioHost = "";
  try {
    studioHost = new URL(baseUrl).hostname;
  } catch {
    return "";
  }
  if (!isLanOrLoopbackHost(studioHost)) return "";
  const host = String(requestHost || "")
    .split(":")[0]
    .toLowerCase();
  if (host && !isLanOrLoopbackHost(host)) {
    return ` ${baseUrl} est une IP privée : le serveur public (${host}) ne peut pas l’atteindre. Lance SONOZZ en local (astro dev) sur ce PC, ou expose le studio via un tunnel (Cloudflare / Tailscale).`;
  }
  return "";
}

function apiError(path, data, status) {
  const detail =
    typeof data?.error === "string"
      ? data.error
      : typeof data?.message === "string"
        ? data.message
        : typeof data?.detail === "string"
          ? data.detail
          : `HTTP ${status}`;
  return `ACE-Step ${path}: ${detail}`;
}

async function aceFetch(
  baseUrl,
  path,
  { method = "GET", body, token, timeoutMs = method === "GET" ? 8000 : 60000 } = {},
) {
  const url = `${baseUrl}${path}`;
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw new Error(
      `ACE-Step Studio injoignable (${baseUrl})${timedOut ? " — délai dépassé" : ""}. ${errText(e).slice(0, 120)}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const err = new Error(apiError(path, data, res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function requestToken(base) {
  try {
    const auto = await aceFetch(base, "/api/auth/auto");
    if (auto?.token) return String(auto.token);
  } catch {
    /* pas d’utilisateur encore — setup */
  }
  const setup = await aceFetch(base, "/api/auth/setup", {
    method: "POST",
    body: { username: AUTH_USER },
  });
  if (!setup?.token) throw new Error("ACE-Step n’a pas renvoyé de jeton d’auth");
  return String(setup.token);
}

async function withAuth(base, fn) {
  let token = tokenCache.get(base);
  if (!token) {
    token = await requestToken(base);
    tokenCache.set(base, token);
  }
  try {
    return await fn(token);
  } catch (e) {
    if (e?.status === 401) {
      tokenCache.delete(base);
      token = await requestToken(base);
      tokenCache.set(base, token);
      return fn(token);
    }
    throw e;
  }
}

export function resolveAceAudioUrl(base, raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${base}${s}`;
  return `${base}/${s}`;
}

function firstAudioUrl(result) {
  if (!result || typeof result !== "object") return "";
  if (Array.isArray(result.audioUrls) && result.audioUrls[0]) return String(result.audioUrls[0]);
  if (Array.isArray(result.audio_urls) && result.audio_urls[0]) return String(result.audio_urls[0]);
  if (result.audioUrl) return String(result.audioUrl);
  if (result.audio_url) return String(result.audio_url);
  return "";
}

function normalizeModels(raw) {
  const list = Array.isArray(raw?.models) ? raw.models : Array.isArray(raw) ? raw : [];
  return list
    .map((m) => {
      const id = String(m?.name || m?.id || m || "").trim();
      if (!id) return null;
      const meta = aceStepModelMeta(id);
      const engineKnown = isAceStepEngineDit(id);
      const diskReady = Boolean(m?.is_preloaded || m?.is_active);
      return {
        id,
        name: meta?.label || id.replace(/^.*\//, ""),
        status: !engineKnown
          ? "unsupported"
          : diskReady
            ? "ready"
            : "not_downloaded",
        isActive: Boolean(m?.is_active),
        isPreloaded: diskReady && engineKnown,
        isCustom: Boolean(m?.is_custom),
        engineKnown,
        switchable: engineKnown,
        steps: meta?.steps || null,
        vramGb: meta?.vramGb || null,
      };
    })
    .filter(Boolean);
}

const ACE_UNREACHABLE_RE =
  /injoignable|fetch failed|ECONNREFUSED|délai dépassé|TimeoutError|ENOTFOUND|EHOSTUNREACH/i;

/**
 * Distingue « ACE injoignable », « moteur down », et « DiT en cours de chargement ».
 * Pendant un switch SFT, Gradio coupe souvent `connected` → ce n’est pas un crash.
 * `/api/generate/health` healthy=true = Gradio (:7865) joignable depuis Express (:8001).
 * @param {{ health?: object, status?: object, base?: string }} input
 */
export function interpretAceProbe({ health, status, base } = {}) {
  const healthError = String(health?.error || "");
  const healthUnreachable = ACE_UNREACHABLE_RE.test(healthError);
  const statusMissing =
    !status ||
    (typeof status === "object" &&
      status.connected == null &&
      !status.activeModel &&
      !status.state &&
      !status.model);

  if (healthUnreachable && statusMissing) {
    return {
      unreachable: true,
      healthy: false,
      connected: false,
      pipelineUp: false,
      loading: false,
      loadingModel: null,
      message: healthError || `ACE-Step Studio injoignable (${base})`,
    };
  }

  const state = String(status?.state || status?.status || status?.phase || "").toLowerCase();
  const loadingModel = String(status?.model || "").trim() || null;
  const isLoading = /loading|switching|initializ/.test(state);

  if (isLoading) {
    const label = loadingModel ? aceStepModelLabel(loadingModel) : "DiT";
    return {
      unreachable: false,
      healthy: health?.healthy === true,
      connected: status?.connected === true,
      pipelineUp: false,
      loading: true,
      loadingModel,
      message: `Chargement ${label} en cours — patiente (souvent plusieurs minutes). Ne fais pas Stop/Start Pinokio.`,
    };
  }

  const healthy = health?.healthy === true;
  const connected = status?.connected === true;
  const activeModel = String(status?.activeModel || "").trim();
  // Après un switch, Studio laisse parfois connected=false alors que le DiT est Ready.
  const readyWithModel =
    (/^ready$|^idle$|^ok$/i.test(state) || !state) && Boolean(activeModel);
  // healthy seul suffit : /api/generate/health sonde déjà Gradio (:7865).
  const pipelineUp = healthy || readyWithModel || (connected && Boolean(activeModel));
  return {
    unreachable: false,
    healthy,
    connected,
    pipelineUp,
    loading: false,
    loadingModel: null,
    message: pipelineUp
      ? null
      : "UI Express joignable (:8001), mais Gradio Python (:7865) est down — réveille ACE via GPU Arbiter (:8790) ou systemd ace-step-studio (évite Stop/Start Pinokio)",
  };
}

export {
  errText,
  apiError,
  aceFetch,
  withAuth,
  firstAudioUrl,
  normalizeModels,
  isLanOrLoopbackHost,
};
