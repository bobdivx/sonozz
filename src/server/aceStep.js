import { isStudioEnabled } from "../lib/keys.js";

/**
 * Client ACE-Step Studio (Pinokio).
 * Auth JWT local → POST /api/generate (custom) → poll /api/generate/status/:jobId
 * @see https://github.com/timoncool/ACE-Step-Studio
 */

const DEFAULT_BASE = "http://127.0.0.1:3001";
const POLL_MS = 3000;
const MAX_POLLS = 400;
const AUTH_USER = "sonozz";

/** Catalogue DiT XL connu du Studio. */
export const ACE_STEP_MODELS = [
  {
    id: "acestep-v15-xl-turbo",
    label: "XL Turbo",
    steps: 8,
    guidance: 0,
    vramGb: 12,
  },
  {
    id: "acestep-v15-xl-sft",
    label: "XL SFT",
    steps: 50,
    guidance: 7,
    vramGb: 20,
  },
  {
    id: "marcorez8/acestep-v15-xl-turbo-bf16",
    label: "XL Turbo BF16",
    steps: 8,
    guidance: 0,
    vramGb: 8,
  },
  {
    id: "acestep-v15-xl-merge-sft-turbo",
    label: "XL Merge",
    steps: 50,
    guidance: 7,
    vramGb: 16,
  },
];

const tokenCache = new Map();

export function resolveAceStepBaseUrl(keys) {
  const raw = keys?.aceStepBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

export function isAceStepMusicProvider(keys) {
  return (
    String(keys?.musicProvider || "").trim() === "acestep" && isStudioEnabled(keys, "acestep")
  );
}

export function aceStepModelMeta(modelId) {
  const id = String(modelId || "").trim();
  return ACE_STEP_MODELS.find((m) => m.id === id) || null;
}

export function aceStepModelLabel(modelId) {
  return aceStepModelMeta(modelId)?.label || String(modelId || "").replace(/^.*\//, "") || "auto";
}

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
      return {
        id,
        name: meta?.label || id.replace(/^.*\//, ""),
        status: m?.is_preloaded || m?.is_active ? "ready" : "not_downloaded",
        isActive: Boolean(m?.is_active),
        isPreloaded: Boolean(m?.is_preloaded),
        isCustom: Boolean(m?.is_custom),
        steps: meta?.steps || null,
        vramGb: meta?.vramGb || null,
      };
    })
    .filter(Boolean);
}

/**
 * Choisit le DiT à envoyer : préférence user, sinon actif, sinon premier préchargé.
 */
export function pickAceStepModel(catalog = {}, opts = {}) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const preferredId = String(opts?.preferredId || "").trim();
  const activeId = String(catalog?.activeModel || opts?.activeId || "").trim();
  const readyIds = models.filter((m) => m.isPreloaded || m.isActive).map((m) => m.id);
  const readySet = new Set(readyIds);

  if (preferredId) {
    return {
      modelId: preferredId,
      reason: readySet.has(preferredId)
        ? `forcé · ${aceStepModelLabel(preferredId)}`
        : `forcé · ${aceStepModelLabel(preferredId)} (téléchargement possible)`,
    };
  }
  if (activeId) {
    return { modelId: activeId, reason: `auto · déjà chargé (${aceStepModelLabel(activeId)})` };
  }
  const turboBf16 = "marcorez8/acestep-v15-xl-turbo-bf16";
  if (readySet.has(turboBf16)) {
    return { modelId: turboBf16, reason: "auto · Turbo BF16 (compact)" };
  }
  const turbo = "acestep-v15-xl-turbo";
  if (readySet.has(turbo)) {
    return { modelId: turbo, reason: "auto · Turbo" };
  }
  if (readyIds[0]) {
    return { modelId: readyIds[0], reason: `auto · ${aceStepModelLabel(readyIds[0])}` };
  }
  return { modelId: turboBf16, reason: "auto · Turbo BF16 (défaut Studio)" };
}

export function lyricsForAceStepPreview(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, 16).join("\n");
}

export function buildAceStepBody({
  title,
  style,
  lyrics,
  language = "fr",
  bpm,
  durationSec,
  modelId,
  preview = false,
}) {
  const meta = aceStepModelMeta(modelId);
  const isTurbo = Boolean(meta && meta.steps <= 8);
  const duration = preview
    ? Math.min(45, Number(durationSec) || 30)
    : Math.min(480, Math.max(60, Number(durationSec) || 180));
  return {
    customMode: true,
    title: String(preview ? `${title || "SONOZZ"} · extrait` : title || "SONOZZ Track").slice(0, 120),
    style: String(style || "pop, emotional, radio-ready").slice(0, 800),
    lyrics: String(preview ? lyricsForAceStepPreview(lyrics) : lyrics || "").slice(0, 8000),
    prompt: String(preview ? lyricsForAceStepPreview(lyrics) : lyrics || "").slice(0, 8000),
    instrumental: false,
    vocalLanguage: String(language || "fr").slice(0, 8),
    duration,
    bpm: Number.isFinite(Number(bpm)) ? Math.min(200, Math.max(60, Math.round(Number(bpm)))) : undefined,
    inferenceSteps: meta?.steps || (isTurbo ? 8 : 50),
    guidanceScale: meta ? meta.guidance : 0,
    ditModel: modelId || undefined,
    audioFormat: "mp3",
    randomSeed: true,
    pollinations: { enabled: false },
  };
}

