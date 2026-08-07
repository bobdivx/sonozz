import { loadKeys } from "./keys.js";

async function request(path, body = {}) {
  const keys = loadKeys();
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys, ...body }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur API ${res.status}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
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

  let message = msg || (status === "pending" ? "En file…" : "Génération…");
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
    elapsedSeconds: elapsed,
    estimatedSeconds: estimated,
    musicKind: tick.musicKind || null,
  };
}

/**
 * Start + poll court (évite Cloudflare 524 — gen audio 2–10 min).
 * @param {object} payload
 * @param {(p: { percent: number, message: string }) => void} [onProgress]
 * @param {{ signal?: AbortSignal }} [opts]
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
  onProgress?.({ percent: 5, message: "Démarrage génération audio…" });
  const started = await request("/api/track", { ...payload, action: "start" });
  if (!started?.pollNeeded) {
    const { pollNeeded: _p, musicKind: _m, generationId: _g, draft, ...rest } = started || {};
    if (draft && typeof draft === "object") return { ...draft, ...rest };
    return rest;
  }

  onProgress?.({
    percent: 12,
    message:
      started.musicKind === "songgen"
        ? "SongGen démarré — attente GPU…"
        : "MiniMax démarré — attente Replicate…",
    musicKind: started.musicKind,
  });

  const maxPolls = started.musicKind === "songgen" ? 400 : 180;
  const intervalMs = started.musicKind === "songgen" ? 3000 : 2500;

  for (let i = 0; i < maxPolls; i++) {
    throwIfAborted();
    await sleep(intervalMs);
    throwIfAborted();
    const tick = await request("/api/track", {
      action: "poll",
      generationId: started.generationId,
      musicKind: started.musicKind,
      draft: started.draft,
    });
    if (tick?.done && tick.track) {
      onProgress?.({ percent: 100, message: "Audio prêt" });
      return tick.track;
    }
    onProgress?.(formatTrackProgress({ ...tick, musicKind: started.musicKind }));
  }

      throw new Error(
        started.musicKind === "songgen"
          ? "Timeout SongGeneration Studio (~20 min) — modèle Large = plus long sur 3090."
          : "Timeout MiniMax Replicate (~7 min).",
      );
}

export const api = {
  trends: (seed = {}) => request("/api/trends", seed),
  artist: (payload) => request("/api/artist", payload),
  lyrics: (payload) => request("/api/lyrics", payload),
  track: (payload, onProgress, opts) => trackWithPoll(payload, onProgress, opts),
  /** Planifie les thèmes des pistes restantes d’un album (hors lead). */
  albumPlan: (payload) => request("/api/album", { action: "plan", ...payload }),
  /** Ping SongGeneration Studio (URL des clés) — ne lance pas de génération. */
  probeSongGen: () => request("/api/track", { action: "probe-songgen" }),
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
          onProgress?.(evt);
        } else if (evt.type === "meta") {
          onProgress?.({ step: "start", message: "Démarrage…", index: -1, total: evt.total, meta: evt });
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
