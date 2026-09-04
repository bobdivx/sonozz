import { isStudioEnabled } from "../../lib/keys.js";

/**
 * Catalogue DiT ACE-Step / meta / pick modèle.
 * @see https://github.com/timoncool/ACE-Step-Studio
 */

/** Express ACE Demeter (tunnel public). Gradio Python = :7865 sur la machine GPU. */
export const DEFAULT_BASE = "https://ace.briseteia.me";

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
/**
 * CFG SFT/Base : 6.5–7 « over-saturate » le rendu (harsh, dense).
 * 5.5 = assez fidèle au prompt, plus d’air dans le mix.
 * Peak norm Studio défaut −1 dBFS = master trop hot → −2.5 dB de headroom.
 */
export const ACE_SFT_GUIDANCE = 5.5;
export const ACE_NORMALIZATION_DB = -2.5;

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
    guidance: ACE_SFT_GUIDANCE,
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
    guidance: ACE_SFT_GUIDANCE,
    vramGb: 20,
  },
  // Ghost UI Pinokio — pas un DiT Gradio
  {
    id: "acestep-v15-xl-merge-sft-turbo",
    label: "XL Merge",
    steps: 50,
    guidance: ACE_SFT_GUIDANCE,
    vramGb: 16,
    engineKnown: false,
  },
];

const ENGINE_DIT_SET = new Set(ACE_STEP_ENGINE_DIT_IDS);

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

/** Basename DiT (`acestep-v15-xl-sft` ↔ `org/acestep-v15-xl-sft`). */
export function aceStepDitBasename(modelId) {
  return String(modelId || "")
    .trim()
    .replace(/^.*\//, "")
    .toLowerCase();
}

export function aceStepDitSame(a, b) {
  const x = aceStepDitBasename(a);
  const y = aceStepDitBasename(b);
  return Boolean(x && y && x === y);
}

/** Steps / guidance du DiT réellement chargé (évite 50 steps + CFG 7 sur Turbo). */
export function aceStepInferenceForModel(modelId) {
  const meta = aceStepModelMeta(modelId);
  const id = aceStepDitBasename(modelId);
  const isTurbo = /turbo/i.test(id) && !/merge/i.test(id);
  if (meta) {
    return {
      inferenceSteps: meta.steps,
      guidanceScale: meta.guidance,
      isTurbo: Boolean(meta.steps <= 8) || isTurbo,
    };
  }
  return {
    inferenceSteps: isTurbo ? 8 : 50,
    guidanceScale: isTurbo ? 0 : ACE_SFT_GUIDANCE,
    isTurbo,
  };
}

/** IDs Gradio réellement utilisables, issus du catalogue Studio live. */
export function listAceStepSwitchableModels(catalogModels = []) {
  return (Array.isArray(catalogModels) ? catalogModels : []).filter(
    (m) => m?.engineKnown !== false && isAceStepEngineDit(m?.id || m?.name),
  );
}

/**
 * Choisit le DiT à envoyer : préférence user (si Gradio), sinon actif, sinon premier préchargé.
 * Ignore les IDs ghost UI (Merge, etc.).
 * SFT est autorisé si préféré ; la porte VRAM (résidence GPU) est appliquée après switch.
 */
export function isAceStepSftModel(modelId) {
  const id = String(modelId || "");
  return /sft/i.test(id) && !/turbo/i.test(id);
}

export function pickAceStepModel(catalog = {}, opts = {}) {
  const models = Array.isArray(catalog?.models) ? catalog.models : [];
  const switchable = listAceStepSwitchableModels(models);
  const preferredId = String(opts?.preferredId || "").trim();
  const activeId = String(catalog?.activeModel || opts?.activeId || "").trim();
  const readyIds = switchable.filter((m) => m.isPreloaded || m.isActive).map((m) => m.id);
  const readySet = new Set(readyIds);
  const allSwitchableIds = new Set(switchable.map((m) => m.id));
  const duo = Boolean(opts?.duo);
  const sameSexDuo = Boolean(opts?.sameSexDuo);
  // Preview / duo same-sex : Turbo d’abord (SFT → mash / vocoder fréquent).
  const preferTurbo = Boolean(opts?.preferTurbo || opts?.preview || sameSexDuo);
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

  if (preferTurbo) {
    const id =
      pickReady(turboBf16Short, turboBf16, turbo) ||
      pickReady(sft) ||
      readyIds[0] ||
      turboBf16Short;
    return {
      modelId: id,
      reason: sameSexDuo
        ? `duo same-sex · ${aceStepModelLabel(id)} (Turbo privilégié)`
        : opts?.preview || opts?.preferTurbo
          ? `preview · ${aceStepModelLabel(id)} (Turbo privilégié)`
          : `pipeline · ${aceStepModelLabel(id)} (Turbo privilégié)`,
    };
  }

  // Préférence utilisateur = priorité (SFT inclus — porte VRAM après switch).
  if (preferredId && isAceStepEngineDit(preferredId)) {
    return {
      modelId: preferredId,
      reason: readySet.has(preferredId) || allSwitchableIds.has(preferredId)
        ? `forcé · ${aceStepModelLabel(preferredId)}${duo ? " · duo" : ""}`
        : `forcé · ${aceStepModelLabel(preferredId)} (téléchargement possible)`,
      needsResidentGate: isAceStepSftModel(preferredId),
    };
  }

  if (activeId && isAceStepEngineDit(activeId)) {
    return {
      modelId: activeId,
      reason: `auto · déjà chargé (${aceStepModelLabel(activeId)})${duo ? " · duo" : ""}`,
      needsResidentGate: isAceStepSftModel(activeId),
    };
  }

  if (duo) {
    const id = pickReady(turboBf16Short, turboBf16, turbo, sft) || readyIds[0];
    if (id) {
      return {
        modelId: id,
        reason: `duo · ${aceStepModelLabel(id)} (auto)`,
        needsResidentGate: isAceStepSftModel(id),
      };
    }
  }

  const auto =
    pickReady(turboBf16Short, turboBf16, turbo, sft) ||
    readyIds[0] ||
    switchable[0]?.id ||
    turboBf16Short;
  return {
    modelId: auto,
    reason: `auto · ${aceStepModelLabel(auto)}`,
    needsResidentGate: isAceStepSftModel(auto),
  };
}

/** Modèle de secours léger après NaN / OOM. */
export const ACE_FALLBACK_LIGHT_MODEL = "marcorez8/acestep-v15-xl-turbo-bf16";
