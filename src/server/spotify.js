async function clientCredentialsToken(clientId, clientSecret) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Spotify auth échouée");
  return data.access_token;
}

async function refreshUserToken(clientId, clientSecret, refreshToken) {
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Refresh Spotify échoué");
  return data.access_token;
}

export async function getSpotifyAccess(keys) {
  const id = keys?.spotifyClientId?.trim();
  const secret = keys?.spotifyClientSecret?.trim();
  if (!id || !secret) return null;

  if (keys.spotifyRefreshToken?.trim()) {
    try {
      const token = await refreshUserToken(id, secret, keys.spotifyRefreshToken.trim());
      return { token, mode: "user" };
    } catch {
      // fallback client credentials
    }
  }

  const token = await clientCredentialsToken(id, secret);
  return { token, mode: "client" };
}

export async function spotifySearchContext(token, query) {
  const q = encodeURIComponent(query);
  const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track,artist&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Cherche un titre déjà en ligne (track + artiste exact si possible).
 * Utile quand ONCE n’a pas encore renvoyé urlInStore alors que Spotify l’a ingéré.
 */
export async function findSpotifyCatalogMatch(keys, { artistName = "", trackTitle = "" } = {}) {
  const title = String(trackTitle || "").trim();
  const artist = String(artistName || "").trim();
  if (!title) return null;
  const access = await getSpotifyAccess(keys);
  if (!access?.token) return null;

  const query = artist ? `track:"${title}" artist:"${artist}"` : `track:"${title}"`;
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=8`,
    { headers: { Authorization: `Bearer ${access.token}` } },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const items = Array.isArray(data?.tracks?.items) ? data.tracks.items : [];
  if (!items.length) return null;

  const titleLc = title.toLowerCase();
  const artistLc = artist.toLowerCase();
  const match = items.find((t) => {
    const nameOk = String(t.name || "").toLowerCase() === titleLc;
    const artistOk =
      !artistLc ||
      (Array.isArray(t.artists) &&
        t.artists.some((a) => String(a.name || "").toLowerCase() === artistLc));
    return nameOk && artistOk;
  });

  const url = match?.external_urls?.spotify || match?.album?.external_urls?.spotify || null;
  if (!url) return null;
  return {
    url,
    name: match.name || title,
    artists: (match.artists || []).map((a) => a.name).filter(Boolean),
    albumUrl: match.album?.external_urls?.spotify || null,
  };
}

export async function createReleasePlaylist(token, { artist, track }) {
  const me = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!me.ok) throw new Error("Token Spotify utilisateur invalide pour créer une playlist");
  const profile = await me.json();

  const playlistRes = await fetch(`https://api.spotify.com/v1/users/${profile.id}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `${artist?.name || "SONOZZ"} — ${track?.title || "Release"}`,
      description: `Release préparée par SONOZZ · ${artist?.genre || ""}`,
      public: false,
    }),
  });
  const playlist = await playlistRes.json();
  if (!playlistRes.ok) throw new Error(playlist.error?.message || "Création playlist échouée");
  return playlist;
}

export async function prepareSpotifyRelease(keys, { artist, track, cover }) {
  const access = await getSpotifyAccess(keys);
  const releaseId = `sonozz_${Date.now().toString(36)}`;

  let playlist = null;
  let catalogHint = null;
  let mode = "metadata-only";

  if (access) {
    mode = access.mode;
    try {
      catalogHint = await spotifySearchContext(
        access.token,
        `${artist?.genre || "pop"} ${artist?.mood || ""}`,
      );
    } catch {
      /* ignore */
    }

    if (access.mode === "user") {
      try {
        playlist = await createReleasePlaylist(access.token, { artist, track });
      } catch {
        /* metadata still ok */
      }
    }
  }

  const checklist = [
    { label: "Métadonnées titre / artiste", ok: Boolean(track?.title && artist?.name) },
    { label: "Artwork prêt", ok: Boolean(cover?.imageUrl) },
    { label: "Audio / brief prêt", ok: Boolean(track) },
    { label: "Credentials Spotify", ok: Boolean(access) },
    { label: "Playlist compte (refresh token)", ok: Boolean(playlist) },
    { label: "Token ONCE configuré", ok: Boolean(keys?.onceApiToken?.trim()) },
  ];

  return {
    releaseId,
    status: playlist ? "playlist-created" : access ? "ready-for-distributor" : "package-ready",
    platform: "Spotify",
    mode,
    title: track?.title,
    artist: artist?.name,
    coverReady: Boolean(cover?.imageUrl),
    playlistUrl: playlist?.external_urls?.spotify || null,
    catalogHint: catalogHint?.artists?.items?.slice(0, 3).map((a) => a.name) || [],
    eta: "Via ONCE → Spotify (souvent 24–72 h)",
    checklist,
    note: "Utilise l’étape ONCE pour publier la release vers Spotify.",
  };
}
