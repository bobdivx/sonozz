import { isStudioEnabled } from "../lib/keys.js";
import { aceStepCommercialArrangementBits, composeAceStepStyle } from "../lib/musicLane.js";
import {
  normalizeFeatArtist,
  prepareAceStepLyrics,
  ensureAceStepDuoSingerTags,
  buildAceStepDuoStyle,
  vocalLockForArtist,
  vocalTimbreLine,
} from "../lib/featArtist.js";

/**
 * Client ACE-Step Studio (Pinokio).
 * Auth JWT local → POST /api/generate (custom) → poll /api/generate/status/:jobId
 * @see https://github.com/timoncool/ACE-Step-Studio
 */

/** Express ACE Demeter (tunnel public). Gradio Python = :7865 sur la machine GPU. */
const DEFAULT_BASE = "https://ace.briseteia.me";
const DEFAULT_GPU_ARBITER = "http://10.1.0.88:8790";
const POLL_MS = 3000;
const MAX_POLLS = 400;
const AUTH_USER = "sonozz";

/**
 * DiT réellement reconnus par le moteur Gradio ACE-Step (pas le catalogue UI Express).
 * L’UI Pinokio peut lister d’autres IDs (ex. Merge) avec is_preloaded — Gradio les refuse
 * (« Unknown DiT model »). Source : ACE-Step Studio README + IDs actifs observés.
 */
export const ACE_STEP_ENGINE_DIT_IDS = [
  "acestep-v15-xl-turbo",
  "acestep-v15-xl-sft",
  "acestep-v15-xl-base",
  "acestep-v15-xl-turbo-bf16",
  "marcorez8/acestep-v15-xl-turbo-bf16",
];

/** Métadonnées affichage / steps (hors moteur). */
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
    id: "acestep-v15-xl-turbo-bf16",
    label: "XL Turbo BF16",
    steps: 8,
    guidance: 0,
    vramGb: 8,
  },
  {
    id: "acestep-v15-xl-base",
    label: "XL Base",
    steps: 50,
    guidance: 7,
    vramGb: 20,
  },
  // Ghost UI Pinokio — pas un DiT Gradio
  {
    id: "acestep-v15-xl-merge-sft-turbo",
    label: "XL Merge",
    steps: 50,
    guidance: 7,
    vramGb: 16,
    engineKnown: false,
  },
];

const ENGINE_DIT_SET = new Set(ACE_STEP_ENGINE_DIT_IDS);

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

export function isAceStepEngineDit(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return false;
  if (ENGINE_DIT_SET.has(id)) return true;
  const meta = ACE_STEP_MODELS.find((m) => m.id === id);
  if (meta && meta.engineKnown === false) return false;
  // ID custom / HF inconnu : on laisse tenter le switch (pas Merge ghost)
  return !/merge-sft-turbo/i.test(id);
}

