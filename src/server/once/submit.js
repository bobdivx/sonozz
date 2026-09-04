import { onceFetch, onceMe, onceCredits, onceMcpCall } from "./client.js";
import { mapGenre, releaseDateISO, detectExplicit } from "./normalize.js";
import { pickLegalPersonName, resolveProducerName } from "./names.js";
import { resolveCoverFileUrl, resolveAudioFileUrl } from "./upload.js";

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

/** SONOZZ pipeline = AI-generated music (SongGeneration / MiniMax / Replicate). */
function isAiGeneratedTrack(track) {
  const p = String(track?.provider || "").toLowerCase();
  if (!p || p === "brief") return true; // pipeline SONOZZ = IA par défaut
  return /minimax|songgen|acestep|replicate|suno|udio|ai/.test(p);
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

function normalizeOnceTitle(s = "") {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/**
 * Vérifie qu'une release est modifiable avec le token courant.
 * Si l'id projet est mort (autre compte / supprimé), tente un match titre+artiste.
 * @returns {Promise<string>} releaseId utilisable
 */
async function resolveReusableReleaseId(token, releaseId, { title, artistName } = {}) {
  const id = String(releaseId || "").trim();
  if (!id) {
    throw new Error("releaseId ONCE manquant pour la republication.");
  }

  try {
    await onceFetch(token, `/releases/${encodeURIComponent(id)}`);
    return id;
  } catch (e) {
    const status = e.status || 0;
    if (status !== 403 && status !== 404 && !/forbidden|not_found|not found/i.test(e.message || "")) {
      throw e;
    }
  }

  // Id stale : chercher une release du même titre sur ce compte
  let list = [];
  try {
    const data = await onceFetch(token, "/releases");
    list = Array.isArray(data?.releases) ? data.releases : Array.isArray(data) ? data : [];
  } catch {
    list = [];
  }

  const wantTitle = normalizeOnceTitle(title);
  const wantArtist = normalizeOnceTitle(artistName);
  const match = list.find((r) => {
    const t = normalizeOnceTitle(r.title || r.trackTitle);
    const a = normalizeOnceTitle(r.primary_artist_name || r.artistName);
    if (!wantTitle || t !== wantTitle) return false;
    if (wantArtist && a && a !== wantArtist) return false;
    return Boolean(r.id);
  });

  if (match?.id) {
    console.warn(
      `[once] releaseId projet ${id.slice(0, 8)}… inaccessible — réutilisation de ${String(match.id).slice(0, 8)}… (« ${match.title} »)`,
    );
    return String(match.id);
  }

  throw new Error(
    `Release ONCE ${id.slice(0, 8)}… introuvable sur ce compte (supprimée ou autre token). ` +
      `Utilise « Publier » (nouvelle release) plutôt que « Réutiliser », ou mets à jour le releaseId dans le projet.`,
  );
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

  const reuseIdRaw = reuseRelease ? String(existingReleaseId || "").trim() : "";
  if (reuseRelease && !reuseIdRaw) {
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
  // Label global (Paramètres) prioritaire — sinon label déjà forcé sur le profil artiste.
  const label =
    keys?.distrokidLabel?.trim() ||
    artist?.recordLabel?.trim() ||
    `${artistName}`;
  const days = Number(keys?.distrokidReleaseDays) || 14;
  const explicit = detectExplicit(lyrics?.text || "");
  const containsAi = isAiGeneratedTrack(track);
  const isInstrumental = track?.hasVocals === false;

  const me = await onceMe(token);
  const credits = await onceCredits(token);
  const profile = me?.profile || me;
  const creditBalanceBefore = credits?.balance ?? credits?.credits ?? credits?.available ?? null;

  const reuseId = reuseIdRaw
    ? await resolveReusableReleaseId(token, reuseIdRaw, { title, artistName })
    : "";
  const releaseIdHealed = Boolean(reuseId && reuseIdRaw && reuseId !== reuseIdRaw);

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
  if (releaseIdHealed) {
    warning = [
      warning,
      `Ancien releaseId projet inaccessible — réutilisation de ${releaseId} (même titre sur ce compte ONCE).`,
    ]
      .filter(Boolean)
      .join(" ");
  }
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
    releaseIdHealed,
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
                  ? `${creditsDebited} crédit(s) débités — vérifie l'historique ONCE`
                  : "Débit clé sur releaseId (idempotent)",
            },
          ]
        : []),
    ],
  };
}
