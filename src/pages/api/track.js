import { json, error, readBody } from "../../server/http.js";
import { runTrack, startTrack, pollTrack, cancelTrack } from "../../server/pipeline.js";
import {
  cancelSongGenModelDownload,
  deleteSongGenModel,
  loadSongGenModel,
  resolveSongGenBaseUrl,
  songGenLanHint,
  startSongGenModelDownload,
  testSongGeneration,
  unloadSongGenModel,
} from "../../server/songGeneration.js";
import {
  aceStepLanHint,
  resolveAceStepBaseUrl,
  startAceStep,
  switchAceStepModel,
  testAceStep,
} from "../../server/aceStep.js";
import { testReplicateToken } from "../../server/replicate.js";

function songGenProbePayload(info) {
  const large = info.largeModel;
  let message = info.message || "Joignable";
  if (!info.message && large?.status === "downloading") {
    const pct =
      typeof large.progress === "number" ? ` · ${Math.round(large.progress)}%` : "";
    message = `Joignable · téléchargement Large${pct}`;
  }
  return {
    ok: true,
    base: info.base,
    defaultModel: info.defaultModel || null,
    pickedModel: info.pickedModel || null,
    pickReason: info.pickReason || null,
    vramRequired: info.vramRequired || null,
    readyModels: info.readyModels || [],
    hasLarge: Boolean(info.hasLarge),
    recommendDownload: info.recommendDownload || null,
    largeModel: info.largeModel || null,
    models: Array.isArray(info.models) ? info.models : [],
    preferredModel: info.preferredModel || null,
    gpu: info.gpu || null,
    qualityPreset: info.qualityPreset || "auto",
    hasReadyModel: info.hasReadyModel,
    message,
  };
}

async function withFreshProbe(keys, result) {
  let probe = null;
  try {
    probe = songGenProbePayload(await testSongGeneration(keys));
  } catch (e) {
    probe = {
      ok: false,
      message: e.message || "Probe impossible",
      models: [],
    };
  }
  return { ok: true, ...result, probe };
}