export function aceStepModelMeta(modelId) {
  const id = String(modelId || "").trim();
  return (
    ACE_STEP_MODELS.find((m) => m.id === id) ||
    ACE_STEP_MODELS.find((m) => m.id.endsWith(id.replace(/^.*\//, "")) && /turbo-bf16/i.test(m.id)) ||
    null
  );
}

export function aceStepModelLabel(modelId) {
  return aceStepModelMeta(modelId)?.label || String(modelId || "").replace(/^.*\//, "") || "auto";
}

/** IDs Gradio réellement utilisables, issus du catalogue Studio live. */
export function listAceStepSwitchableModels(catalogModels = []) {
  return (Array.isArray(catalogModels) ? catalogModels : []).filter(
    (m) => m?.engineKnown !== false && isAceStepEngineDit(m?.id || m?.name),
  );
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

/**
 * Choisit le DiT à envoyer : préférence user (si Gradio), sinon actif, sinon premier préchargé.
 * Ignore les IDs ghost UI (Merge, etc.).
 */
export function pickAceStepModel(catalog = {}, opts = {}) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const switchable = listAceStepSwitchableModels(models);
  const preferredId = String(opts?.preferredId || "").trim();
  const activeId = String(catalog?.activeModel || opts?.activeId || "").trim();
  const readyIds = switchable.filter((m) => m.isPreloaded || m.isActive).map((m) => m.id);
  const readySet = new Set(readyIds);
  const allSwitchableIds = new Set(switchable.map((m) => m.id));
  const duo = Boolean(opts?.duo);
  const forceId = String(opts?.forceModelId || "").trim();

  const turboBf16Short = "acestep-v15-xl-turbo-bf16";
  const turboBf16 = "marcorez8/acestep-v15-xl-turbo-bf16";
  const turbo = "acestep-v15-xl-turbo";
  const sft = "acestep-v15-xl-sft";

  if (forceId && isAceStepEngineDit(forceId)) {
    return { modelId: forceId, reason: `retry · ${aceStepModelLabel(forceId)}` };
  }

  const pickReady = (...ids) => {
    for (const id of ids) {
      if (readySet.has(id)) return id;
    }
    return null;
  };

  // Préférence utilisateur = priorité, seulement si DiT Gradio.
  if (preferredId && isAceStepEngineDit(preferredId)) {
    return {
      modelId: preferredId,
      reason: readySet.has(preferredId) || allSwitchableIds.has(preferredId)
        ? `forcé · ${aceStepModelLabel(preferredId)}${duo ? " · duo" : ""}`
        : `forcé · ${aceStepModelLabel(preferredId)} (téléchargement possible)`,
    };
  }

  if (activeId && isAceStepEngineDit(activeId)) {
    return {
      modelId: activeId,
      reason: `auto · déjà chargé (${aceStepModelLabel(activeId)})${duo ? " · duo" : ""}`,
    };
  }

  if (duo) {
    // Auto duo : Turbo BF16 d’abord (rapide) ; SFT reste dispo via préférence user.
    const id = pickReady(turboBf16Short, turboBf16, turbo, sft) || readyIds[0];
    if (id) return { modelId: id, reason: `duo · ${aceStepModelLabel(id)} (auto)` };
  }

  const auto =
    pickReady(turboBf16Short, turboBf16, turbo, sft) ||
    readyIds[0] ||
    switchable[0]?.id ||
    turboBf16Short;
  return { modelId: auto, reason: `auto · ${aceStepModelLabel(auto)}` };
}

export function lyricsForAceStepPreview(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, 16).join("\n");
}

/**
 * ACE chante les didascalies (« (Sound of static…) ») → bruit / intro inaudible.
 * On retire les parenthèses de mise en scène, on garde (ad-libs) courts.
 */
export function stripAceStageDirections(text) {
  return String(text || "")
    .replace(/^\s*\((?:sound of|sfx|fx|music|instrumental|distorted|fade|static)[^)]{0,160}\)\s*$/gim, "")
    .replace(/\((?:sound of|sfx|fx)[^)]{0,160}\)/gi, "")
    .replace(/^\s*\([^)]{20,160}\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Force du source audio en mode cover (0 = texte seul, 1 = clone).
 * 0.5 = groove / structure du titre phare, paroles originales.
 * Duo : plus bas pour garder le groove SANS coller un 2e morceau mono-voix.
 */
export const ACE_STYLE_TRANSFER_STRENGTH = 0.5;
export const ACE_DUO_STYLE_TRANSFER_STRENGTH = 0.18;

/** BPM max conseillé quand un feat doit rester audible (évite 172 Lose Yourself). */
export const ACE_DUO_BPM_CAP = 118;

/** Plage durée titres complets (secondes) — hits radio typiques. */
export const ACE_FULL_DURATION_MIN = 140; // ~2:20
export const ACE_FULL_DURATION_MAX = 250; // ~4:10

/**
 * Durée ACE-Step : preview courte, sinon explicite, sinon tirage commercial aléatoire.
 */
export function pickAceStepDurationSec({ preview = false, durationSec } = {}) {
  if (preview) {
    const n = Number(durationSec);
    return Math.min(45, Number.isFinite(n) && n > 0 ? Math.round(n) : 30);
  }
  const explicit = Number(durationSec);
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(480, Math.max(60, Math.round(explicit)));
  }
  const span = ACE_FULL_DURATION_MAX - ACE_FULL_DURATION_MIN;
  return Math.round(ACE_FULL_DURATION_MIN + Math.random() * span);
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
  referenceAudioUrl,
  referenceAudioTitle,
  audioCoverStrength,
  studioBase,
  styleLock,
  artist = null,
  featArtist = null,
}) {
  const meta = aceStepModelMeta(modelId);
  const isTurbo = Boolean(meta && meta.steps <= 8);
  const duration = pickAceStepDurationSec({ preview, durationSec });
  let refUrl = String(referenceAudioUrl || "").trim();
  if (isAceHostedAudioUrl(studioBase, refUrl)) refUrl = "";

  const lead = artist && typeof artist === "object" ? artist : null;
  const feat = normalizeFeatArtist(featArtist || lead?.featArtist);
  const isDuo = Boolean(feat?.name);
  const lyricsRaw = stripAceStageDirections(
    String(preview ? lyricsForAceStepPreview(lyrics) : lyrics || ""),
  );
  let lyricsClean = isDuo
    ? prepareAceStepLyrics(lyricsRaw, lead || { name: "Lead" }, feat)
    : lyricsRaw;
  if (isDuo) {
    lyricsClean = ensureAceStepDuoSingerTags(lyricsClean, lead || { name: "Lead" }, feat);
  }

  const strengthNum = Number(audioCoverStrength);
  const defaultStrength = isDuo ? ACE_DUO_STYLE_TRANSFER_STRENGTH : ACE_STYLE_TRANSFER_STRENGTH;
  const strength = Number.isFinite(strengthNum)
    ? Math.min(1, Math.max(0.05, strengthNum))
    : defaultStrength;

  let bpmOut = Number.isFinite(Number(bpm))
    ? Math.min(200, Math.max(60, Math.round(Number(bpm))))
    : undefined;
  if (isDuo && bpmOut != null && bpmOut > ACE_DUO_BPM_CAP) {
    bpmOut = ACE_DUO_BPM_CAP;
  }

  const styleBase = String(style || "");
  // Duo : style dédié depuis les genres réels — jamais « male rap + female » hardcodé,
  // et on évite le DNA mono-voix du styleLock (Eminem, etc.).
  let styleFinal;
  if (isDuo) {
    styleFinal = buildAceStepDuoStyle(lead || { name: "Lead" }, feat, {
      genreSummary: styleLock?.genreSummary || lead?.genre,
      mood: styleLock?.mood || lead?.mood,
      styleLock,
      styleBase,
    });
    if (!styleFinal) {
      styleFinal = composeAceStepStyle(styleBase, styleLock).slice(0, 1000);
    }
  } else {
    const lock = vocalLockForArtist(lead);
    const timbre = vocalTimbreLine(lock);
    const commercial = aceStepCommercialArrangementBits(styleLock, { duo: false }).join(". ");
    const sig = lock
      ? [
          `signature ${lock.genderCode || "lead"} vocals for ${lock.name}`,
          timbre || lock.voiceHint,
          lock.timbreHint ? `LOCK timbre = ${lock.timbreHint}` : null,
          `keep the same vocal identity and timbre as prior songs by ${lock.name}`,
        ]
          .filter(Boolean)
          .join(": ")
      : "";
    const composed = composeAceStepStyle(styleBase, styleLock);
    styleFinal = [commercial, sig, composed].filter(Boolean).join(". ").slice(0, 1200);
  }

  const body = {
    customMode: true,
    title: String(preview ? `${title || "SONOZZ"} · extrait` : title || "SONOZZ Track").slice(0, 120),
    style: styleFinal,
    lyrics: lyricsClean.slice(0, 8000),
    // ACE Studio captions = `style` ; `prompt` est un alias UI des paroles — on aligne sur lyrics.
    prompt: lyricsClean.slice(0, 8000),
    instrumental: false,
    vocalLanguage: String(language || "fr").slice(0, 8),
    duration,
    bpm: bpmOut,
    inferenceSteps: meta?.steps || (isTurbo ? 8 : 50),
    guidanceScale: meta ? meta.guidance : 0,
    ditModel: modelId || undefined,
    audioFormat: "mp3",
    randomSeed: true,
    pollinations: { enabled: false },
  };
  if (/^https?:\/\//i.test(refUrl)) {
    body.referenceAudioUrl = refUrl;
    body.sourceAudioUrl = refUrl;
    const refTitle = String(referenceAudioTitle || "").trim();
    if (refTitle) body.referenceAudioTitle = refTitle.slice(0, 160);
    body.audioCoverStrength = strength;
    // Noise bas en duo : trop haut → ACE remix « 2 titres en même temps ».
    body.coverNoiseStrength = isDuo ? 0.28 : 0.35;
    body.taskType = "cover";
    body.instruction = isDuo
      ? "ONE coherent duet song: keep groove/BPM energy from the reference only; do NOT clone its single-singer performance; obey [singer 1]/[singer 2] tags with two distinct voices; same production lane intro→outro; never glue two different songs or switch genre mid-track; full band, not a cappella:"
      : "Generate a STREAMING-READY commercial hit with multi-instrument arrangement and dynamic section changes (not a flat loop); vocals sit in a full band mix:";
    if (!isTurbo && (body.guidanceScale == null || body.guidanceScale < 7)) {
      body.guidanceScale = 7;
    }
  }
  return body;
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

/** Réveille ACE via l’arbitre GPU Demeter (POST /ensure). */
export async function ensureAceGpuSlot(keys, { timeoutMs = 120_000 } = {}) {
  const arbiter = String(keys?.gpuArbiterUrl || process.env.GPU_ARBITER_URL || DEFAULT_GPU_ARBITER)
    .trim()
    .replace(/\/+$/, "");
  if (!arbiter) return { ok: false, skipped: true };
  try {
    const res = await fetch(`${arbiter}/ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: "ace", owner: "sonozz" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data?.ok !== false, arbiter, data };
  } catch (e) {
    return { ok: false, arbiter, error: String(e?.message || e) };
  }
}

/** Ensure + attend que Gradio réponde (boot ACE = souvent 15–60s). */
export async function wakeAceStepPipeline(keys, { budgetMs = 90_000 } = {}) {
  const woke = await ensureAceGpuSlot(keys);
  if (!woke.ok && !woke.skipped) {
    console.warn("[acestep] ensure GPU échoué:", woke.error || woke.arbiter);
  } else {
    console.info("[acestep] ensure GPU ace…", woke.data?.message || woke.arbiter || "ok");
  }
  const base = resolveAceStepBaseUrl(keys);
  const start = Date.now();
  let last = null;
  while (Date.now() - start < budgetMs) {
    const health = await aceFetch(base, "/api/generate/health").catch((e) => ({
      healthy: false,
      error: e.message,
    }));
    const status = await aceFetch(base, "/api/generate/model-status").catch(() => ({}));
    last = interpretAceProbe({ health, status, base });
    if (last.pipelineUp || last.loading) {
      return { ok: true, woke, probe: last };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { ok: false, woke, probe: last };
}

export async function testAceStep(keys, { ensure = true } = {}) {
  const base = resolveAceStepBaseUrl(keys);
  const probeOnce = async () => {
    const [health, modelsRaw, status, sys] = await Promise.all([
      aceFetch(base, "/api/generate/health").catch((e) => ({ healthy: false, error: e.message })),
      aceFetch(base, "/api/generate/models").catch(() => ({ models: [] })),
      aceFetch(base, "/api/generate/model-status").catch(() => ({})),
      aceFetch(base, "/api/generate/system-info").catch(() => null),
    ]);
    return { health, modelsRaw, status, sys, interpreted: interpretAceProbe({ health, status, base }) };
  };

  let { health, modelsRaw, status, sys, interpreted } = await probeOnce();
  // Studio down OU Gradio down → réveil auto (pas seulement pipelineUp false).
  if (
    ensure &&
    !interpreted.loading &&
    (interpreted.unreachable || interpreted.pipelineUp === false)
  ) {
    console.info("[acestep] ACE down — wake via GPU Arbiter…");
    const wake = await wakeAceStepPipeline(keys);
    ({ health, modelsRaw, status, sys, interpreted } = await probeOnce());
    if (!interpreted.pipelineUp && !interpreted.loading && wake.probe) {
      interpreted = wake.probe;
    }
  }
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
  const gpu = parseAceStepGpu(sys);

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
    offloadToCpu: status?.offloadToCpu ?? null,
    pipelineState: String(status?.state || status?.status || "").trim() || null,
    pipelineUp: interpreted.pipelineUp,
    loading: Boolean(interpreted.loading),
    loadingModel: interpreted.loadingModel || null,
    message:
      interpreted.message ||
      (hasReadyModel
        ? `Joignable${activeModel ? ` · ${aceStepModelLabel(activeModel)}` : ""}`
        : "Joignable — aucun modèle chargé (ouvre ACE-Step Studio une fois)"),
  };
}

/**
 * @param {object} keys
 * @param {string} modelId
 * @param {{ initLm?: boolean, timeoutMs?: number }} [opts]
 */
export async function switchAceStepModel(keys, modelId, opts = {}) {
  const base = resolveAceStepBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId ACE-Step manquant");

  let catalogModels = [];
  try {
    let info = await testAceStep(keys);
    catalogModels = info.models || [];
    if (info.loading) {
      const target = info.loadingModel || id;
      console.info(`[acestep] DiT déjà en chargement (${aceStepModelLabel(target)}) — attente…`);
      const waited = await waitForAceStepModel(keys, target);
      if (waited.ok && target === id) {
        return { ok: true, model: id, waited: true };
      }
      if (!waited.ok && target === id) {
        throw new Error(info.message || "Chargement DiT trop long");
      }
      // Autre modèle en cours : on retente le probe puis le switch
    } else if (info.pipelineUp === false) {
      console.info("[acestep] switch : pipeline encore down — 2e wake…");
      await wakeAceStepPipeline(keys);
      info = await testAceStep(keys, { ensure: false });
      catalogModels = info.models || [];
      if (info.pipelineUp === false && !info.loading) {
        throw new Error(
          info.message ||
            "Moteur ACE-Step down (Gradio :7865) après réveil auto. Vérifie GPU Arbiter (:8790) / systemd ace-step-studio.",
        );
      }
    }
  } catch (e) {
    if (/Moteur ACE-Step down|Chargement DiT/i.test(e.message)) throw e;
    /* probe raté : on tente le switch quand même */
  }

  const available = listAceStepSwitchableModels(catalogModels);
  const availableLabels = available
    .map((m) => aceStepModelLabel(m.id))
    .filter((x, i, a) => a.indexOf(x) === i);
  const availableHint =
    availableLabels.length > 0
      ? availableLabels.join(", ")
      : "XL Turbo, XL SFT, XL Turbo BF16";

  if (!isAceStepEngineDit(id)) {
    throw new Error(
      `« ${aceStepModelLabel(id)} » n’est pas un DiT Gradio (souvent un fantôme de l’UI Pinokio). ` +
        `Modèles utilisables : ${availableHint}.`,
    );
  }

  const body = {
    model: id,
    // Gradio /v1/init hardcodait offload=true ; on force GPU (Demeter 3090).
    offload_to_cpu: opts.offloadToCpu === true,
    offload_dit_to_cpu: opts.offloadDitToCpu === true,
  };
  if (opts.initLm === false) {
    body.init_llm = false;
  } else if (opts.initLm === true && opts.lmModel) {
    body.init_llm = true;
    body.lm_model_path = String(opts.lmModel);
  }
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : ACE_SWITCH_TIMEOUT_MS;

  const doSwitch = () =>
    withAuth(base, (token) =>
      aceFetch(base, "/api/generate/switch-model", {
        method: "POST",
        token,
        body,
        timeoutMs,
      }),
    );

  try {
    const result = await doSwitch();
    return { ok: true, model: id, result };
  } catch (e) {
    const raw = String(e.message || "");
    if (/fetch failed|ECONNREFUSED|connected.:false|healthy.:false|délai dépassé|injoignable/i.test(raw)) {
      console.warn("[acestep] switch-model coupé — wake + retry…");
      await wakeAceStepPipeline(keys);
      try {
        const result = await doSwitch();
        return { ok: true, model: id, result, retried: true };
      } catch (e2) {
        throw new Error(
          "Changement de modèle impossible : Gradio ACE-Step (:7865) ne répond plus après réveil auto. Vérifie GPU Arbiter (:8790).",
        );
      }
    }
    if (/Unknown DiT model|Failed to download DiT/i.test(raw)) {
      throw new Error(
        `DiT « ${aceStepModelLabel(id)} » inconnu de Gradio. Modèles utilisables : ${availableHint}.`,
      );
    }
    throw e;
  }
}

const ACE_SWITCH_TIMEOUT_MS = 300_000;
const ACE_MODEL_READY_POLL_MS = 4_000;
const ACE_MODEL_READY_BUDGET_MS = 300_000;

/**
 * Pendant un load SFT, Studio ne répond souvent plus → on poll jusqu’à Ready.
 */
export async function waitForAceStepModel(keys, modelId, { budgetMs = ACE_MODEL_READY_BUDGET_MS } = {}) {
  const id = String(modelId || "").trim();
  if (!id) return { ok: false, message: "modelId manquant" };
  const base = resolveAceStepBaseUrl(keys);
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < budgetMs) {
    try {
      const status = await withAuth(base, (token) =>
        aceFetch(base, "/api/generate/model-status", { token, timeoutMs: 20000 }),
      );
      const active = String(status?.activeModel || status?.model || "").trim();
      const state = String(status?.state || status?.status || status?.phase || "").toLowerCase();
      if (active === id && !/unload|loading|error|failed/.test(state)) {
        return { ok: true, activeModel: active, state: state || "ready" };
      }
      if (/error|failed/.test(state)) {
        return {
          ok: false,
          activeModel: active,
          state,
          message: String(status?.error || status?.message || state),
        };
      }
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.info(
        `[acestep] attente ${aceStepModelLabel(id)}… ${elapsed}s` +
          ` · active=${active || "?"} · state=${state || "?"}`,
      );
    } catch (e) {
      lastErr = String(e?.message || e);
      console.info("[acestep] poll modèle (Studio occupé):", lastErr.slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, ACE_MODEL_READY_POLL_MS));
  }
  return { ok: false, message: lastErr || `timeout ${Math.round(budgetMs / 1000)}s attente modèle` };
}

function parseAceStepGpu(sys) {
  if (!sys || typeof sys !== "object") {
    return { name: null, totalGb: null, usedGb: null, freeGb: null };
  }
  const totalGb = Number(sys.vram_total);
  const usedGb = Number(sys.vram_used);
  return {
    name: sys.gpu || null,
    totalGb: Number.isFinite(totalGb) ? totalGb : null,
    usedGb: Number.isFinite(usedGb) ? usedGb : null,
    freeGb:
      Number.isFinite(totalGb) && Number.isFinite(usedGb)
        ? Math.round((totalGb - usedGb) * 10) / 10
        : null,
  };
}

/** Marge libre minimale pendant la diffusion (activations), hors poids du DiT déjà chargé. */
export function aceStepVramHeadroomGb(modelId) {
  const vram = aceStepModelMeta(modelId)?.vramGb || 12;
  return Math.max(2.5, Math.round(vram * 0.2 * 10) / 10);
}

/**
 * VRAM résidente minimale attendue quand le DiT est vraiment sur GPU.
 * En dessous (ex. ~1 Go) = offload CPU / modèle fantôme → audio pourri même en solo.
 */
export function aceStepMinResidentVramGb(modelId) {
  const vram = aceStepModelMeta(modelId)?.vramGb || 12;
  return Math.max(3.5, Math.round(vram * 0.4 * 10) / 10);
}

/**
 * DiT « fantôme » : UI ready mais poids surtout en RAM (`offload_to_cpu`).
 * @param {{ usedGb?: number|null, totalGb?: number|null }} gpu
 * @param {string} [modelId]
 * @param {{ offloadToCpu?: boolean }|null} [status]
 */
export function isAceStepGhostLoad(gpu, modelId, status = null) {
  if (status && status.offloadToCpu === true) return true;
  if (!gpu || gpu.usedGb == null || gpu.totalGb == null) return false;
  // Cartes <16 Go peuvent offloader légitimement ; Demeter 3090 = 24 Go.
  if (gpu.totalGb < 16) return false;
  return gpu.usedGb < aceStepMinResidentVramGb(modelId);
}

export async function readAceStepGpu(keys) {
  const base = resolveAceStepBaseUrl(keys);
  const sys = await aceFetch(base, "/api/generate/system-info").catch(() => null);
  return parseAceStepGpu(sys);
}

/**
 * Avant génération : lit la VRAM libre ; si trop serrée, tente de libérer
 * (reset GPU Studio + unload SongGen ; re-init DiT seulement si critique).
 * Détecte aussi le DiT fantôme (offload CPU → beaucoup de free, peu de used).
 * @param {{ modelId?: string, skipSwitch?: boolean }} [opts]
 *   skipSwitch: true après un switch SFT — évite un 2e chargement de plusieurs minutes.
 */
export async function ensureAceStepVram(keys, { modelId, skipSwitch = false } = {}) {
  const id = String(modelId || "").trim();
  const needFree = aceStepVramHeadroomGb(id);
  let gpu = await readAceStepGpu(keys);
  const actions = [];

  if (gpu.freeGb == null) {
    console.info("[acestep] VRAM indisponible via system-info — skip préflight");
    return { ok: true, skipped: true, gpu, needFree, actions };
  }

  console.info(
    `[acestep] VRAM préflight · libre ${gpu.freeGb}/${gpu.totalGb} Go` +
      (gpu.name ? ` · ${gpu.name}` : "") +
      ` · utilisé ${gpu.usedGb} Go` +
      ` · marge cible ≥${needFree} Go` +
      (id ? ` (${aceStepModelLabel(id)})` : ""),
  );

  // Beaucoup de free ≠ OK si le DiT n’est pas résident GPU (offload CPU).
  // Indépendant de skipSwitch : un switch SFT réactive souvent l’offload via /v1/init.
  if (isAceStepGhostLoad(gpu, id)) {
    if (id) {
      console.warn(
        `[acestep] DiT fantôme (~${gpu.usedGb} Go) — re-init sans offload CPU…`,
      );
      try {
        await switchAceStepModel(keys, id, { initLm: false, offloadToCpu: false });
        actions.push("disable-offload");
        const waited = await waitForAceStepModel(keys, id, { budgetMs: 180_000 });
        if (waited.ok) {
          // Laisse le DiT se poser en VRAM après Ready
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            gpu = await readAceStepGpu(keys);
            if (!isAceStepGhostLoad(gpu, id)) {
              console.info(
                `[acestep] DiT sur GPU après re-init · utilisé ${gpu.usedGb}/${gpu.totalGb} Go`,
              );
              return { ok: true, freed: true, ghostFixed: true, gpu, needFree, actions };
            }
          }
        }
      } catch (e) {
        console.warn("[acestep] re-init sans offload échoué:", e?.message || e);
      }
    }
    const msg =
      `DiT ACE en offload CPU (~${gpu.usedGb} Go VRAM utilisés sur ${gpu.totalGb}). ` +
      `Audio sera pourri. Sur Demeter: ACESTEP_OFFLOAD_TO_CPU=0 puis ` +
      `systemctl --user restart ace-step-studio (attendu ≥${aceStepMinResidentVramGb(id)} Go utilisés).`;
    console.warn("[acestep]", msg);
    return { ok: false, ghost: true, gpu, needFree, actions, message: msg };
  }

  if (gpu.freeGb >= needFree) {
    return { ok: true, freed: false, gpu, needFree, actions };
  }

  console.warn(
    `[acestep] VRAM serrée (${gpu.freeGb} Go libres < ${needFree}) — tentative libération…`,
  );

  const base = resolveAceStepBaseUrl(keys);

  // 1) Annuler un job GPU coincé (si l’API Studio le propose)
  try {
    await withAuth(base, (token) =>
      aceFetch(base, "/api/generate/reset", {
        method: "POST",
        token,
        timeoutMs: 30000,
      }),
    );
    actions.push("reset");
    console.info("[acestep] reset GPU Studio OK");
  } catch {
    /* endpoint absent ou rien à reset */
  }

  // 2) Décharger SongGen s’il tient encore la carte (même machine)
  try {
    if (isStudioEnabled(keys, "songgen")) {
      const { unloadSongGenModel } = await import("./songGeneration.js");
      await unloadSongGenModel(keys);
      actions.push("unload-songgen");
      console.info("[acestep] SongGen unload OK (libération VRAM)");
    }
  } catch (e) {
    console.warn("[acestep] unload SongGen ignoré:", e?.message || e);
  }

  // 3) Re-init DiT sans LM seulement si VRAM quasi nulle (sinon SFT = +5 min inutiles)
  const criticallyLow = gpu.freeGb < 1.5;
  if (!skipSwitch && criticallyLow) {
    const target =
      id || String((await testAceStep(keys).catch(() => ({})))?.activeModel || "").trim();
    if (target) {
      try {
        await switchAceStepModel(keys, target, { initLm: false });
        actions.push("unload-lm");
        console.info("[acestep] switch-model sans LM OK ·", aceStepModelLabel(target));
      } catch (e) {
        console.warn("[acestep] libération LM ignorée:", e.message);
      }
    }
  } else if (skipSwitch || !criticallyLow) {
    console.info(
      "[acestep] skip re-init DiT (évite rechargement long)" +
        (skipSwitch ? " · après switch" : ` · libre ${gpu.freeGb} Go`),
    );
  }

  await new Promise((r) => setTimeout(r, 800));
  gpu = await readAceStepGpu(keys);

  const stillTight = gpu.freeGb != null && gpu.freeGb < Math.min(needFree, 2.5);
  if (stillTight) {
    console.warn(
      `[acestep] VRAM encore serrée après libération (${gpu.freeGb}/${gpu.totalGb} Go). ` +
        `Ferme d’autres apps GPU ou relance ACE-Step en No LM.`,
    );
  } else if (gpu.freeGb != null) {
    console.info(`[acestep] VRAM après libération · libre ${gpu.freeGb}/${gpu.totalGb} Go`);
  }

  return {
    ok: !stillTight,
    freed: actions.length > 0,
    gpu,
    needFree,
    actions,
    message: stillTight
      ? `VRAM encore serrée (${gpu.freeGb}/${gpu.totalGb} Go libres). Relance ACE-Step en No LM ou ferme les apps GPU.`
      : null,
  };
}

const ACE_NAN_LATENTS_RE =
  /NaN or Inf latents|produced NaN|nan=\d+/i;
const ACE_VRAM_RE =
  /out of memory|CUDA out of memory|cuDNN.*OOM|insufficient.*VRAM|ran out of memory/i;

export function isAceNanLatentsError(err) {
  return ACE_NAN_LATENTS_RE.test(String(err?.message || err || ""));
}

export function isAceVramError(err) {
  const raw = String(err?.message || err || "");
  if (ACE_NAN_LATENTS_RE.test(raw)) return false;
  return ACE_VRAM_RE.test(raw);
}

/** Modèle de secours léger après NaN / OOM. */
export const ACE_FALLBACK_LIGHT_MODEL = "marcorez8/acestep-v15-xl-turbo-bf16";

const GRADIO_CACHE_ERROR_RE =
  /not uploaded by a user|check_in_upload_folder|InvalidPathError|gradio cache dir/i;

const ACE_INVALID_REF_RE =
  /reference audio is invalid|unreadable, or silent|invalid, unreadable|pas un fichier audio/i;

export function isGradioReferenceCacheError(err) {
  return GRADIO_CACHE_ERROR_RE.test(String(err?.message || err || ""));
}

/** Réf. cover inutilisable : Gradio cache OU fichier silent/HTML/S3 illisible. */
export function isUnusableAceReferenceError(err) {
  const raw = String(err?.message || err || "");
  return isGradioReferenceCacheError(raw) || ACE_INVALID_REF_RE.test(raw) || /ACE_REF_UNUSABLE/i.test(raw);
}

/** MP3 / WAV / OGG / M4A — pas une page HTML ni un XML S3. */
export function looksLikeAudioBuffer(buffer, mimeType = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length < 4096) return false;
  const mime = String(mimeType || "");
  if (/html|json|xml|text\/plain/i.test(mime) && !/audio|mpeg|mp4|ogg|wav/i.test(mime)) {
    return false;
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
  if (
    bytes.length > 11 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  return false;
}

/** Express Studio = :8001 (ou tunnel), Gradio Python = :7865 (souvent loopback Demeter). */
export function resolveAceStepGradioUrl(keys, studioBase) {
  const explicit = String(keys?.aceStepGradioUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (explicit) return explicit;
  const base = String(studioBase || resolveAceStepBaseUrl(keys)).replace(/\/+$/, "");
  try {
    const u = new URL(base);
    // Express Demeter (:8001) ou tunnel public : uploads via le même host (proxy Studio).
    if (u.port === "8001" || u.port === "7865" || !isLanOrLoopbackHost(u.hostname)) {
      return base;
    }
    // Ancien layout UI :3001 → Gradio LAN :7865
    u.port = "7865";
    return String(u).replace(/\/+$/, "");
  } catch {
    return "";
  }
}

/** Tunnel / Express d’abord, puis Gradio dérivé (:7865 LAN). */
export function gradioUploadBases(keys, studioBase) {
  const studio = String(studioBase || resolveAceStepBaseUrl(keys)).replace(/\/+$/, "");
  const derived = resolveAceStepGradioUrl(keys, studio);
  return [...new Set([studio, derived].filter(Boolean))];
}

/**
 * Fichier hébergé par l’UI ACE (`/audio/…`).
 * Le Studio le recopie dans `app/temp/gradio/ref-*` → Gradio 5 refuse
 * (« was not uploaded by a user »).
 */
export function isAceHostedAudioUrl(studioBase, url) {
  const s = String(url || "").trim();
  if (!s) return false;
  if (s.startsWith("/audio/")) return true;
  try {
    const u = new URL(s);
    if (!u.pathname.startsWith("/audio/")) return false;
    if (!studioBase) return false;
    const base = new URL(studioBase);
    return u.hostname === base.hostname && (u.port || "") === (base.port || "");
  } catch {
    return false;
  }
}

export function gradioFileUrl(gradioBase, localPath) {
  const base = String(gradioBase || "").replace(/\/+$/, "");
  const p = String(localPath || "").trim().replace(/\\/g, "/");
  if (!base || !p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return `${base}/gradio_api/file=${p}`;
}

export function extractGradioUploadUrl(gradioBase, data) {
  const pick = (item) => {
    if (!item) return "";
    if (typeof item === "string") {
      if (/^https?:\/\//i.test(item)) return item;
      return gradioFileUrl(gradioBase, item);
    }
    if (typeof item === "object") {
      if (/^https?:\/\//i.test(item.url || "")) return String(item.url);
      if (item.path) return gradioFileUrl(gradioBase, item.path);
    }
    return "";
  };
  if (Array.isArray(data)) return pick(data[0]);
  if (data && typeof data === "object" && data.files) {
    return pick(Array.isArray(data.files) ? data.files[0] : data.files);
  }
  return pick(data);
}

function extFromPreview(url, mimeType) {
  const path = String(url || "").split("?")[0].toLowerCase();
  if (/\.mp3$/i.test(path) || /mpeg|mp3/i.test(mimeType)) return "mp3";
  if (/\.m4a$/i.test(path) || /mp4|m4a|aac/i.test(mimeType)) return "m4a";
  if (/\.wav$/i.test(path) || /wav/i.test(mimeType)) return "wav";
  if (/\.ogg$/i.test(path) || /ogg/i.test(mimeType)) return "ogg";
  if (/\.flac$/i.test(path) || /flac/i.test(mimeType)) return "flac";
  return "mp3";
}

async function downloadPreviewBuffer(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SONOZZ/1.0; +https://sonozz.briseteia.me)",
      Accept: "audio/*,*/*",
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Preview HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Preview audio vide");
  const mimeType = res.headers.get("content-type") || "audio/mpeg";
  if (!looksLikeAudioBuffer(buffer, mimeType)) {
    throw new Error("Preview n’est pas un fichier audio (HTML / vide / silencieux)");
  }
  return { buffer, mimeType };
}

/**
 * Upload via l’API officielle Gradio (`/gradio_api/upload`).
 * Le path renvoyé est dans le vrai cache Gradio — contrairement à
 * ACE `app/temp/gradio/ref-*` qui déclenche InvalidPathError.
 */
export async function uploadReferenceToGradio(gradioBase, buffer, fileName = "style-ref.mp3", mimeType = "audio/mpeg") {
  const base = String(gradioBase || "").replace(/\/+$/, "");
  if (!base) return "";
  const safeName = String(fileName || "style-ref.mp3")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
  const endpoints = [`${base}/gradio_api/upload`, `${base}/upload`];
  for (const endpoint of endpoints) {
    const form = new FormData();
    form.append("files", blob, safeName);
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      continue;
    }
    if (!res.ok) continue;
    const data = await res.json().catch(() => null);
    const url = extractGradioUploadUrl(base, data);
    if (url) return url;
  }
  return "";
}

/**
 * @deprecated Ne plus utiliser pour une référence style : ACE recopie `/audio/`
 * dans `temp/gradio/ref-*` et Gradio 5 refuse le fichier.
 */
export async function uploadAceStepReference(keys, buffer, fileName = "style-ref.mp3", mimeType = "audio/mpeg") {
  const base = resolveAceStepBaseUrl(keys);
  const safeName = String(fileName || "style-ref.mp3")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 80);
  const form = new FormData();
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const file =
    typeof File !== "undefined"
      ? new File([bytes], safeName, { type: mimeType || "audio/mpeg" })
      : new Blob([bytes], { type: mimeType || "audio/mpeg" });
  form.append("audio", file, safeName);

  return withAuth(base, async (token) => {
    let res;
    try {
      res = await fetch(`${base}/api/generate/upload-audio`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      throw new Error(`Upload réf. ACE-Step injoignable. ${errText(e).slice(0, 120)}`);
    }
    const ct = res.headers.get("content-type") || "";
    const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(apiError("/api/generate/upload-audio", data, res.status));
    }
    const url = String(data?.url || data?.publicUrl || "").trim();
    if (!url) throw new Error("ACE-Step n’a pas renvoyé d’URL de référence");
    return resolveAceAudioUrl(base, url);
  });
}

/**
 * Prépare une URL de référence que Gradio / ACE peuvent vraiment charger.
 * Uniquement l’upload officiel Gradio — S3 / iTunes en cover → Gradio dit
 * « invalid, unreadable, or silent » (HTML 403 ou fichier non décodable).
 */
export async function ensureAceStepStyleReference(keys, previewUrl) {
  const url = String(previewUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  const studioBase = resolveAceStepBaseUrl(keys);
  if (isAceHostedAudioUrl(studioBase, url)) return "";

  let buffer;
  let mimeType = "audio/mpeg";
  try {
    const downloaded = await downloadPreviewBuffer(url);
    buffer = downloaded.buffer;
    mimeType = downloaded.mimeType;
  } catch (e) {
    console.warn("[acestep] preview réf. ignoré:", e.message);
    return "";
  }
  const ext = extFromPreview(url, mimeType);

  for (const gradioBase of gradioUploadBases(keys, studioBase)) {
    try {
      const hosted = await uploadReferenceToGradio(gradioBase, buffer, `style-ref.${ext}`, mimeType);
      if (hosted && !isAceHostedAudioUrl(studioBase, hosted)) {
        console.info("[acestep] réf. via Gradio", gradioBase);
        return hosted;
      }
    } catch (e) {
      console.warn("[acestep] upload Gradio ignoré:", gradioBase, e.message);
    }
  }

  console.warn("[acestep] cover ignoré — pas d’upload Gradio (S3 rejeté comme silent/unreadable)");
  return "";
}

export async function startAceStep(keys, {
  prompt,
  lyrics,
  title,
  language,
  bpm,
  preview = false,
  referenceAudioUrl,
  referenceAudioTitle,
  styleLock,
  artist = null,
  audioCoverStrength,
  forceModelId = null,
  /** Lab : style/lyrics bruts, sans compose duo / DNA artiste. */
  labMode = false,
  durationSec = undefined,
} = {}) {
  const base = resolveAceStepBaseUrl(keys);
  let info = await testAceStep(keys);
  if (info.loading) {
    const target = info.loadingModel || String(keys?.aceStepPreferredModel || "").trim();
    console.info(
      `[acestep] attente fin de chargement (${aceStepModelLabel(target || "DiT")})…`,
    );
    if (target) await waitForAceStepModel(keys, target);
    info = await testAceStep(keys);
  }
  if (info.pipelineUp === false && !info.loading) {
    throw new Error(
      info.message ||
        `Moteur ACE-Step down (${base}). Pinokio : Stop puis Start (No LM si Sonozz).`,
    );
  }
  const catalog = { models: info.models, activeModel: info.activeModel };
  const duo = labMode ? false : Boolean(normalizeFeatArtist(artist?.featArtist)?.name);
  const pick = pickAceStepModel(catalog, {
    preferredId: String(keys?.aceStepPreferredModel || "").trim() || null,
    duo,
    forceModelId,
  });
  const active = String(catalog.activeModel || "").trim();
  const needSwitch = Boolean(pick.modelId && active && pick.modelId !== active);
  if (needSwitch) {
    try {
      const probe = await testAceStep(keys);
      if (probe.pipelineUp === false) {
        throw new Error(
          "Moteur ACE-Step down (Gradio). Pinokio : Stop → Start (No LM), charge ton modèle, réessaie.",
        );
      }
      console.info(
        `[acestep] chargement ${aceStepModelLabel(pick.modelId)} (peut prendre plusieurs minutes)…`,
      );
      await switchAceStepModel(keys, pick.modelId);
    } catch (e) {
      // Timeout fréquent pendant load SFT : Studio mute mais continue côté GPU.
      // On poll Ready puis on lance quand même (ditModel dans le body).
      console.warn("[acestep] switch-model:", e.message);
      if (/ne répond plus|ECONNREFUSED/i.test(e.message)) throw e;
      if (
        /Moteur ACE-Step down/i.test(e.message) &&
        !/délai dépassé|injoignable/i.test(e.message)
      ) {
        throw e;
      }
      const waited = await waitForAceStepModel(keys, pick.modelId);
      if (waited.ok) {
        console.info(`[acestep] ${aceStepModelLabel(pick.modelId)} Ready après attente`);
      } else {
        console.warn(
          `[acestep] ${aceStepModelLabel(pick.modelId)} pas confirmé Ready — ` +
            `génération quand même (ditModel). (${String(waited.message || e.message).slice(0, 140)})`,
        );
      }
    }
  }

  // Préflight VRAM : pas de 2e switch DiT (évite un autre timeout SFT)
  try {
    const vram = await ensureAceStepVram(keys, {
      modelId: pick.modelId,
      skipSwitch: true,
    });
    if (vram.ghost) {
      throw new Error(vram.message || "DiT ACE en offload CPU (modèle fantôme)");
    }
    if (vram.message) console.warn("[acestep]", vram.message);
  } catch (e) {
    if (/offload CPU|modèle fantôme/i.test(String(e?.message || e))) throw e;
    console.warn("[acestep] préflight VRAM ignoré:", e?.message || e);
  }

  if (duo) {
    console.info("[acestep] duo — modèle", pick.modelId, pick.reason);
  }

  let refUrl = String(referenceAudioUrl || "").trim();
  if (isAceHostedAudioUrl(base, refUrl)) refUrl = "";
  if (/^https?:\/\//i.test(refUrl)) {
    try {
      refUrl = (await ensureAceStepStyleReference(keys, refUrl)) || "";
    } catch (e) {
      console.warn("[acestep] preview référence ignoré:", e.message);
      refUrl = "";
    }
  } else {
    refUrl = "";
  }
  if (isAceHostedAudioUrl(base, refUrl)) refUrl = "";

  const meta = aceStepModelMeta(pick.modelId);
  const isTurbo = Boolean(meta && meta.steps <= 8);
  let body;
  if (labMode) {
    const styleFinal = String(prompt || "").trim().slice(0, 2000) || "pop music";
    const lyricsClean = String(lyrics || "").trim().slice(0, 8000);
    const strengthNum = Number(audioCoverStrength);
    body = {
      customMode: true,
      title: String(preview ? `${title || "LAB"} · extrait` : title || "ACE Lab").slice(0, 120),
      style: styleFinal,
      lyrics: lyricsClean,
      prompt: lyricsClean,
      instrumental: !lyricsClean,
      vocalLanguage: String(language || "en").slice(0, 8),
      duration: pickAceStepDurationSec({
        preview,
        durationSec: preview ? 30 : durationSec,
      }),
      bpm: Number.isFinite(Number(bpm))
        ? Math.min(200, Math.max(60, Math.round(Number(bpm))))
        : undefined,
      inferenceSteps: meta?.steps || (isTurbo ? 8 : 50),
      guidanceScale: meta ? meta.guidance : 0,
      ditModel: pick.modelId || undefined,
      audioFormat: "mp3",
      randomSeed: true,
      pollinations: { enabled: false },
    };
    if (/^https?:\/\//i.test(refUrl)) {
      body.referenceAudioUrl = refUrl;
      body.sourceAudioUrl = refUrl;
      const refTitle = String(referenceAudioTitle || "").trim();
      if (refTitle) body.referenceAudioTitle = refTitle.slice(0, 160);
      body.audioCoverStrength = Number.isFinite(strengthNum)
        ? Math.min(1, Math.max(0.05, strengthNum))
        : 0.35;
      body.coverNoiseStrength = 0.35;
      body.taskType = "cover";
    }
  } else {
    body = buildAceStepBody({
      title,
      style: prompt,
      lyrics,
      language,
      bpm,
      durationSec: preview ? 30 : undefined,
      modelId: pick.modelId,
      preview,
      referenceAudioUrl: refUrl,
      referenceAudioTitle,
      audioCoverStrength,
      studioBase: base,
      styleLock,
      artist,
      featArtist: artist?.featArtist,
    });
  }

  console.info(
    "[acestep] start…",
    base,
    body.title,
    preview ? "PREVIEW" : "FULL",
    labMode ? "LAB" : "pipeline",
    `model=${pick.modelId}`,
    `pick=${pick.reason}`,
    `steps=${body.inferenceSteps}`,
    `lang=${body.vocalLanguage}`,
    `dur=${body.duration}s`,
    `bpm=${body.bpm || "?"}`,
    `task=${body.taskType || "text2music"}`,
    `str=${body.audioCoverStrength ?? "-"}`,
    body.sourceAudioUrl ? "src=ON" : "src=OFF",
    refUrl ? `ref=${String(referenceAudioTitle || "").slice(0, 40) || "audio"}` : "ref=OFF",
  );

  const created = await withAuth(base, (token) =>
    aceFetch(base, "/api/generate", { method: "POST", token, body }),
  );
  const jobId = created?.jobId || created?.job_id;
  if (!jobId) throw new Error("ACE-Step n’a pas renvoyé de jobId");
  const gpu = await readAceStepGpu(keys).catch(() => null);
  return {
    generationId: jobId,
    provider: "acestep-studio",
    base,
    model: pick.modelId,
    quality: aceStepModelLabel(pick.modelId),
    pickReason: pick.reason,
    gpu: gpu?.freeGb != null ? gpu : null,
    usedReference: Boolean(body.referenceAudioUrl),
    referenceAudioTitle: body.referenceAudioTitle || null,
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

  let status;
  try {
    status = await withAuth(base, (token) =>
      aceFetch(base, `/api/generate/status/${encodeURIComponent(jobId)}`, { token }),
    );
  } catch (e) {
    const code = Number(e?.status) || 0;
    const msg = String(e?.message || "");
    if (
      code === 404 ||
      code === 409 ||
      /HTTP 404|not found|unknown job|no such job/i.test(msg)
    ) {
      return {
        done: false,
        status: "queued",
        message: "Job ACE-Step pas encore visible — on réessaie…",
        generationId: jobId,
      };
    }
    throw e;
  }
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
    if (isAceNanLatentsError(raw)) {
      throw new Error(
        `ACE_NAN_LATENTS: Génération NaN (souvent XL SFT corrompu / offload foireux / VRAM saturée). Relance en Turbo BF16. Détail: ${raw.slice(0, 220)}`,
      );
    }
    if (isAceVramError(raw)) {
      throw new Error(`VRAM insuffisante — ${raw.slice(0, 280)}`);
    }
    if (isUnusableAceReferenceError(raw)) {
      throw new Error(
        "ACE_REF_UNUSABLE: ACE-Step a rejeté l’audio de référence (invalide, illisible ou silencieux). Relance sans cover.",
      );
    }
    throw new Error(raw);
  }
  const eta = Number(status?.etaSeconds);
  const gpu = await readAceStepGpu(keys).catch(() => null);
  const stage = status?.stage || null;
  const rawMsg = status?.stage || status?.message || "";
  return {
    done: false,
    status: st || "processing",
    progress: status?.progress,
    message: rawMsg,
    stage,
    gpu: gpu?.freeGb != null ? gpu : null,
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
  const run = (extra = {}) => generateMusicWithAceStepOnce(keys, { ...opts, ...extra });
  try {
    return await run();
  } catch (e) {
    if (isUnusableAceReferenceError(e) && opts.referenceAudioUrl) {
      console.warn("[acestep] réf. rejetée — retry sans cover");
      return run({ referenceAudioUrl: "" });
    }
    if (
      (isAceNanLatentsError(e) || isAceVramError(e)) &&
      !opts.forceModelId &&
      opts.forceModelId !== ACE_FALLBACK_LIGHT_MODEL
    ) {
      console.warn("[acestep] NaN/VRAM — retry Turbo BF16:", e.message);
      try {
        await switchAceStepModel(keys, ACE_FALLBACK_LIGHT_MODEL);
      } catch (sw) {
        console.warn("[acestep] switch Turbo BF16:", sw.message);
      }
      return run({
        forceModelId: ACE_FALLBACK_LIGHT_MODEL,
        referenceAudioUrl: "",
      });
    }
    throw e;
  }
}

async function generateMusicWithAceStepOnce(keys, opts = {}) {
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
