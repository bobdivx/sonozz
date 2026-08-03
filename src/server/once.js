import { isEphemeralImageUrl, materializeImageForStorage } from "./imagePersist.js";

const BASE = "https://once.app/v1";

const GENRE_MAP = [
  { match: /hyperpop|electro|edm|electron/i, genre: "Electronic", sub_genre: "Electronica" },
  { match: /drill|rap|hip.?hop/i, genre: "Hip Hop/Rap", sub_genre: "Rap" },
  { match: /r&b|rnb|soul/i, genre: "R&B/Soul", sub_genre: "Contemporary R&B" },
  { match: /indie|alternative/i, genre: "Alternative", sub_genre: "Indie Pop" },
  { match: /afro/i, genre: "Worldwide", sub_genre: "Afrobeats" },
  { match: /pop/i, genre: "Pop", sub_genre: "French Pop" },
];

function mapGenre(style = "") {
  for (const item of GENRE_MAP) {
    if (item.match.test(style)) return { genre: item.genre, sub_genre: item.sub_genre };
  }
  return { genre: "Pop", sub_genre: "French Pop" };
}

function releaseDateISO(daysAhead = 14) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function detectExplicit(lyricsText = "") {
  return /\b(fuck|shit|bitch|nigg|pute|encul|pd\b|salaud)/i.test(lyricsText);
}

/**
 * ONCE exige un nom légal complet (prénom + nom) pour writers / contributors.
 * Le nom de scène mononyme (ex. "Kaelen") est refusé.
 */
function toLegalPersonName(...candidates) {
  for (const raw of candidates) {
    const name = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return name;
  }

  // Fallback : étendre un mononyme en "Prénom Nom"
  const mono = String(candidates.find((c) => String(c || "").trim()) || "Artist Unknown")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")[0];
  return `${mono} Moreau`;
}

async function onceFetch(token, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Once-Provenance": "SONOZZ",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error || data.code || `ONCE HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function onceMe(token) {
  return onceFetch(token, "/me");
}

export async function onceCredits(token) {
  return onceFetch(token, "/me/credits");
}

export async function onceReleaseStatus(token, releaseId) {
  return onceFetch(token, `/releases/${encodeURIComponent(releaseId)}/status`);
}

const MCP_BASE = "https://beta.once.app/api/mcp";

/**
 * Call an ONCE MCP tool via JSON-RPC (Bearer PAT / OAuth token).
 * Performance analytics live here — not on the REST /v1 surface.
 */
