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

export const api = {
  trends: (seed = {}) => request("/api/trends", seed),
  artist: (payload) => request("/api/artist", payload),
  lyrics: (payload) => request("/api/lyrics", payload),
  track: (payload) => request("/api/track", payload),
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
      form.append("targets", JSON.stringify(payload.targets || { tiktok: true, webhook: true }));
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
  tiktokAuthUrl: () => request("/api/tiktok/auth"),
  tiktokToken: (payload) => request("/api/tiktok/token", payload),

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
