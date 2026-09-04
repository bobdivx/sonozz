export { mapGenreForStudio } from "../../lib/musicLane.js";

/**
 * Client SongGeneration Studio (Pinokio / Demeter).
 * API : POST /api/generate → poll /api/generation/:id → GET /api/audio/:id/0
 * @see https://github.com/BazedFrog/SongGeneration-Studio
 */

export const DEFAULT_BASE = "http://127.0.0.1:7860";

/** VRAM minimale indicative (Go) — aligné SongGeneration Studio. */
const MODEL_VRAM = {
  songgeneration_large: 22,
  songgeneration_base_full: 12,
  songgeneration_base_new: 10,
  songgeneration_base: 10,
};

/** Plus le rank est haut, meilleure est la qualité. */
const MODEL_RANK = {
  songgeneration_large: 4,
  songgeneration_base_full: 3,
  songgeneration_base_new: 2,
  songgeneration_base: 1,
};

/** Params d’inférence selon le modèle réellement choisi (matériel).
 * CFG un cran plus bas : >2.0 → rendu souvent saturé / dense. */
const MODEL_INFER_PARAMS = {
  songgeneration_large: {
    cfg_coef: 1.8,
    temperature: 0.72,
    top_k: 40,
    top_p: 0.0,
    extend_stride: 6,
    label: "Large · qualité max",
  },
  songgeneration_base_full: {
    cfg_coef: 1.85,
    temperature: 0.78,
    top_k: 45,
    top_p: 0.0,
    extend_stride: 6,
    label: "Base Full · durée + mix",
  },
  songgeneration_base_new: {
    cfg_coef: 1.8,
    temperature: 0.78,
    top_k: 45,
    top_p: 0.0,
    extend_stride: 5,
    label: "Base New · rapide",
  },
  songgeneration_base: {
    cfg_coef: 1.75,
    temperature: 0.8,
    top_k: 45,
    top_p: 0.0,
    extend_stride: 5,
    label: "Base · rapide",
  },
};

export { MODEL_INFER_PARAMS };

