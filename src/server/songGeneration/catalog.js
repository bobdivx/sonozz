import { resolveSongGenBaseUrl, pickSongGenModel, readyModelIds, normalizeSongGenCatalog, modelDownloadInfo } from "./models.js";
import { songGenFetch, parseGpuFromHealth } from "./client.js";

async function fetchSongGenModelsCatalog(base) {
  return songGenFetch(base, "/api/models");
}

export async function startSongGenModelDownload(
  keys,
  modelId = "songgeneration_large",
) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "songgeneration_large").trim();
  if (!id) throw new Error("modelId manquant");

  let catalog;
  try {
    catalog = await fetchSongGenModelsCatalog(base);
  } catch {
    catalog = null;
  }
  const info = catalog ? modelDownloadInfo(catalog, id) : null;
  if (info?.status === "ready") {
    return { ok: true, alreadyReady: true, base, modelId: id, model: info };
  }
  if (info?.status === "downloading") {
    return { ok: true, alreadyDownloading: true, base, modelId: id, model: info };
  }

  let result;
  try {
    result = await songGenFetch(base, `/api/models/${encodeURIComponent(id)}/download`, {
      method: "POST",
    });
  } catch (e) {
    const msg = String(e?.message || e);
    // Studio répond 400 si déjà en cours / déjà prêt — on renvoie un statut propre
    if (/already downloading/i.test(msg)) {
      let mid = info;
      try {
        mid = modelDownloadInfo(await fetchSongGenModelsCatalog(base), id);
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        alreadyDownloading: true,
        base,
        modelId: id,
        model: mid || { id, status: "downloading", progress: null },
      };
    }
    if (/already downloaded|already ready/i.test(msg)) {
      return {
        ok: true,
        alreadyReady: true,
        base,
        modelId: id,
        model: { id, status: "ready", progress: 100 },
      };
    }
    throw e;
  }
  let after = info;
  try {
    after = modelDownloadInfo(await fetchSongGenModelsCatalog(base), id);
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    started: true,
    base,
    modelId: id,
    model: after,
    studio: result,
  };
}

/** Annule un téléchargement en cours (DELETE /api/models/{id}/download). */
export async function cancelSongGenModelDownload(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");
  const result = await songGenFetch(
    base,
    `/api/models/${encodeURIComponent(id)}/download`,
    { method: "DELETE" },
  );
  return { ok: true, base, modelId: id, studio: result };
}

/** Supprime un modèle téléchargé du disque Studio (DELETE /api/models/{id}). */
export async function deleteSongGenModel(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");
  const result = await songGenFetch(base, `/api/models/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  return { ok: true, base, modelId: id, studio: result };
}

/** Décharge le modèle actuellement en VRAM. */
export async function unloadSongGenModel(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const result = await songGenFetch(base, "/api/model-server/unload", { method: "POST" });
  return { ok: true, base, studio: result };
}

/**
 * Charge un modèle en VRAM.
 * Hot-swap Studio casse souvent (« resolver eval already registered ») —
 * on tente unload → load, puis stop/start du model-server en secours.
 */
export async function loadSongGenModel(keys, modelId) {
  const base = resolveSongGenBaseUrl(keys);
  const id = String(modelId || "").trim();
  if (!id) throw new Error("modelId manquant");

  const tryLoad = async () =>
    songGenFetch(base, `/api/model-server/load/${encodeURIComponent(id)}`, {
      method: "POST",
    });

  try {
    await songGenFetch(base, "/api/model-server/unload", { method: "POST" });
  } catch {
    /* pas de modèle chargé */
  }

  try {
    const result = await tryLoad();
    return { ok: true, base, modelId: id, loaded: true, studio: result };
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/already registered|Failed to load model/i.test(msg)) throw e;

    // Restart model-server puis reload
    try {
      await songGenFetch(base, "/api/model-server/stop", { method: "POST" });
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await songGenFetch(base, "/api/model-server/start", { method: "POST" });
    } catch (startErr) {
      return {
        ok: true,
        base,
        modelId: id,
        loaded: false,
        hotSwapIssue: true,
        message:
          "Impossible de relancer le model-server Studio. Stop/Start Pinokio, puis Retester.",
        studioError: String(startErr?.message || startErr),
      };
    }
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await tryLoad();
      return {
        ok: true,
        base,
        modelId: id,
        loaded: true,
        restartedServer: true,
        studio: result,
      };
    } catch (e2) {
      return {
        ok: true,
        base,
        modelId: id,
        loaded: false,
        hotSwapIssue: true,
        message:
          "Studio n’a pas pu charger le modèle après restart. Stop/Start Pinokio, puis Retester.",
        studioError: String(e2?.message || e2),
      };
    }
  }
}

export async function testSongGeneration(keys) {
  const base = resolveSongGenBaseUrl(keys);
  const health = await songGenFetch(base, "/api/health");
  const gpu = parseGpuFromHealth(health);
  let models;
  try {
    models = await fetchSongGenModelsCatalog(base);
  } catch {
    models = null;
  }
  const ready = Boolean(models?.has_ready_model);
  const preferredId = String(keys?.songGenPreferredModel || "").trim() || null;
  const pick =
    models && ready
      ? pickSongGenModel(models, {
          preferredId,
          freeGb: gpu.freeGb,
          totalGb: gpu.totalGb,
        })
      : null;
  const readyList = readyModelIds(models || {});
  const catalog = models
    ? normalizeSongGenCatalog(models, pick)
    : { models: [] };
  const large =
    catalog.models.find((m) => m.id === "songgeneration_large") ||
    (models ? modelDownloadInfo(models, "songgeneration_large") : null);
  const needDownload =
    large && large.status !== "ready" && large.status !== "unknown"
      ? "songgeneration_large"
      : models?.recommended && !readyList.includes(models.recommended)
        ? models.recommended
        : null;

  const vramBit =
    gpu.freeGb != null && gpu.totalGb != null
      ? ` · VRAM ${gpu.freeGb}/${gpu.totalGb} Go`
      : "";

  if (models && !ready) {
    return {
      base,
      health,
      gpu,
      defaultModel: models?.default || null,
      recommended: models?.recommended || null,
      pickedModel: null,
      pickReason: "aucun modèle prêt",
      vramRequired: null,
      readyModels: [],
      qualityPreset: "auto",
      hasReadyModel: false,
      hasLarge: false,
      recommendDownload: needDownload || models?.recommended || "songgeneration_large",
      largeModel: large,
      models: catalog.models,
      preferredModel: preferredId,
      message: `Studio OK${vramBit} — aucun modèle prêt. Télécharge Large (~20 Go).`,
    };
  }

  const studioDefault = models?.default || null;
  let message = `Joignable · ${pick?.reason || `auto ${pick?.modelId}`}${vramBit}`;
  if (
    large?.status === "ready" &&
    pick?.modelId !== "songgeneration_large" &&
    studioDefault !== "songgeneration_large"
  ) {
    message += " — clique Utiliser sur Large (Studio exige 22 Go libres)";
  }

  return {
    base,
    health,
    gpu,
    defaultModel: studioDefault,
    recommended: models?.recommended || null,
    pickedModel: pick?.modelId || studioDefault || null,
    pickReason: pick?.reason || null,
    vramRequired: pick?.vramRequired || null,
    readyModels: readyList,
    qualityPreset: pick?.params?.label || "auto",
    hasReadyModel: ready || models == null,
    hasLarge: readyList.includes("songgeneration_large") || large?.status === "ready",
    recommendDownload: needDownload,
    largeModel: large,
    models: catalog.models,
    preferredModel: preferredId,
    message,
  };
}
