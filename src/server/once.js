import { isEphemeralImageUrl, materializeImageForStorage } from "./imagePersist.js";

const BASE = "https://once.app/v1";

const GENRE_MAP = [
  { match: /metal|hard.?rock/i, genre: "Metal", sub_genre: "Hard Rock" },
  { match: /punk|garage/i, genre: "Alternative", sub_genre: "Punk" },
  { match: /jazz/i, genre: "Jazz", sub_genre: "Contemporary Jazz" },
  { match: /blues/i, genre: "Blues", sub_genre: "Contemporary Blues" },
  { match: /funk|disco/i, genre: "R&B/Soul", sub_genre: "Funk" },
  { match: /gospel/i, genre: "Gospel", sub_genre: "Contemporary Gospel" },
  { match: /k-?pop|j-?pop/i, genre: "Pop", sub_genre: "K-Pop" },
  { match: /lo-?fi|chill|synthwave|retrowave/i, genre: "Electronic", sub_genre: "Electronica" },
  { match: /house|techno|edm|festival/i, genre: "Electronic", sub_genre: "Dance" },
  { match: /hyperpop|electro|electron/i, genre: "Electronic", sub_genre: "Electronica" },
  { match: /trap|cloud.?rap|boom.?bap|hip.?hop|drill|rap/i, genre: "Hip Hop/Rap", sub_genre: "Rap" },
  { match: /neo.?soul|quiet.?storm|r&b|rnb|soul/i, genre: "R&B/Soul", sub_genre: "Contemporary R&B" },
  { match: /amapiano|afro.?house|afro/i, genre: "Worldwide", sub_genre: "Afrobeats" },
  { match: /dancehall|reggae/i, genre: "Reggae/Dancehall", sub_genre: "Dancehall" },
  { match: /latin|reggaeton/i, genre: "Latin", sub_genre: "Reggaeton" },
  { match: /country|americana/i, genre: "Country", sub_genre: "Contemporary Country" },
  { match: /folk|acoustique/i, genre: "Folk", sub_genre: "Contemporary Folk" },
  { match: /world|fusion/i, genre: "Worldwide", sub_genre: "Worldbeat" },
  { match: /indie|alternative/i, genre: "Alternative", sub_genre: "Indie Pop" },
  { match: /rock/i, genre: "Rock", sub_genre: "Indie Rock" },
  { match: /chanson|variété|pop/i, genre: "Pop", sub_genre: "French Pop" },
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

const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * ONCE exige un nom légal complet (writer registrations).
 * Règle : ≥ 2 parties séparées, chaque partie Latin ≥ 2 caractères
 * (une partie 100 % CJK peut être 1 caractère).
 * Renvoie null si aucun candidat valide — l'appelant doit alors demander
 * un nom légal à l'utilisateur au lieu d'en fabriquer un.
 */
export function pickLegalPersonName(...candidates) {
  for (const raw of candidates) {
    const name = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const parts = name.split(/\s+|·/).filter(Boolean);
    if (parts.length < 2) continue;
    const allValid = parts.every((p) => (CJK_SCRIPT.test(p) ? true : p.length >= 2));
    if (allValid) return name;
  }
  return null;
}

/**
 * Crédit Producer (global Paramètres), sinon writer légal, sinon nom d'artiste.
 */
export function resolveProducerName(keys, { writerLegalName = "", artistName = "" } = {}) {
  const fromKeys = String(keys?.distrokidProducerName || "").trim();
  if (fromKeys) return fromKeys;
  const writer = String(writerLegalName || "").trim();
  if (writer) return writer;
  return String(artistName || "").trim() || "Unknown Producer";
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

/** Métadonnées release (UPC, ISRC, tracks…). */
export async function onceReleaseMeta(token, releaseId) {
  return onceFetch(token, `/releases/${encodeURIComponent(releaseId)}`);
}

/**
 * Extrait UPC / ISRC depuis GET /releases/:id (champs variables selon version API).
 */
export function extractOnceIdentifiers(release = {}) {
  const upcRaw =
    release.upc ||
    release.upc_code ||
    release.barcode ||
    release.ean ||
    release.release?.upc ||
    null;
  const tracks = Array.isArray(release.tracks) ? release.tracks : [];
  const trackIsrcs = tracks.map((t, i) => {
    const isrc =
      t.isrc ||
      t.isrc_code ||
      t.recording_isrc ||
      t.identifiers?.isrc ||
      null;
    return {
      index: i + 1,
      title: t.title || `Piste ${i + 1}`,
      isrc: isrc ? String(isrc) : null,
    };
  });
  const isrc =
    trackIsrcs.find((t) => t.isrc)?.isrc ||
    release.isrc ||
    release.isrc_code ||
    null;

  const upc = upcRaw ? String(upcRaw) : null;
  const isPendingCode = (v) => !v || /pending|assign|n\/?a|null/i.test(String(v));

  return {
    upc,
    isrc,
    tracks: trackIsrcs,
    upcPending: isPendingCode(upc),
    isrcPending: isPendingCode(isrc),
  };
}

/**
 * Unison / Release Publishing : verrouillé tant qu’aucun store live + ISRC.
 */
export function publishingReadiness({ delivery = {}, identifiers = {} } = {}) {
  const statusBlob = `${delivery.spotifyStatus || ""} ${delivery.aggregateStatus || ""}`;
  const live =
    /live|distributed|delivered|success/i.test(statusBlob) || Boolean(delivery.spotifyUrl);
  const pendingDist = /pending|inspect|queued|process/i.test(statusBlob) && !live;
  const hasIsrc = Boolean(identifiers.isrc) && !identifiers.isrcPending;

  if (delivery.error) {
    return {
      status: "error",
      label: "Erreur statut",
      reason: delivery.error,
      canSubmitUnison: false,
    };
  }
  if (pendingDist || (!live && !hasIsrc)) {
    return {
      status: "locked",
      label: "Publishing verrouillé",
      reason: "Attendre livraison magasin + attribution ISRC",
      canSubmitUnison: false,
    };
  }
  if (live && !hasIsrc) {
    return {
      status: "awaiting_isrc",
      label: "Live — ISRC pending",
      reason: "Store live mais ISRC pas encore visible ; réessaie bientôt",
      canSubmitUnison: false,
    };
  }
  if (hasIsrc) {
    return {
      status: "ready",
      label: "Prêt Unison",
      reason: `ISRC ${identifiers.isrc} — ouvre Release Publishing sur ONCE`,
      canSubmitUnison: true,
    };
  }
  return {
    status: "unknown",
    label: "Statut inconnu",
    reason: "Rafraîchis les stats ONCE",
    canSubmitUnison: false,
  };
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

/** SONOZZ pipeline = AI-generated music (SongGeneration / MiniMax / Replicate). */
function isAiGeneratedTrack(track) {
  const p = String(track?.provider || "").toLowerCase();
  if (!p || p === "brief") return true; // pipeline SONOZZ = IA par défaut
  return /minimax|songgen|replicate|suno|udio|ai/.test(p);
}

/**
 * Republier une release existante (draft / Attention Needed / Rejected)
 * sans créer un nouvel id — le débit ONCE est clé sur releaseId (pas de double charge).
 */
export function canReuseOnceRelease(distrokid) {
  const id = String(distrokid?.releaseId || "").trim();
  if (!id || id.startsWith("once_") || id.length < 8) return false;
  return true;
}

export async function submitOnceRelease(
  token,
  { artist, track, cover, lyrics, keys, releaseId: existingReleaseId = null, reuseRelease = false },
) {
  const artistName = (keys?.distrokidArtistName?.trim() || artist?.name || artist?.aka || "Unknown Artist").trim();
  // Writers = nom légal complet (règle ONCE : ≥ 2 parties, ≥ 2 chars par partie Latin).
  // Fabriquer un nom est interdit — on renvoie null puis on lève une erreur claire.
  const writerLegalName = pickLegalPersonName(
    keys?.distrokidLegalName,
    artist?.legalName,
    artist?.realName,
  );

  if (!writerLegalName) {
    throw new Error(
      "Nom légal writer manquant. ONCE exige un prénom + nom complet pour le writer (règle DSP, jamais un mononyme fabriqué). Renseigne « Nom légal writer » dans Paramètres → Distribution ONCE (ex. « Kaelen Moreau »), puis republie.",
    );
  }

  const reuseId = reuseRelease ? String(existingReleaseId || "").trim() : "";
  if (reuseRelease && !reuseId) {
    throw new Error(
      "Republication : releaseId ONCE manquant. Ouvre le projet qui a déjà une release, ou publie une nouvelle release.",
    );
  }

  // Producer / Engineer : paramètre global (tous artistes), sinon writer / artiste.
  // Les contribs pro acceptent un mononyme / nom de scène.
  const producerName = resolveProducerName(keys, { writerLegalName, artistName });

  const title = (track?.title || lyrics?.title || "Untitled").trim();
  const { genre, sub_genre } = mapGenre(artist?.genre || track?.style || "");
  const year = String(new Date().getFullYear());
  const label = keys?.distrokidLabel?.trim() || `${artistName}`;
  const days = Number(keys?.distrokidReleaseDays) || 14;
  const explicit = detectExplicit(lyrics?.text || "");
  const containsAi = isAiGeneratedTrack(track);
  const isInstrumental = track?.hasVocals === false;

  const me = await onceMe(token);
  const credits = await onceCredits(token);
  const profile = me?.profile || me;
  const creditBalanceBefore = credits?.balance ?? credits?.credits ?? credits?.available ?? null;

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
      { name: producerName, role: "Producer" },
      { name: producerName, role: "Engineer" },
    ],
  };

  const trackPayload = {
    title,
    primary_artist_name: artistName,
    explicit_flag: explicit,
    track_type: "original",
    language: audioLang,
    contains_ai: containsAi,
    pline_year: year,
    pline_owner: label,
    cline_year: year,
    cline_owner: label,
    writers: [{ name: writerLegalName }],
    contributors: [
      { name: producerName, role: "Producer" },
      { name: producerName, role: "Engineer" },
    ],
  };

  if (isInstrumental) {
    trackPayload.is_instrumental = true;
  }

  if (lyrics?.text && !isInstrumental) {
    trackPayload.lyrics = String(lyrics.text).trim();
  }

  if (audioFileUrl) {
    trackPayload.audio_file_url = audioFileUrl;
  }

  // Draft : sans release_id = nouveau ; avec = upsert sur la même release (0 nouveau crédit)
  const draftBody = {
    release: releasePayload,
    tracks: [trackPayload],
    mode: "replace",
  };
  if (reuseId) draftBody.release_id = reuseId;

  const draft = await onceFetch(token, "/drafts", {
    method: "POST",
    body: JSON.stringify(draftBody),
  });

  let submitted = null;
  let status = "draft-saved";
  let warning;

  // Nouvelle release : besoin de crédits. Republie (même id) : débit déjà clé sur releaseId.
  const needsFreshCredits = !reuseId;
  if (!audioFileUrl) {
    warning =
      "Draft ONCE créé, mais audio public manquant. Ajoute Replicate (ou une URL audio) puis resoumets.";
  } else if (needsFreshCredits && creditBalanceBefore === 0) {
    status = "draft-only";
    warning =
      "Draft ONCE créé, mais 0 crédit. Achète des crédits sur once.app/pricing (1–2 $ / titre) puis resoumets.";
  } else {
    try {
      const submitBody = {
        release: releasePayload,
        tracks: [{ ...trackPayload, audio_file_url: audioFileUrl }],
      };
      if (reuseId) submitBody.release_id = reuseId;

      submitted = await onceFetch(token, "/releases", {
        method: "POST",
        body: JSON.stringify(submitBody),
      });
      status = "submitted";
    } catch (e) {
      status = "draft-only";
      warning = reuseId
        ? `Draft mis à jour (${reuseId.slice(0, 8)}…), soumission refusée : ${e.message}. Essaie Retry Distribution sur beta.once.app/releases/${reuseId}.`
        : `Draft OK, soumission refusée : ${e.message}`;
    }
  }

  const releaseId =
    reuseId ||
    submitted?.id ||
    submitted?.releaseId ||
    draft?.releaseId ||
    draft?.release_id;

  let creditBalanceAfter = creditBalanceBefore;
  let creditsRawAfter = credits;
  try {
    creditsRawAfter = await onceCredits(token);
    creditBalanceAfter =
      creditsRawAfter?.balance ?? creditsRawAfter?.credits ?? creditsRawAfter?.available ?? creditBalanceBefore;
  } catch {
    /* ignore */
  }

  const creditsDebited =
    typeof creditBalanceBefore === "number" && typeof creditBalanceAfter === "number"
      ? Math.max(0, creditBalanceBefore - creditBalanceAfter)
      : null;

  const langLabelMap = {
    fr: "French",
    en: "English",
    es: "Spanish",
    pt: "Portuguese",
    it: "Italian",
    de: "German",
    ar: "Arabic",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
  };

  const form = {
    artistName,
    trackTitle: title,
    genre,
    subgenre: sub_genre,
    lyricsLanguage: langLabelMap[audioLang] || audioLang.toUpperCase(),
    explicitLyrics: explicit ? "Yes" : "No",
    containsAi: containsAi ? "Yes" : "No",
    isInstrumental: isInstrumental ? "Yes" : "No",
    releaseDate: releaseDateISO(days),
    recordLabel: label,
    producer: producerName,
    copyrightOwner: `© ${year} ${label}`,
    phonogramOwner: `℗ ${year} ${label}`,
    stores: ["Spotify", "Apple Music", "YouTube Music", "TikTok", "Amazon"],
  };

  const releaseDashboard = releaseId
    ? `https://beta.once.app/releases/${releaseId}`
    : "https://once.app/";

  const reused = Boolean(reuseId);
  const note = reused
    ? creditsDebited === 0
      ? `Republication sur la même release (${releaseId}) — aucun crédit supplémentaire débité.`
      : `Republication sur ${releaseId}${creditsDebited != null ? ` · ${creditsDebited} crédit(s) débité(s)` : ""}.`
    : "Distribution automatique via API ONCE (crédits débités à la soumission).";

  return {
    provider: "once",
    status,
    releaseId,
    packageId: releaseId || `once_${Date.now().toString(36)}`,
    reusedRelease: reused,
    creditsDebited,
    account: profile?.email || profile?.first_name || profile?.id || null,
    credits: {
      balance: creditBalanceAfter,
      before: creditBalanceBefore,
      debited: creditsDebited,
      raw: creditsRawAfter,
    },
    title,
    artist: artistName,
    legalName: writerLegalName,
    producer: producerName,
    genre,
    sub_genre,
    stores: form.stores,
    containsAi,
    isInstrumental,
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
      legalName: writerLegalName,
      producer: producerName,
      title,
      genre,
      sub_genre,
      releaseDate: form.releaseDate,
      label,
      stores: form.stores,
      containsAi,
      isInstrumental,
      language: audioLang,
      reusedRelease: reused,
    },
    dashboardUrl: releaseDashboard,
    eta: "Souvent 24–72 h via ONCE → Spotify",
    warning,
    note,
    checklist: [
      { label: "Token ONCE", ok: true },
      { label: "Jaquette uploadée", ok: Boolean(coverArtFileUrl) },
      { label: "Audio uploadé", ok: Boolean(audioFileUrl) },
      {
        label: reused ? "Draft mis à jour (même release)" : "Draft créé",
        ok: Boolean(draft),
      },
      { label: "Release soumise", ok: status === "submitted" },
      ...(reused
        ? [
            {
              label: "Sans nouveau crédit",
              ok: creditsDebited === 0 || creditsDebited == null,
              tip:
                creditsDebited > 0
                  ? `${creditsDebited} crédit(s) débités — vérifie l’historique ONCE`
                  : "Débit clé sur releaseId (idempotent)",
            },
          ]
        : []),
    ],
  };
}