const ACE_UNREACHABLE_RE =
  /injoignable|fetch failed|ECONNREFUSED|délai dépassé|TimeoutError|ENOTFOUND|EHOSTUNREACH/i;

/**
 * Distingue « ACE carrément injoignable » de « UI up / moteur Python down ».
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
      message: healthError || `ACE-Step Studio injoignable (${base})`,
    };
  }

  const healthy = health?.healthy === true;
  const connected = status?.connected === true;
  return {
    unreachable: false,
    healthy,
    connected,
    pipelineUp: healthy && connected,
    message:
      !healthy || !connected
        ? "UI joignable, mais le moteur Python (port 8001) est down — Stop puis Start dans Pinokio"
        : null,
  };
}

export async function testAceStep(keys) {
  const base = resolveAceStepBaseUrl(keys);
  const [health, modelsRaw, status, sys] = await Promise.all([
    aceFetch(base, "/api/generate/health").catch((e) => ({ healthy: false, error: e.message })),
    aceFetch(base, "/api/generate/models").catch(() => ({ models: [] })),
    aceFetch(base, "/api/generate/model-status").catch(() => ({})),
    aceFetch(base, "/api/generate/system-info").catch(() => null),
  ]);
  const interpreted = interpretAceProbe({ health, status, base });
  if (interpreted.unreachable) {
    throw new Error(interpreted.message);
  }
  const models = normalizeModels(modelsRaw);
  const activeModel = String(status?.activeModel || status?.model || "").trim() || null;
  const pick = pickAceStepModel(
    { models, activeModel },
    { preferredId: String(keys?.aceStepPreferredModel || "").trim() || null },
  );
  const hasReadyModel =
    health?.healthy === true ||
    status?.connected === true ||
    models.some((m) => m.isPreloaded || m.isActive);
  const gpu =
    sys && typeof sys === "object"
      ? {
          name: sys.gpu || null,
          totalGb: Number(sys.vram_total) || null,
          usedGb: Number(sys.vram_used) || null,
          freeGb:
            Number.isFinite(Number(sys.vram_total)) && Number.isFinite(Number(sys.vram_used))
              ? Math.round((Number(sys.vram_total) - Number(sys.vram_used)) * 10) / 10
              : null,
        }
      : null;

  return {
    base,
    healthy: interpreted.healthy,
    connected: interpreted.connected,
    activeModel,
    models,
    pickedModel: pick.modelId,
    pickReason: pick.reason,
    preferredModel: String(keys?.aceStepPreferredModel || "").trim() || null,
    hasReadyModel,
    gpu,
    pipelineUp: interpreted.pipelineUp,
    message:
      interpreted.message ||
      (hasReadyModel
        ? `Joignable${activeModel ? ` · ${aceStepModelLabel(activeModel)}` : ""}`
        : "Joignable — aucun modèle chargé (ouvre ACE-Step Studio une fois)"),
  };
}

export async function switchAceStepModel(keys, modelId) {
  const base = resolveAceStepBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId ACE-Step manquant");
  try {
    const info = await testAceStep(keys);
    if (info.pipelineUp === false) {
      throw new Error(
        "Moteur ACE-Step down (Gradio :8001). Dans Pinokio : Stop, puis Start (No LM si Sonozz). Attends que l’UI soit prête avant de changer de modèle.",
      );
    }
  } catch (e) {
    if (/Moteur ACE-Step down/i.test(e.message)) throw e;
    /* probe raté : on tente le switch quand même */
  }
  try {
    const result = await withAuth(base, (token) =>
      aceFetch(base, "/api/generate/switch-model", {
        method: "POST",
        token,
        body: { model: id },
        timeoutMs: 180000,
      }),
    );
    return { ok: true, model: id, result };
  } catch (e) {
    const raw = String(e.message || "");
    if (/fetch failed|ECONNREFUSED|connected.:false|healthy.:false/i.test(raw)) {
      throw new Error(
        "Changement de modèle impossible : le moteur Python ACE-Step ne répond plus. Pinokio → Stop → Start (No LM), puis réessaie.",
      );
    }
    throw e;
  }
}

