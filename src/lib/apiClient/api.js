import { loadKeys } from "../keys.js";
import { request } from "./core.js";
import { trackWithPoll } from "./trackPoll.js";

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
  /** QA Gemini : écoute le take et diagnostique bouillie / mash / etc. */
  analyzeTrackAudio: (payload) =>
    request("/api/track", { action: "analyze-audio", ...payload }),
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
