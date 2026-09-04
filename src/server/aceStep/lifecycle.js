import { isStudioEnabled } from "../../lib/keys.js";
import {
  resolveAceStepBaseUrl,
  aceStepModelLabel,
  aceStepDitSame,
  aceStepModelMeta,
  isAceStepEngineDit,
  listAceStepSwitchableModels,
  pickAceStepModel,
} from "./models.js";
import {
  DEFAULT_GPU_ARBITER,
  aceFetch,
  withAuth,
  normalizeModels,
  interpretAceProbe,
} from "./client.js";

/** Réveille ACE via l’arbitre GPU Demeter — soft si déjà up (évite systemd restart / 502).
 *  `exclusive: true` → acquire avec file d’attente + start (stop LLM/Wan) pour SFT / gros DiT.
 */
export async function ensureAceGpuSlot(
  keys,
  { timeoutMs = 120_000, exclusive = false } = {},
) {
  const arbiter = String(keys?.gpuArbiterUrl || process.env.GPU_ARBITER_URL || DEFAULT_GPU_ARBITER)
    .trim()
    .replace(/\/+$/, "");
  if (!arbiter) return { ok: false, skipped: true };

  const timeoutSec = Math.min(exclusive ? 600 : 120, Math.max(30, Math.round(timeoutMs / 1000)));

  try {
    // Gros DiT (SFT) : toujours passer par la file — libère LLM/Wan, attend Steam, etc.
    if (exclusive) {
      console.info("[acestep] GPU arbiter · acquire exclusif ace (file + stop LLM/Wan)…");
      const res = await fetch(`${arbiter}/acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "ace",
          owner: "sonozz-sft",
          timeout_s: timeoutSec,
          start: true,
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs + 10_000, 620_000)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        const err = data?.error || data?.message || `HTTP ${res.status}`;
        if (err === "steam_priority" || /steam/i.test(String(data?.message || ""))) {
          return {
            ok: false,
            arbiter,
            steam: true,
            error: data?.message || "GPU prioritaire Steam — réessaie après le jeu.",
            data,
          };
        }
        return { ok: false, arbiter, error: String(err), data };
      }
      // Attendre slot=ace stable (switch DiT peut laisser switching=true un moment).
      const deadline = Date.now() + Math.min(timeoutMs, 180_000);
      while (Date.now() < deadline) {
        const stRes = await fetch(`${arbiter}/status`, {
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        const st = stRes ? await stRes.json().catch(() => ({})) : {};
        if (st?.slot === "ace" && !st?.switching) {
          await fetch(`${arbiter}/touch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner: "sonozz-sft" }),
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          return {
            ok: true,
            arbiter,
            exclusive: true,
            data: {
              ...data,
              message: data.queued
                ? "acquired-queued → ace"
                : "acquired-exclusive → ace",
              slot: "ace",
              vram_used_mib: st.vram_used_mib,
              queue: st.queue,
            },
          };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return {
        ok: true,
        arbiter,
        exclusive: true,
        data: { ...data, message: "acquired-exclusive (slot pas encore stable)" },
      };
    }

    const stRes = await fetch(`${arbiter}/status`, { signal: AbortSignal.timeout(5000) });
    const st = await stRes.json().catch(() => ({}));
    if (st?.procs?.ace && !st?.switching) {
      if (st.slot === "ace") {
        await fetch(`${arbiter}/touch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: "sonozz" }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        return { ok: true, arbiter, data: { ok: true, message: "already", slot: "ace" } };
      }
      const soft = await fetch(`${arbiter}/acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: "ace",
          owner: "sonozz",
          timeout_s: timeoutSec,
          start: false,
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 130_000)),
      });
      const data = await soft.json().catch(() => ({}));
      if (soft.ok && data?.ok !== false) {
        return { ok: true, arbiter, data: { ...data, message: data.message || "acquired-soft" } };
      }
      // Process vivant : ne pas hard-ensure (restart).
      console.warn("[acestep] soft acquire failed, ACE process alive — skip hard ensure");
      return { ok: true, arbiter, data: { ok: true, message: "process-alive-bypass" } };
    }
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
    offload_dit_to_cpu: opts.offloadDitToCpu === true || opts.offloadToCpu === true,
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
      if (aceStepDitSame(active, id) && !/unload|loading|error|failed/.test(state)) {
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

/**
 * Ready ≠ résident GPU. Après switch SFT, la VRAM monte souvent pendant 1–3 min.
 * On attend usedGb ≥ seuil (pas seulement state=ready).
 */
export async function waitForAceStepResidentVram(
  keys,
  modelId,
  { budgetMs = 180_000, pollMs = 3_000 } = {},
) {
  const id = String(modelId || "").trim();
  const need = aceStepMinResidentVramGb(id);
  const start = Date.now();
  let lastGpu = null;
  while (Date.now() - start < budgetMs) {
    lastGpu = await readAceStepGpu(keys);
    const status = await testAceStep(keys, { ensure: false }).catch(() => null);
    const ghost = isAceStepGhostLoad(lastGpu, id, {
      offloadToCpu: status?.offloadToCpu,
    });
    if (!ghost && lastGpu?.usedGb != null) {
      console.info(
        `[acestep] DiT résident GPU · used ${lastGpu.usedGb}/${lastGpu.totalGb} Go` +
          ` (seuil ≥${need} Go · ${aceStepModelLabel(id)})`,
      );
      return { ok: true, gpu: lastGpu, need };
    }
    // offload=false + VRAM stable sous le vieux seuil 14 Go mais ≥10.5 → OK (chunked FFN)
    if (
      status?.offloadToCpu === false &&
      lastGpu?.usedGb != null &&
      lastGpu.usedGb >= need
    ) {
      return { ok: true, gpu: lastGpu, need };
    }
    // VRAM qui ne monte plus : inutile d’attendre 3 min
    if (
      status?.offloadToCpu === false &&
      lastGpu?.usedGb != null &&
      Date.now() - start > 20_000 &&
      lastGpu.usedGb < need
    ) {
      return {
        ok: false,
        gpu: lastGpu,
        need,
        message:
          `DiT ${aceStepModelLabel(id)} offload=false mais VRAM bloquée à ${lastGpu.usedGb} Go` +
          ` (seuil ≥${need}).`,
      };
    }
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.info(
      `[acestep] attente VRAM résidente ${aceStepModelLabel(id)}… ${elapsed}s` +
        ` · used=${lastGpu?.usedGb ?? "?"} Go · seuil≥${need}` +
        (status?.offloadToCpu === true ? " · offload=OUI" : ""),
    );
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    ok: false,
    gpu: lastGpu,
    need,
    message:
      `DiT ${aceStepModelLabel(id)} pas résident GPU après ${Math.round(budgetMs / 1000)}s` +
      ` (used ${lastGpu?.usedGb ?? "?"} Go, besoin ≥${need} Go).`,
  };
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
 * En dessous (ex. ~1–3 Go) = offload CPU / modèle fantôme → audio pourri.
 * XL SFT avec chunked FFN tient souvent ~11–13 Go (pas ~20 Go full).
 */
export function aceStepMinResidentVramGb(modelId) {
  const id = String(modelId || "");
  const vram = aceStepModelMeta(modelId)?.vramGb || 12;
  // SFT + chunkedFfn : ~12 Go résident typique sur 3090 (pas 18–20 Go).
  if (/sft/i.test(id) && !/turbo/i.test(id)) {
    return Math.max(10.5, Math.round(vram * 0.5 * 10) / 10);
  }
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
  const need = aceStepMinResidentVramGb(modelId);
  // Studio dit explicitement GPU résident : faire confiance si VRAM plausible.
  if (status && status.offloadToCpu === false && gpu.usedGb >= need) {
    return false;
  }
  return gpu.usedGb < need;
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
        `[acestep] DiT fantôme (~${gpu.usedGb} Go) — libération + re-init sans offload CPU…`,
      );
      // Libérer la carte avant re-pin (SongGen / job coincé) sinon SFT reste partiel.
      const baseUrl = resolveAceStepBaseUrl(keys);
      try {
        await withAuth(baseUrl, (token) =>
          aceFetch(baseUrl, "/api/generate/reset", {
            method: "POST",
            token,
            timeoutMs: 30000,
          }),
        );
        actions.push("reset-before-repin");
      } catch {
        /* optional */
      }
      try {
        if (isStudioEnabled(keys, "songgen")) {
          const { unloadSongGenModel } = await import("../songGeneration.js");
          await unloadSongGenModel(keys);
          actions.push("unload-songgen-before-repin");
        }
      } catch {
        /* optional */
      }
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await switchAceStepModel(keys, id, {
          initLm: false,
          offloadToCpu: false,
          offloadDitToCpu: false,
        });
        actions.push("disable-offload");
        const waited = await waitForAceStepModel(keys, id, { budgetMs: 180_000 });
        if (waited.ok) {
          const resident = await waitForAceStepResidentVram(keys, id, {
            budgetMs: 180_000,
          });
          if (resident.ok) {
            return {
              ok: true,
              freed: true,
              ghostFixed: true,
              gpu: resident.gpu,
              needFree,
              actions,
            };
          }
          gpu = resident.gpu || (await readAceStepGpu(keys));
        }
      } catch (e) {
        console.warn("[acestep] re-init sans offload échoué:", e?.message || e);
      }
    }
    const msg =
      `DiT ACE en offload CPU (~${gpu.usedGb} Go VRAM utilisés sur ${gpu.totalGb}). ` +
      `Audio serait pourri — pas de fallback Turbo automatique. ` +
      `Sur Demeter: ACESTEP_OFFLOAD_TO_CPU=0 puis ` +
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
      const { unloadSongGenModel } = await import("../songGeneration.js");
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