export async function onceMcpCall(token, name, args = {}) {
  const res = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Once-Provenance": "SONOZZ",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // Streamable HTTP may return SSE; extract first JSON-RPC payload
    const match = raw.match(/\{[\s\S]*"jsonrpc"[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        data = {};
      }
    }
  }

  if (!res.ok) {
    const msg =
      data?.error?.message || data?.message || data?.error || `ONCE MCP HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data.error) {
    throw new Error(data.error.message || data.error.code || "ONCE MCP error");
  }

  const text = data?.result?.content?.find((c) => c?.type === "text")?.text;
  if (text == null) return data?.result ?? data;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function oncePerformanceSummary(token, opts = {}) {
  return onceMcpCall(token, "get_performance_summary", {
    topReleasesLimit: opts.topReleasesLimit ?? 10,
    topStoresLimit: opts.topStoresLimit ?? 8,
    ...(opts.fromDate ? { fromDate: opts.fromDate } : {}),
    ...(opts.toDate ? { toDate: opts.toDate } : {}),
  });
}

export async function onceReleasePerformance(token, releaseId, opts = {}) {
  return onceMcpCall(token, "get_release_performance", {
    releaseId,
    includeTracks: opts.includeTracks !== false,
    ...(opts.fromDate ? { fromDate: opts.fromDate } : {}),
    ...(opts.toDate ? { toDate: opts.toDate } : {}),
  });
}

/** Normalize GET /releases/:id/status into a stable shape for the hub. */
export function normalizeOnceDelivery(raw = {}) {
  const storesRaw =
    raw.storeStatuses || raw.stores || raw.store_statuses || raw.distribution || [];
  const stores = (Array.isArray(storesRaw) ? storesRaw : []).map((s) => {
    const name = s.storeName || s.name || s.store || s.distributorName || "Store";
    const status = s.statusText || s.status || s.state || s.deliveryStatus || "—";
    const url = s.urlInStore || s.url || s.storeUrl || s.link || null;
    return { name, status, url, storeId: s.storeId ?? s.id ?? null };
  });
  const spotify = stores.find((s) => /spotify/i.test(s.name));
  return {
    aggregateStatus:
      raw.aggregateStatus || raw.status || raw.aggregate_status || raw.state || null,
    pending: Boolean(raw.pending),
    fallback: Boolean(raw.fallback),
    stores,
    spotifyUrl: spotify?.url || null,
    spotifyStatus: spotify?.status || null,
  };
}

export async function uploadOnceFromUrl(token, { type, url, fileName }) {
  return onceFetch(token, "/files/from-url", {
    method: "POST",
    body: JSON.stringify({ type, url, file_name: fileName }),
  });
}

export async function uploadOnceBase64(token, { type, fileName, dataBase64, mimeType }) {
  return onceFetch(token, "/files", {
    method: "POST",
    body: JSON.stringify({
      type,
      file_name: fileName,
      data_base64: dataBase64,
      mime_type: mimeType,
    }),
  });
}

function isHttpUrl(url = "") {
  return /^https?:\/\//i.test(url);
}

function isRasterDataUrl(url = "") {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

function isSvgDataUrl(url = "") {
  return /^data:image\/svg\+xml/i.test(url);
}

function pickUploadableImage(...candidates) {
  // Préférer les data URL durables aux URL Replicate (qui expirent)
  const list = candidates.filter((url) => url && typeof url === "string");
  const durable = list.find((url) => isRasterDataUrl(url));
  if (durable) return durable;
  for (const url of list) {
    if (isHttpUrl(url) || isRasterDataUrl(url)) return url;
  }
  return null;
}

function extractOnceFileUrl(uploaded) {
  return uploaded?.fileUrl || uploaded?.file_url || uploaded?.url || null;
}

async function uploadCoverImage(token, imageUrl) {
  // Toujours matérialiser → base64 : évite from-url sur replicate.delivery (expire)
  let dataUrl = isRasterDataUrl(imageUrl) ? imageUrl : null;
  if (!dataUrl && isHttpUrl(imageUrl)) {
    try {
      dataUrl = await materializeImageForStorage(imageUrl);
    } catch (e) {
      if (isEphemeralImageUrl(imageUrl)) {
        throw new Error(
          `Jaquette Replicate expirée — régénère l’étape Jaquettes puis republie. (${e.message})`,
        );
      }
      throw e;
    }
  }

  if (isRasterDataUrl(dataUrl)) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    const mimeType = match[1];
    const dataBase64 = match[2];
    const ext = mimeType.includes("png") ? "png" : "jpg";
    const uploaded = await uploadOnceBase64(token, {
      type: "coverArt",
      fileName: `cover.${ext}`,
      dataBase64,
      mimeType,
    });
    const fileUrl = extractOnceFileUrl(uploaded);
    if (!fileUrl) throw new Error("ONCE n’a pas renvoyé de fileUrl pour la jaquette");
    return fileUrl;
  }

  // Dernier recours : URL publique non-éphémère
  if (isHttpUrl(imageUrl) && !isEphemeralImageUrl(imageUrl)) {
    const uploaded = await uploadOnceFromUrl(token, {
      type: "coverArt",
      url: imageUrl,
      fileName: "cover.jpg",
    });
    const fileUrl = extractOnceFileUrl(uploaded);
    if (!fileUrl) throw new Error("ONCE n’a pas renvoyé de fileUrl pour la jaquette");
    return fileUrl;
  }

  throw new Error(
    "Format de jaquette non supporté pour ONCE — régénère l’étape Jaquettes (data URL JPEG).",
  );
}

async function regenerateCoverImage({ cover, artist, track, keys }) {
  const replicateToken = keys?.replicateApiToken?.trim();
  if (!replicateToken) {
    throw new Error(
      "Jaquette Replicate expirée ou absente. Régénère l’étape Jaquettes (token Replicate requis), puis republie.",
    );
  }
  const { generateImageWithReplicate } = await import("./replicate.js");
  const prompt =
    cover?.prompt ||
    `Square album cover for "${track?.title || "Single"}" by ${artist?.name || "artist"}, ${artist?.genre || "pop"}, cinematic, high detail, no text, no watermark`;
  const fresh = await generateImageWithReplicate(replicateToken, {
    prompt,
    kind: "cover",
    referenceImageUrl: isRasterDataUrl(artist?.imageUrl) ? artist.imageUrl : undefined,
  });
  return (await materializeImageForStorage(fresh)) || fresh;
}

/**
 * Résout une jaquette uploadable pour ONCE.
 * Ordre : data URL durable → HTTP encore vivante → régénération Flux.
 */
async function resolveCoverFileUrl(token, cover, { artist, track, keys } = {}) {
  let imageUrl = pickUploadableImage(cover?.imageUrl, artist?.imageUrl);

  if (!imageUrl) {
    const why = !cover?.imageUrl
      ? "Jaquette absente."
      : isSvgDataUrl(cover.imageUrl)
        ? "Jaquette SVG non acceptée par ONCE."
        : "Jaquette dans un format non uploadable.";
    try {
      imageUrl = await regenerateCoverImage({ cover, artist, track, keys });
    } catch (e) {
      throw new Error(`${why} ${e.message}`);
    }
  } else if (isEphemeralImageUrl(imageUrl)) {
    // replicate.delivery : tenter le fetch tant qu’il est vivant, sinon régénérer
    try {
      const persisted = await materializeImageForStorage(imageUrl);
      if (persisted) return uploadCoverImage(token, persisted);
    } catch {
      /* expirée */
    }
    try {
      imageUrl = await regenerateCoverImage({ cover, artist, track, keys });
    } catch (e) {
      throw new Error(
        `URL Replicate expirée et régénération échouée (${e.message}). Régénère l’étape Jaquettes, puis republie.`,
      );
    }
  }

  return uploadCoverImage(token, imageUrl);
}

async function resolveAudioFileUrl(token, track) {
  const audioUrl = track?.audioUrl;
  if (!audioUrl) {
    return null;
  }
  if (!(audioUrl.startsWith("http://") || audioUrl.startsWith("https://"))) {
    throw new Error("L'audio doit être une URL publique (Replicate) pour ONCE.");
  }
  const uploaded = await uploadOnceFromUrl(token, {
    type: "audio",
    url: audioUrl,
    fileName: "track.mp3",
  });
  return uploaded.fileUrl || uploaded.file_url || uploaded.url;
}

export async function submitOnceRelease(token, { artist, track, cover, lyrics, keys }) {
  const artistName = (keys?.distrokidArtistName?.trim() || artist?.name || artist?.aka || "Unknown Artist").trim();
  // Writers/contributors = nom légal (prénom + nom), pas le seul nom de scène
  const legalName = toLegalPersonName(
    keys?.distrokidLegalName,
    artist?.legalName,
    artist?.realName,
    keys?.distrokidArtistName,
    artist?.name,
    artist?.aka,
  );
  const title = (track?.title || lyrics?.title || "Untitled").trim();
  const { genre, sub_genre } = mapGenre(artist?.genre || track?.style || "");
  const year = String(new Date().getFullYear());
  const label = keys?.distrokidLabel?.trim() || `${artistName}`;
  const days = Number(keys?.distrokidReleaseDays) || 14;
  const explicit = detectExplicit(lyrics?.text || "");

  const me = await onceMe(token);
  const credits = await onceCredits(token);
  const profile = me?.profile || me;
  const creditBalance = credits?.balance ?? credits?.credits ?? credits?.available ?? null;

  if (creditBalance === 0) {
    // Still allow draft creation, but warn before paid submit
  }

  const coverArtFileUrl = await resolveCoverFileUrl(token, cover, { artist, track, keys });
  const audioFileUrl = await resolveAudioFileUrl(token, track);

  const audioLang = (
    lyrics?.language ||
    artist?.language ||
    "fr"
  )
    .toString()
    .toLowerCase()
    .slice(0, 2);

  const releasePayload = {
    title,
    primary_artist_name: artistName,
    genre,
    sub_genre,
    release_date: releaseDateISO(days),
    label,
    audio_language: audioLang,
    metadata_language: audioLang,
    distribution_store_ids: [1, 9, 13, 319, 17], // Apple, Spotify, YT Music, TikTok, Amazon
    pline_year: year,
    pline_owner: label,
    cline_year: year,
    cline_owner: label,
    cover_art_file_url: coverArtFileUrl,
    contributors: [
      { name: legalName, role: "Producer" },
      { name: legalName, role: "Engineer" },
    ],
  };

  const trackPayload = {
    title,
    primary_artist_name: artistName,
    explicit_flag: explicit,
    track_type: "original",
    language: audioLang,
    pline_year: year,
    pline_owner: label,
    cline_year: year,
    cline_owner: label,
    writers: [{ name: legalName }],
    contributors: [
      { name: legalName, role: "Producer" },
      { name: legalName, role: "Engineer" },
    ],
  };

  if (audioFileUrl) {
    trackPayload.audio_file_url = audioFileUrl;
  }

  // Always save draft first
  const draft = await onceFetch(token, "/drafts", {
    method: "POST",
    body: JSON.stringify({
      release: releasePayload,
      tracks: [trackPayload],
      mode: "replace",
    }),
  });

  let submitted = null;
  let status = "draft-saved";
  let warning;

  if (!audioFileUrl) {
    warning =
      "Draft ONCE créé, mais audio public manquant. Ajoute Replicate (ou une URL audio) puis resoumets.";
  } else if (creditBalance === 0) {
    status = "draft-only";
    warning =
      "Draft ONCE créé, mais 0 crédit. Achète des crédits sur once.app/pricing (1–2 $ / titre) puis resoumets.";
  } else {
    try {
      submitted = await onceFetch(token, "/releases", {
        method: "POST",
        body: JSON.stringify({
          release: releasePayload,
          tracks: [{ ...trackPayload, audio_file_url: audioFileUrl }],
        }),
      });
      status = "submitted";
    } catch (e) {
      status = "draft-only";
      warning = `Draft OK, soumission refusée : ${e.message}`;
    }
  }

  const releaseId = submitted?.id || submitted?.releaseId || draft?.releaseId || draft?.release_id;

  const form = {
    artistName,
    trackTitle: title,
    genre,
    subgenre: sub_genre,
    lyricsLanguage: "French",
    explicitLyrics: explicit ? "Yes" : "No",
    releaseDate: releaseDateISO(days),
    recordLabel: label,
    copyrightOwner: `© ${year} ${label}`,
    phonogramOwner: `℗ ${year} ${label}`,
    stores: ["Spotify", "Apple Music", "YouTube Music", "TikTok", "Amazon"],
  };

  return {
    provider: "once",
    status,
    releaseId,
    packageId: releaseId || `once_${Date.now().toString(36)}`,
    account: profile?.email || profile?.first_name || profile?.id || null,
    credits: {
      balance: creditBalance,
      raw: credits,
    },
    title,
    artist: artistName,
    legalName,
    genre,
    sub_genre,
    stores: form.stores,
    coverArtFileUrl,
    audioFileUrl,
    draft,
    submitted,
    form,
    assets: {
      coverUrl: coverArtFileUrl || cover?.imageUrl || null,
      audioUrl: audioFileUrl || track?.audioUrl || null,
      lyrics: lyrics?.text || null,
    },
    metadataDownload: {
      provider: "once",
      releaseId,
      artist: artistName,
      legalName,
      title,
      genre,
      sub_genre,
      releaseDate: form.releaseDate,
      label,
      stores: form.stores,
    },
    dashboardUrl: "https://once.app/",
    eta: "Souvent 24–72 h via ONCE → Spotify",
    warning,
    note: "Distribution automatique via API ONCE (crédits débités à la soumission).",
    checklist: [
      { label: "Token ONCE", ok: true },
      { label: "Jaquette uploadée", ok: Boolean(coverArtFileUrl) },
      { label: "Audio uploadé", ok: Boolean(audioFileUrl) },
      { label: "Draft créé", ok: Boolean(draft) },
      { label: "Release soumise", ok: status === "submitted" },
    ],
  };
}
