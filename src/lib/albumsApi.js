export const albumsApi = {
  async createAlbum({ artistSlug, leadProjectId, title, concept, targetCount = 8 }) {
    const res = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artistSlug,
        leadProjectId,
        title,
        concept,
        targetCount,
      }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur création album");
    }
    return res.json();
  },

  async getAlbum(albumId) {
    const res = await fetch(`/api/albums/${albumId}`);
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur récupération album");
    }
    return res.json();
  },

  async updateAlbum(albumId, updates) {
    const res = await fetch(`/api/albums/${albumId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur mise à jour album");
    }
    return res.json();
  },

  async deleteAlbum(albumId) {
    const res = await fetch(`/api/albums/${albumId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur suppression album");
    }
    return res.json();
  },

  async listAlbums(artistSlug) {
    const res = await fetch(`/api/albums?artistSlug=${encodeURIComponent(artistSlug)}`);
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur récupération albums");
    }
    return res.json();
  },

  async addTrack(albumId, trackData) {
    const res = await fetch("/api/albums/tracks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId, ...trackData }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur ajout track");
    }
    return res.json();
  },

  async updateTrack(trackId, updates) {
    const res = await fetch("/api/albums/tracks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId, ...updates }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur mise à jour track");
    }
    return res.json();
  },

  async deleteTrack(trackId) {
    const res = await fetch("/api/albums/tracks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur suppression track");
    }
    return res.json();
  },

  async migrateAlbums() {
    const res = await fetch("/api/albums", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "migrate" }),
    });
    if (!res.ok) {
      const error = await res.text();
      throw new Error(error || "Erreur migration albums");
    }
    return res.json();
  },
};
