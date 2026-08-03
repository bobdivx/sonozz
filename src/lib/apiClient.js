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
  veoShort: (payload) => request("/api/social/veo", payload),
  publishShort: (payload) => request("/api/social/publish", payload),
  pipeline: (seed = {}) => request("/api/pipeline", seed),
  testKeys: () => request("/api/test-keys"),

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