export function resolveSongGenBaseUrl(keys) {
  const raw = keys?.songGenBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function readyModelIds(catalog) {
  const ready = Array.isArray(catalog?.ready_models)
    ? catalog.ready_models
    : Array.isArray(catalog?.models)
      ? catalog.models.filter((m) => m?.status === "ready")
      : [];
  return ready.map((m) => String(m?.id || m || "").trim()).filter(Boolean);
}

/**
 * Meilleur modèle prêt qui tient dans la VRAM actuelle.
 * Fait confiance à Studio (`default`), avec overrides SONOZZ :
 * - préférence utilisateur (songGenPreferredModel)
 * - Large sur carte ≥22 Go totales / ≥18 Go libres (seuil Studio 22 trop strict sur 3090)
 *
 * @param {{ models?: array, ready_models?: array, default?: string, recommended?: string }} catalog
 * @param {{ preferredId?: string|null, freeGb?: number|null, totalGb?: number|null }} [opts]
 * @returns {{ modelId: string, reason: string, params: object, vramRequired: number|null, recommendedDownload: string|null }}
 */
export function pickSongGenModel(catalog = {}, opts = {}) {
  const readyIds = readyModelIds(catalog);
  const readySet = new Set(readyIds);
  const preferredId = String(opts?.preferredId || "").trim();
  const freeGb = Number(opts?.freeGb);
  const totalGb = Number(opts?.totalGb);
  const hasFree = Number.isFinite(freeGb);
  const hasTotal = Number.isFinite(totalGb);

  const pack = (modelId, reason) => {
    const params = MODEL_INFER_PARAMS[modelId] || MODEL_INFER_PARAMS.songgeneration_base;
    return {
      modelId,
      reason,
      params,
      vramRequired: MODEL_VRAM[modelId] || null,
      recommendedDownload: !readySet.has(catalog?.recommended)
        ? catalog?.recommended || null
        : null,
    };
  };

  if (preferredId && readySet.has(preferredId)) {
    return pack(preferredId, `forcé · ${preferredId}`);
  }

  // 3090 (24 Go) : le driver + OS mangent ~3–4 Go → free < 22 alors que Large tourne
  const largeOkSoft =
    readySet.has("songgeneration_large") &&
    ((hasFree && freeGb >= 18) || (hasTotal && totalGb >= 22));
  if (largeOkSoft) {
    return pack("songgeneration_large", "auto · Large (carte 24 Go / soft VRAM)");
  }

  // Source de vérité Studio : modèle prêt + VRAM libre
  const studioBest = String(catalog?.default || "").trim();
  if (studioBest && readySet.has(studioBest)) {
    return pack(studioBest, `auto · VRAM Studio → ${studioBest}`);
  }

  // Fallback : meilleur rank parmi les ready
  let best = null;
  let bestRank = -1;
  for (const id of readyIds) {
    const rank = MODEL_RANK[id] || 0;
    if (rank > bestRank) {
      bestRank = rank;
      best = id;
    }
  }
  const modelId = best || "songgeneration_base";
  return pack(modelId, `fallback · meilleur ready ${modelId}`);
}

/** @deprecated préférer pickSongGenModel(catalog) */
export function resolveQualityPreset() {
  return MODEL_INFER_PARAMS.songgeneration_large;
}

function findModelEntry(catalog, modelId) {
  const list = Array.isArray(catalog?.models) ? catalog.models : [];
  return list.find((m) => String(m?.id || "").trim() === modelId) || null;
}

/** Statut / progression d’un modèle Studio (ready, downloading, not_downloaded…). */
function modelDownloadInfo(catalog, modelId) {
  const entry = findModelEntry(catalog, modelId);
  if (!entry) {
    return {
      id: modelId,
      status: "unknown",
      progress: null,
      downloadedGb: null,
      totalGb: null,
      sizeGb: null,
      etaSeconds: null,
    };
  }
  return normalizeModelRow(entry, {});
}

export { readyModelIds, modelDownloadInfo };

function normalizeModelRow(entry, { pickedId = null, recommendedId = null } = {}) {
  const id = String(entry?.id || "").trim();
  const params = MODEL_INFER_PARAMS[id];
  const progress =
    typeof entry?.progress === "number"
      ? entry.progress
      : entry?.status === "ready"
        ? 100
        : null;
  const sizeGb = typeof entry?.size_gb === "number" ? entry.size_gb : null;
  const totalGb =
    typeof entry?.total_gb === "number" ? entry.total_gb : sizeGb;
  const status = String(entry?.status || "unknown");
  return {
    id,
    name: String(entry?.name || params?.label || id),
    description: String(entry?.description || ""),
    status,
    progress,
    downloadedGb:
      typeof entry?.downloaded_gb === "number" ? entry.downloaded_gb : null,
    totalGb,
    sizeGb,
    etaSeconds: typeof entry?.eta_seconds === "number" ? entry.eta_seconds : null,
    speedMbps: typeof entry?.speed_mbps === "number" ? entry.speed_mbps : null,
    warmth: entry?.warmth || null,
    vramRequired:
      typeof entry?.vram_required === "number"
        ? entry.vram_required
        : MODEL_VRAM[id] || null,
    rank: MODEL_RANK[id] || 0,
    qualityLabel: params?.label || null,
    isPicked: Boolean(pickedId && id === pickedId),
    isRecommended: Boolean(recommendedId && id === recommendedId),
    isLoaded: String(entry?.warmth || "") === "loaded",
  };
}

/** Catalogue Studio normalisé pour l’UI SONOZZ. */
export function normalizeSongGenCatalog(catalog = {}, pick = null) {
  const pickedId = pick?.modelId || catalog?.default || null;
  const recommendedId = catalog?.recommended || null;
  const raw = Array.isArray(catalog?.models) ? catalog.models : [];
  const models = raw
    .map((m) => normalizeModelRow(m, { pickedId, recommendedId }))
    .filter((m) => m.id)
    .sort((a, b) => (b.rank || 0) - (a.rank || 0));
  return {
    models,
    pickedModelId: pickedId,
    recommendedModelId: recommendedId,
    hasReadyModel: Boolean(catalog?.has_ready_model),
  };
}
