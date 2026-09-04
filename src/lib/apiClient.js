import { loadKeys } from "./keys.js";

function toAbortSignal(signal) {
  if (!signal) return undefined;
  if (typeof AbortSignal !== "undefined" && signal instanceof AbortSignal) return signal;
  if (typeof signal.aborted !== "boolean") return undefined;
  const ac = new AbortController();
  if (signal.aborted) {
    ac.abort();
    return ac.signal;
  }
  const iv = setInterval(() => {
    if (signal.aborted) {
      clearInterval(iv);
      ac.abort();
    }
  }, 200);
  ac.signal.addEventListener("abort", () => clearInterval(iv), { once: true });
  return ac.signal;
}

async function request(path, body = {}, opts = {}) {
  const keys = loadKeys();
  const signal = toAbortSignal(opts.signal);
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, ...body }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || opts.signal?.aborted) {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      throw err;
    }
    throw e;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur API ${res.status}`);
  }
  return data;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const fail = () => {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) {
      fail();
      return;
    }
    let iv;
    const t = setTimeout(() => {
      clearInterval(iv);
      resolve();
    }, ms);
    iv = setInterval(() => {
      if (signal?.aborted) {
        clearTimeout(t);
        clearInterval(iv);
        fail();
      }
    }, 200);
  });
}

function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
}

function shortModelLabel(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return "";
  if (/xl-sft$/i.test(id) && !/merge/i.test(id)) return "XL SFT";
  if (/turbo-bf16/i.test(id)) return "XL Turbo BF16";
  if (/merge-sft-turbo/i.test(id)) return "XL Merge";
  if (/xl-turbo/i.test(id)) return "XL Turbo";
  return id.replace(/^.*\//, "");
}

/** Pourcentage affiché — SongGen reste à ~35 % pendant le long infer ; on lisse avec l’ETA. */
function formatTrackProgress(tick = {}) {
  let percent = Number(tick.progress);
  if (!Number.isFinite(percent)) percent = 0;
  percent = Math.max(0, Math.min(100, percent));

  const elapsed = Number(tick.elapsedSeconds) || 0;
  const estimated = Number(tick.estimatedSeconds) || 0;
  const msg = String(tick.message || "").trim();
  const status = String(tick.status || "processing");
  const modelLabel = shortModelLabel(tick.model || tick.quality);
  const stage = String(tick.stage || "").trim();

  // Phase génération GPU : progress API souvent figé à 35 — interpoler via ETA
  if (
    status === "processing" &&
    percent >= 30 &&
    percent < 95 &&
    estimated > 0 &&
    elapsed > 0
  ) {
    const timePct = 35 + Math.min(55, (elapsed / estimated) * 55);
    percent = Math.max(percent, Math.min(95, Math.round(timePct)));
  } else if (status === "processing" && percent < 5 && elapsed > 5) {
    percent = Math.min(30, 5 + Math.floor(elapsed / 4));
  }

  // Message court : pas de VRAM ni modèle (affichés par StudioGpuMeter)
  let message = msg || (status === "pending" ? "En file…" : "Génération…");
  if (stage && !msg) message = stage;
  if (elapsed > 0) {
    const eta =
      estimated > elapsed
        ? ` · reste ~${formatElapsed(estimated - elapsed)}`
        : estimated > 0
          ? " · finalisation…"
          : "";
    message = `${message} (${formatElapsed(elapsed)}${eta})`;
  }

  return {
    percent: Math.max(0, Math.min(99, Math.round(percent))),
    message,
    status,
    stage: stage || null,
    model: tick.model || null,
    modelLabel: modelLabel || null,
    gpu: tick.gpu || null,
    phase: tick.phase || "generating",
    elapsedSeconds: elapsed,
    estimatedSeconds: estimated,
    musicKind: tick.musicKind || null,
  };
}

/**
 * Avant start ACE : probe VRAM + charge le DiT voulu avec retours live
 * (évite le silence UX pendant un switch SFT de plusieurs minutes).
 */
async function prepareAceStepClient(payload, onProgress, signal) {
  const keys = loadKeys();
  const provider = String(keys?.musicProvider || "").trim();
  if (provider !== "acestep") return null;
  if (!keys || String(keys.aceStepEnabled || "1") === "0") return null;

  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      throw err;
    }
  };

  onProgress?.({
    percent: 3,
    phase: "probe",
    message: "Connexion ACE-Step · lecture VRAM…",
  });
  throwIfAborted();

  let probe;
  try {
    probe = await request("/api/track", { action: "probe-acestep" }, { signal });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    onProgress?.({
      percent: 4,
      phase: "probe",
      message: `ACE-Step : ${String(e.message || e).slice(0, 120)}`,
    });
    return null;
  }

  const targetId =
    String(payload?.forceAceModelId || "").trim() ||
    String(keys.aceStepPreferredModel || "").trim() ||
    String(probe?.pickedModel || "").trim() ||
    String(probe?.activeModel || "").trim();
  const active = String(probe?.activeModel || "").trim();
  const gpu = probe?.gpu || null;
  const targetLabel = shortModelLabel(targetId) || "auto";

  onProgress?.({
    percent: 5,
    phase: "probe",
    model: active || targetId || null,
    modelLabel: shortModelLabel(active || targetId) || null,
    gpu,
    message: "Studio joignable",
  });

  if (!targetId || (active && active === targetId)) {
    return { probe, model: active || targetId, gpu };
  }

  onProgress?.({
    percent: 6,
    phase: "loading-model",
    model: targetId,
    modelLabel: targetLabel,
    gpu,
    message: "Chargement du modèle… (plusieurs minutes possibles)",
  });

  const switchPromise = request(
    "/api/track",
    { action: "switch-acestep-model", modelId: targetId },
    { signal },
  )
    .then((r) => ({ ok: true, result: r }))
    .catch((e) => ({ ok: false, error: e }));

  const startedAt = Date.now();
  while (true) {
    throwIfAborted();
    const settled = await Promise.race([
      switchPromise.then((r) => ({ type: "switch", ...r })),
      sleep(4000, signal).then(() => ({ type: "tick" })),
    ]);

    let latest = probe;
    try {
      latest = await request("/api/track", { action: "probe-acestep" }, { signal });
    } catch {
      /* Studio mute pendant le load */
    }
    const nowActive = String(latest?.activeModel || "").trim();
    const nowGpu = latest?.gpu || gpu;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    onProgress?.({
      percent: Math.min(11, 6 + Math.floor(secs / 30)),
      phase: "loading-model",
      model: targetId,
      modelLabel: targetLabel,
      gpu: nowGpu,
      message:
        nowActive === targetId
          ? "Modèle prêt"
          : `Chargement en cours… ${formatElapsed(secs)}`,
    });

    if (nowActive === targetId) {
      await switchPromise.catch(() => {});
      return { probe: latest, model: targetId, gpu: nowGpu };
    }
    if (settled.type === "switch") {
      if (!settled.ok && settled.error?.name === "AbortError") throw settled.error;
      onProgress?.({
        percent: 10,
        phase: "loading-model",
        model: targetId,
        modelLabel: targetLabel,
        gpu: nowGpu,
        message: settled.ok
          ? "Modèle chargé"
          : "Chargement encore en cours côté Studio",
      });
      return { probe: latest, model: targetId, gpu: nowGpu };
    }
    if (secs > 360) {
      return { probe: latest, model: targetId, gpu: nowGpu };
    }
  }
}

/**
 * Start + poll court (évite Cloudflare 524 — gen audio 2–10 min).
 * @param {object} payload
 * @param {(p: { percent: number, message: string }) => void} [onProgress]
 * @param {{ signal?: AbortSignal | { aborted?: boolean }, onStarted?: Function, generationId?: string, musicKind?: string, draft?: object }} [opts]
 */
async function trackWithPoll(payload = {}, onProgress, opts = {}) {
  const signal = opts.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      throw err;
    }
  };

  throwIfAborted();
  const isPreview = Boolean(payload?.preview);
  onProgress?.({
    percent: 5,
    phase: "starting",
    message: isPreview ? "Démarrage extrait audio…" : "Démarrage génération audio…",
  });

  let prepared = null;
  if (!opts.generationId) {
    try {
      prepared = await prepareAceStepClient(payload, onProgress, signal);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      console.warn("[track] prepare ACE ignoré:", e?.message || e);
    }
  }

  let started;
  if (opts.generationId && opts.musicKind) {
    started = {
      pollNeeded: true,
      generationId: opts.generationId,
      musicKind: opts.musicKind,
      draft: opts.draft,
    };
  } else {
    onProgress?.({
      percent: 11,
      phase: "starting",
      model: prepared?.model || null,
      modelLabel: shortModelLabel(prepared?.model) || null,
      gpu: prepared?.gpu || null,
      message: isPreview
        ? `Lancement extrait${prepared?.model ? ` · ${shortModelLabel(prepared.model)}` : ""}…`
        : `Lancement génération${prepared?.model ? ` · ${shortModelLabel(prepared.model)}` : ""}…`,
    });
    started = await request("/api/track", { ...payload, action: "start" }, { signal });
    throwIfAborted();
    opts.onStarted?.(started);
  }
  throwIfAborted();
  if (!started?.pollNeeded) {
    const { pollNeeded: _p, musicKind: _m, generationId: _g, draft, ...rest } = started || {};
    if (draft && typeof draft === "object") return { ...draft, ...rest };
    return rest;
  }

  const startedModel =
    started.model || started.draft?.aceStepModel || prepared?.model || null;
  const startedGpu = started.gpu || prepared?.gpu || null;

  onProgress?.({
    percent: 12,
    phase: "generating",
    model: startedModel,
    modelLabel: shortModelLabel(startedModel) || started.quality || null,
    gpu: startedGpu,
    message:
      started.musicKind === "acestep"
        ? isPreview
          ? "Extrait ACE-Step — génération GPU…"
          : "ACE-Step — génération GPU…"
        : started.musicKind === "songgen"
          ? isPreview
            ? "Extrait SongGen — attente GPU…"
            : "SongGen démarré — attente GPU…"
          : isPreview
            ? "Extrait MiniMax — attente Replicate…"
            : "MiniMax démarré — attente Replicate…",
    musicKind: started.musicKind,
  });

  const isLocalGpu = started.musicKind === "songgen" || started.musicKind === "acestep";
  const maxPolls = isLocalGpu ? (isPreview ? 200 : 400) : 180;
  const intervalMs = isLocalGpu ? 3000 : 2500;

  try {
    for (let i = 0; i < maxPolls; i++) {
      throwIfAborted();
      await sleep(intervalMs, signal);
      throwIfAborted();
      let tick;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          tick = await request(
            "/api/track",
            {
              action: "poll",
              generationId: started.generationId,
              musicKind: started.musicKind,
              draft: started.draft,
            },
            { signal },
          );
          break;
        } catch (e) {
          if (e?.name === "AbortError") throw e;
          const msg = String(e?.message || "");
          const transient =
            /404|pas encore|injoignable|timeout|ECONNRESET|fetch failed|HTTP 5\d\d/i.test(msg);
          if (!transient || attempt === 2) throw e;
          await sleep(1500, signal);
        }
      }
      if (tick?.done && tick.track) {
        onProgress?.({
          percent: 100,
          phase: "done",
          model: startedModel,
          message: isPreview || tick.track.isPreview ? "Extrait prêt" : "Audio prêt",
        });
        return tick.track;
      }
      onProgress?.(
        formatTrackProgress({
          ...tick,
          musicKind: started.musicKind,
          model: tick?.model || startedModel,
          gpu: tick?.gpu || startedGpu,
          phase: "generating",
        }),
      );
    }

    throw new Error(
      started.musicKind === "acestep"
        ? isPreview
          ? "Timeout extrait ACE-Step — réessaie ou lance le complet."
          : "Timeout ACE-Step Studio (~20 min) — SFT = plus long."
        : started.musicKind === "songgen"
          ? isPreview
            ? "Timeout extrait SongGen — réessaie ou lance le complet."
            : "Timeout SongGeneration Studio (~20 min) — modèle Large = plus long sur 3090."
          : "Timeout MiniMax Replicate (~7 min).",
    );
  } catch (e) {
    if (e?.name === "AbortError" && started?.generationId) {
      void request("/api/track", {
        action: "cancel",
        generationId: started.generationId,
        musicKind: started.musicKind,
      }).catch(() => {});
      throw e;
    }
    if (
      started?.musicKind === "acestep" &&
      !payload?.skipStyleReference &&
      /ACE_REF_UNUSABLE|invalid, unreadable, or silent|rejeté l’audio de référence/i.test(
        String(e?.message || ""),
      )
    ) {
      onProgress?.({
        percent: 8,
        phase: "retry",
        message: "Référence audio refusée — relance sans cover…",
      });
      return trackWithPoll(
        { ...payload, skipStyleReference: true },
        onProgress,
        { ...opts, generationId: undefined, musicKind: undefined, draft: undefined },
      );
    }
    if (
      started?.musicKind === "acestep" &&
      !payload?.aceLightRetry &&
      /ACE_NAN_LATENTS|VRAM insuffisante|NaN or Inf latents|out of memory/i.test(
        String(e?.message || ""),
      )
    ) {
      onProgress?.({
        percent: 8,
        phase: "retry",
        model: "marcorez8/acestep-v15-xl-turbo-bf16",
        modelLabel: "XL Turbo BF16",
        message: "GPU saturé / NaN — relance en Turbo BF16 (léger)…",
      });
      return trackWithPoll(
        {
          ...payload,
          skipStyleReference: true,
          aceLightRetry: true,
          forceAceModelId: "marcorez8/acestep-v15-xl-turbo-bf16",
        },
        onProgress,
        { ...opts, generationId: undefined, musicKind: undefined, draft: undefined },
      );
    }
    throw e;
  }
}

export const api = {
  trends: (seed = {}) => request("/api/trends", seed),
  artist: (payload) => request("/api/artist", payload),
  saveArtistProfile: (slug, profile) =>
    slug
      ? request(`/api/artists/${encodeURIComponent(slug)}`, {
          action: "save-profile",
          profile,
        })
      : request("/api/artists", { action: "save-profile", profile }),
  /** Supprime l’artiste, ses projets / albums Turso et les objets S3 liés. */
  deleteArtist: async (slug) => {
    const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Suppression artiste impossible");
    return data;
  },
  /** Analyse / fige le timbre (extrait vocal ou audio fourni). */
  ensureArtistTimbre: (slug, opts = {}) =>
    request(`/api/artists/${encodeURIComponent(slug)}`, {
      action: "ensure-timbre",
      force: Boolean(opts.force),
      audioUrl: opts.audioUrl || null,
      profile: opts.profile || null,
    }),
  /** Backfill timbre de tous les artistes hub (Gemini écoute voice sample ou dernier morceau). */
  backfillArtistTimbres: (opts = {}) =>
    request("/api/artists", {
      action: "backfill-timbres",
      limit: opts.limit || 80,
    }),
  analyzeVoiceSample: (voiceSample, opts = {}) =>
    request("/api/artists", {
      action: "analyze-voice-sample",
      voiceSample,
      name: opts.name,
      slug: opts.slug,
      gender: opts.gender,
    }),
  lyrics: (payload) => request("/api/lyrics", payload),
  track: (payload, onProgress, opts) => trackWithPoll(payload, onProgress, opts),
  /** Planifie les thèmes des pistes restantes d’un album (hors lead). */
  albumPlan: (payload) => request("/api/album", { action: "plan", ...payload }),
  /** Ping ACE-Step Studio (URL des clés) — ne lance pas de génération. */
  probeAceStep: () => request("/api/track", { action: "probe-acestep" }),
  /** Lab : génération ACE brute (style + paroles), sans wizard. */
  labAceStep: (payload, opts) =>
    request("/api/track", { action: "lab-acestep", ...payload }, opts),
  /** Poll un job track / ACE / SongGen. */
  pollTrack: (generationId, opts = {}) =>
    request(
      "/api/track",
      {
        action: "poll",
        generationId,
        musicKind: opts.musicKind || "acestep",
      },
      { signal: opts.signal },
    ),
  cancelTrack: (generationId, opts = {}) =>
    request("/api/track", {
      action: "cancel",
      generationId,
      musicKind: opts.musicKind || "acestep",
    }),
  /** Vérifie le token Replicate (MiniMax / Flux / Seedance). */
  probeReplicate: () => request("/api/track", { action: "probe-replicate" }),
  /** Hot-swap du DiT ACE-Step (peut télécharger le checkpoint). */
  switchAceStepModel: (modelId) =>
    request("/api/track", { action: "switch-acestep-model", modelId }),
  /** Ping SongGeneration Studio (URL des clés) — ne lance pas de génération. */
  probeSongGen: () => request("/api/track", { action: "probe-songgen" }),
  /** Déclenche le download d’un modèle Studio (défaut : Large ~20 Go). */
  downloadSongGenModel: (modelId = "songgeneration_large") =>
    request("/api/track", { action: "download-songgen-model", modelId }),
  /** Annule un download Studio en cours. */
  cancelSongGenDownload: (modelId) =>
    request("/api/track", { action: "cancel-songgen-download", modelId }),
  /** Supprime un modèle Studio du disque. */
  deleteSongGenModel: (modelId) =>
    request("/api/track", { action: "delete-songgen-model", modelId }),
  /** Charge un modèle en VRAM (décharge l’actuel). */
  loadSongGenModel: (modelId) =>
    request("/api/track", { action: "load-songgen-model", modelId }),
  /** Décharge le modèle en VRAM. */
  unloadSongGenModel: () => request("/api/track", { action: "unload-songgen-model" }),
  cover: (payload) => request("/api/cover", payload),
  spotify: (payload) => request("/api/spotify", payload),
  distrokid: (payload) => request("/api/distrokid", payload),
  social: (payload) => request("/api/social", payload),
  veoShortStart: (payload) => request("/api/social/veo", { action: "start", ...payload }),
  veoShortPoll: (operationName) =>
    request("/api/social/veo", { action: "poll", operationName }),
  veoShortExtend: (payload) => request("/api/social/veo", { action: "extend", ...payload }),
  seedanceListen: (payload) => request("/api/social/seedance", { action: "listen", ...payload }),
  seedanceStart: (payload) => request("/api/social/seedance", { action: "start", ...payload }),
  seedancePoll: (predictionId) =>
    request("/api/social/seedance", { action: "poll", predictionId }),
  wan2gpListen: (payload) => request("/api/social/wan2gp", { action: "listen", ...payload }),
  wan2gpStart: (payload) => request("/api/social/wan2gp", { action: "start", ...payload }),
  wan2gpPoll: (predictionId) =>
    request("/api/social/wan2gp", { action: "poll", predictionId }),
  /** @deprecated préférer veoShortStart + veoShortPoll (évite timeout proxy) */
  veoShort: (payload) => request("/api/social/veo", { action: "start", ...payload }),
  publishShort: async (payload = {}) => {
    // Gros shorts : FormData (évite JSON + atob géants)
    if (payload.videoBlob instanceof Blob) {
      const keys = loadKeys();
      const form = new FormData();
      form.append(
        "video",
        payload.videoBlob,
        `short.${payload.videoBlob.type?.includes("mp4") ? "mp4" : "webm"}`,
      );
      form.append("keys", JSON.stringify(keys));
      form.append("social", JSON.stringify(payload.social || {}));
      form.append("artist", JSON.stringify(payload.artist || {}));
      form.append("track", JSON.stringify(payload.track || {}));
      form.append("targets", JSON.stringify(payload.targets || { tiktok: true, youtube: true, webhook: true }));
      if (payload.mimeType) form.append("mimeType", payload.mimeType);
      if (payload.videoUrl) form.append("videoUrl", payload.videoUrl);
      if (payload.s3Key) form.append("s3Key", payload.s3Key);
      const res = await fetch("/api/social/publish", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur API ${res.status}`);
      return data;
    }
    return request("/api/social/publish", payload);
  },
  uploadClip: async ({ videoBlob, projectId, mimeType } = {}) => {
    if (!(videoBlob instanceof Blob)) throw new Error("videoBlob requis");
    const form = new FormData();
    form.append(
      "video",
      videoBlob,
      `short.${videoBlob.type?.includes("mp4") ? "mp4" : "webm"}`,
    );
    if (projectId) form.append("projectId", String(projectId));
    if (mimeType) form.append("mimeType", mimeType);
    const res = await fetch("/api/clips/upload", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload clip HTTP ${res.status}`);
    return data;
  },
  testS3: async () => {
    const res = await fetch("/api/clips/upload");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Test S3 impossible");
    return data;
  },
  /** Pipeline A→Z en stream NDJSON. `onProgress({ step, message, index, total })` à chaque étape. */
  pipeline: async (seed = {}, onProgress) => {
    const keys = loadKeys();
    const res = await fetch("/api/pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify({ keys, ...seed }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Erreur API ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    // Fallback si un proxy renvoie du JSON classique
    if (contentType.includes("application/json") && !contentType.includes("ndjson")) {
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data;
    }

    if (!res.body) {
      const data = await res.json().catch(() => ({}));
      if (data.error) throw new Error(data.error);
      return data;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let evt;
        try {
          evt = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (evt.type === "progress") {
          await onProgress?.(evt);
        } else if (evt.type === "snapshot") {
          await onProgress?.(evt);
        } else if (evt.type === "meta") {
          await onProgress?.({ step: "start", message: "Démarrage…", index: -1, total: evt.total, meta: evt });
        } else if (evt.type === "result") {
          const { type: _t, ...data } = evt;
          result = data;
        } else if (evt.type === "error") {
          throw new Error(evt.error || "Erreur pipeline");
        }
      }
    }

    if (buffer.trim()) {
      try {
        const evt = JSON.parse(buffer.trim());
        if (evt.type === "result") {
          const { type: _t, ...data } = evt;
          result = data;
        } else if (evt.type === "error") {
          throw new Error(evt.error || "Erreur pipeline");
        }
      } catch (e) {
        if (e.message && !e.message.includes("JSON")) throw e;
      }
    }

    if (!result) throw new Error("Pipeline interrompu — pas de résultat");
    return result;
  },
  testKeys: () => request("/api/test-keys"),
  getKeys: async () => {
    const res = await fetch("/api/keys");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Lecture clés Turso impossible");
    return data;
  },
  saveKeysRemote: (keys) => request("/api/keys", { keys }),
  searchStyleArtists: (query) => request("/api/style-artists", { query }),
  searchStyleTracks: (query) => request("/api/style-tracks", { query }),
  artistTopTracks: (artistPick) =>
    request("/api/style-tracks", { action: "top-for-artist", artistPick }),
  resolveStyleTrack: (pick) =>
    request("/api/style-tracks", { action: "resolve", pick }),
  checkArtistName: (query) => request("/api/artist-name-check", { query }),
  tiktokAuthUrl: (payload = {}) =>
    request("/api/tiktok/auth", {
      redirectUri:
        typeof window !== "undefined"
          ? `${window.location.origin}/tiktok/callback`.replace(
              /^http:\/\/(?!localhost|127\.0\.0\.1)/i,
              "https://",
            )
          : undefined,
      ...payload,
    }),
  tiktokToken: (payload) => request("/api/tiktok/token", payload),
  youtubeAuthUrl: (payload = {}) =>
    request("/api/youtube/auth", {
      redirectUri:
        typeof window !== "undefined"
          ? `${window.location.origin}/youtube/callback`.replace(
              /^http:\/\/(?!localhost|127\.0\.0\.1)/i,
              "https://",
            )
          : undefined,
      ...payload,
    }),
  youtubeToken: (payload) => request("/api/youtube/token", payload),

  listProjects: async () => {
    const res = await fetch("/api/projects");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erreur historique");
    return data;
  },
  getProject: async (id) => {
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Projet introuvable");
    return data;
  },
  saveProject: (payload) => request("/api/projects", payload),
  deleteProject: async (id) => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Suppression impossible");
    return data;
  },
  testDb: async () => {
    const res = await fetch("/api/db-test");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Turso KO");
    return data;
  },
};