export async function POST({ request }) {
  let body = {};
  try {
    body = await readBody(request);
    const action = String(body?.action || "start").trim();

    if (action === "probe-acestep") {
      const base = resolveAceStepBaseUrl(body?.keys || {});
      const requestHost =
        request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
      try {
        const info = await testAceStep(body?.keys || {});
        return json({
          ok: info.pipelineUp !== false,
          base: info.base,
          activeModel: info.activeModel || null,
          pickedModel: info.pickedModel || null,
          pickReason: info.pickReason || null,
          models: info.models || [],
          preferredModel: info.preferredModel || null,
          gpu: info.gpu || null,
          offloadToCpu: info.offloadToCpu ?? null,
          pipelineState: info.pipelineState || null,
          hasReadyModel: info.hasReadyModel,
          pipelineUp: info.pipelineUp,
          loading: info.loading || false,
          loadingModel: info.loadingModel || null,
          message: info.message || "Joignable",
        });
      } catch (e) {
        const hint = aceStepLanHint(base, requestHost);
        return json({
          ok: false,
          base,
          models: [],
          message: `${e.message || "ACE-Step injoignable"}${hint}`,
        });
      }
    }

    if (action === "switch-acestep-model") {
      const keys = body?.keys || {};
      const modelId = String(body?.modelId || "").trim();
      if (!modelId) return error("modelId manquant", 400);
      try {
        const switched = await switchAceStepModel(keys, modelId, {
          initLm: false,
          offloadToCpu: false,
        });
        let probe = null;
        try {
          const info = await testAceStep(keys);
          probe = {
            ok: true,
            base: info.base,
            activeModel: info.activeModel || null,
            pickedModel: info.pickedModel || null,
            models: info.models || [],
            gpu: info.gpu || null,
            offloadToCpu: info.offloadToCpu ?? null,
            pipelineState: info.pipelineState || null,
            hasReadyModel: info.hasReadyModel,
            message: info.message || "Joignable",
          };
        } catch (e) {
          probe = { ok: false, message: e.message, models: [] };
        }
        return json({ ok: true, switched, probe });
      } catch (e) {
        return json({ ok: false, message: e.message || "Switch impossible" }, 500);
      }
    }

    if (action === "lab-acestep") {
      const keys = body?.keys || {};
      const style = String(body?.style || body?.prompt || "").trim();
      const lyrics = String(body?.lyrics || "").trim();
      if (!style && !lyrics) {
        return error("Style ou paroles requis", 400);
      }
      try {
        const started = await startAceStep(keys, {
          prompt: style,
          lyrics,
          title: String(body?.title || "ACE Lab").trim() || "ACE Lab",
          language: String(body?.language || "en").trim() || "en",
          bpm: body?.bpm,
          preview: Boolean(body?.preview),
          durationSec: body?.durationSec,
          referenceAudioUrl: String(body?.referenceAudioUrl || "").trim(),
          referenceAudioTitle: String(body?.referenceAudioTitle || "").trim(),
          audioCoverStrength: body?.audioCoverStrength,
          forceModelId: String(body?.modelId || "").trim() || null,
          labMode: true,
        });
        return json({
          ok: true,
          ...started,
          lab: true,
        });
      } catch (e) {
        console.error("[track] lab-acestep", e?.message || e);
        return error(e.message || "Lab ACE impossible", 500);
      }
    }

    if (action === "probe-replicate") {
      const token = String(body?.keys?.replicateApiToken || "").trim();
      if (!token) {
        return json({ ok: false, message: "Token Replicate absent" });
      }
      try {
        const account = await testReplicateToken(token);
        return json({
          ok: true,
          message: `Compte OK (${account.username || account.name || "ok"})`,
        });
      } catch (e) {
        return json({ ok: false, message: e.message || "Token Replicate invalide" });
      }
    }

    if (action === "probe-songgen") {
      const base = resolveSongGenBaseUrl(body?.keys || {});
      const requestHost =
        request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
      try {
        const info = await testSongGeneration(body?.keys || {});
        return json(songGenProbePayload(info));
      } catch (e) {
        const hint = songGenLanHint(base, requestHost);
        return json({
          ok: false,
          base,
          models: [],
          message: `${e.message || "SongGeneration injoignable"}${hint}`,
        });
      }
    }

    if (action === "download-songgen-model") {
      const keys = body?.keys || {};
      const modelId = String(body?.modelId || "songgeneration_large").trim();
      try {
        const started = await startSongGenModelDownload(keys, modelId);
        return json(await withFreshProbe(keys, started));
      } catch (e) {
        return json({
          ok: false,
          message: e.message || "Téléchargement impossible",
        });
      }
    }

    if (action === "cancel-songgen-download") {
      const keys = body?.keys || {};
      const modelId = String(body?.modelId || "").trim();
      if (!modelId) return error("modelId manquant", 400);
      try {
        const cancelled = await cancelSongGenModelDownload(keys, modelId);
        return json(await withFreshProbe(keys, cancelled));
      } catch (e) {
        return json({
          ok: false,
          message: e.message || "Annulation impossible",
        });
      }
    }

    if (action === "delete-songgen-model") {
      const keys = body?.keys || {};
      const modelId = String(body?.modelId || "").trim();
      if (!modelId) return error("modelId manquant", 400);
      try {
        const deleted = await deleteSongGenModel(keys, modelId);
        return json(await withFreshProbe(keys, deleted));
      } catch (e) {
        return json({
          ok: false,
          message: e.message || "Suppression impossible",
        });
      }
    }

    if (action === "load-songgen-model") {
      const keys = body?.keys || {};
      const modelId = String(body?.modelId || "").trim();
      if (!modelId) return error("modelId manquant", 400);
      try {
        const loaded = await loadSongGenModel(keys, modelId);
        return json(await withFreshProbe(keys, loaded));
      } catch (e) {
        return json({
          ok: false,
          message: e.message || "Chargement VRAM impossible",
        });
      }
    }

    if (action === "unload-songgen-model") {
      const keys = body?.keys || {};
      try {
        const unloaded = await unloadSongGenModel(keys);
        return json(await withFreshProbe(keys, unloaded));
      } catch (e) {
        return json({
          ok: false,
          message: e.message || "Déchargement impossible",
        });
      }
    }

    if (action === "poll") {
      if (!body?.generationId) return error("generationId manquant", 400);
      const data = await pollTrack(body);
      return json(data);
    }

    if (action === "cancel") {
      if (!body?.generationId) return error("generationId manquant", 400);
      const data = await cancelTrack(body);
      return json({ ok: true, ...data });
    }

    if (action === "sync") {
      const data = await runTrack(body);
      return json(data);
    }

    const data = await startTrack(body);
    return json(data);
  } catch (e) {
    const action = String(body?.action || "start").trim();
    console.error("[track]", action, e?.message || e);
    return error(e.message || "Erreur morceau", 500);
  }
}

export const prerender = false;