export async function startAceStep(keys, {
  prompt,
  lyrics,
  title,
  language,
  bpm,
  preview = false,
} = {}) {
  const base = resolveAceStepBaseUrl(keys);
  const info = await testAceStep(keys);
  if (info.pipelineUp === false) {
    throw new Error(
      info.message ||
        `Moteur ACE-Step down (${base}). Pinokio : Stop puis Start (No LM si Sonozz).`,
    );
  }
  const catalog = { models: info.models, activeModel: info.activeModel };
  const pick = pickAceStepModel(catalog, {
    preferredId: String(keys?.aceStepPreferredModel || "").trim() || null,
  });
  const active = String(catalog.activeModel || "").trim();
  if (pick.modelId && active && pick.modelId !== active) {
    try {
      const probe = await testAceStep(keys);
      if (probe.pipelineUp === false) {
        console.warn("[acestep] switch-model sauté — moteur Python down");
      } else {
        await switchAceStepModel(keys, pick.modelId);
      }
    } catch (e) {
      console.warn("[acestep] switch-model ignoré:", e.message);
    }
  }

  const body = buildAceStepBody({
    title,
    style: prompt,
    lyrics,
    language,
    bpm,
    durationSec: preview ? 30 : 180,
    modelId: pick.modelId,
    preview,
  });

  console.info(
    "[acestep] start…",
    base,
    body.title,
    preview ? "PREVIEW" : "FULL",
    `model=${pick.modelId}`,
    `pick=${pick.reason}`,
    `steps=${body.inferenceSteps}`,
    `lang=${body.vocalLanguage}`,
    `dur=${body.duration}s`,
    `bpm=${body.bpm || "?"}`,
  );

  const created = await withAuth(base, (token) =>
    aceFetch(base, "/api/generate", { method: "POST", token, body }),
  );
  const jobId = created?.jobId || created?.job_id;
  if (!jobId) throw new Error("ACE-Step n’a pas renvoyé de jobId");
  return {
    generationId: jobId,
    provider: "acestep-studio",
    base,
    model: pick.modelId,
    quality: aceStepModelLabel(pick.modelId),
    pickReason: pick.reason,
  };
}

function durationLabelFrom(secs) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `~${Math.round(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;
}

export async function pollAceStep(keys, generationId) {
  const base = resolveAceStepBaseUrl(keys);
  const jobId = String(generationId || "").trim();
  if (!jobId) throw new Error("generationId ACE-Step manquant");

  const status = await withAuth(base, (token) =>
    aceFetch(base, `/api/generate/status/${encodeURIComponent(jobId)}`, { token }),
  );
  const st = String(status?.status || "").toLowerCase();
  if (st === "succeeded" || st === "completed" || st === "success") {
    const rawUrl = firstAudioUrl(status?.result);
    const url = resolveAceAudioUrl(base, rawUrl);
    if (!url) throw new Error("ACE-Step terminé sans URL audio");
    const secs = Number(status?.result?.duration);
    const durationLabel = durationLabelFrom(secs) || "~2–4 min";
    console.info("[acestep] OK", jobId, url);
    try {
      const probe = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (!probe.ok) {
        const get = await fetch(url, {
          headers: { Range: "bytes=0-64" },
          signal: AbortSignal.timeout(8000),
        });
        if (!get.ok) throw new Error(`Audio ACE-Step HTTP ${get.status} — fichier pas encore prêt ?`);
      }
    } catch (e) {
      if (/Audio ACE-Step/i.test(String(e?.message || ""))) throw e;
      console.warn("[acestep] probe audio:", e?.message || e);
    }
    return {
      done: true,
      status: st,
      url,
      provider: "acestep-studio",
      durationLabel,
      hasVocals: true,
      generationId: jobId,
    };
  }
  if (st === "failed" || st === "cancelled" || st === "canceled" || st === "error") {
    const raw = String(status?.error || status?.message || `Génération ACE-Step ${st}`);
    if (/out of memory|CUDA|VRAM/i.test(raw)) {
      throw new Error(`VRAM insuffisante — ${raw}`);
    }
    throw new Error(raw);
  }
  const eta = Number(status?.etaSeconds);
  return {
    done: false,
    status: st || "processing",
    progress: status?.progress,
    message: status?.stage || status?.message || "",
    stage: status?.stage || null,
    elapsedSeconds: 0,
    estimatedSeconds: Number.isFinite(eta) ? eta : 0,
    generationId: jobId,
  };
}

export async function cancelAceStep(keys, generationId) {
  const base = resolveAceStepBaseUrl(keys);
  const jobId = String(generationId || "").trim();
  if (!jobId) return { ok: false, skipped: true };
  try {
    await withAuth(base, (token) =>
      aceFetch(base, `/api/generate/cancel/${encodeURIComponent(jobId)}`, {
        method: "POST",
        token,
      }),
    );
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, skipped: true, message: e.message };
  }
}

export async function generateMusicWithAceStep(keys, opts = {}) {
  const started = await startAceStep(keys, opts);
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const tick = await pollAceStep(keys, started.generationId);
    if (tick.done) {
      return {
        url: tick.url,
        provider: tick.provider,
        durationLabel: tick.durationLabel || "~2–4 min",
        hasVocals: Boolean(tick.hasVocals),
        generationId: started.generationId,
      };
    }
    if (i % 10 === 0) {
      console.info("[acestep] poll", started.generationId, tick.status, tick.progress ?? "?", tick.message || "");
    }
  }
  throw new Error("Timeout ACE-Step Studio (~20 min) — vérifie GPU / Pinokio.");
}
