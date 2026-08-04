import { useEffect, useState } from "preact/hooks";
import {
  Clapperboard,
  Download,
  Film,
  AudioLines,
  Sparkles,
  ChevronRight,
  Upload,
  Trash2,
  RefreshCw,
} from "lucide-preact";
import { renderShortVideo, downloadBlob } from "../../lib/renderShort.js";
import { assemblePromoShort, PROMO_SHORT_SECONDS } from "../../lib/assemblePromoShort.js";
import { extractTrackExcerpt } from "../../lib/audioExcerpt.js";
import { detectBeatsFromUrl, pickCutPoints } from "../../lib/beatDetect.js";
import { planMusicVideoShots } from "../../lib/shotPlan.js";
import { resolveVideoBlobUrls } from "../../lib/videoResolve.js";
import { loadKeys } from "../../lib/keys.js";
import { api } from "../../lib/apiClient.js";
import {
  clipMetaOnly,
  ensureClipStorageKey,
  resolveClipBlob,
  saveClipBlob,
  deleteClipBlob,
} from "../../lib/clipStore.js";
import {
  CLIP_KIND_FULL,
  CLIP_KIND_SHORT,
  clipBlobKey,
  clipsOfKind,
  createClipId,
  isClipReady,
  normalizeProjectClips,
} from "../../lib/clipsModel.js";
import ClipGallery, { clipLabel } from "../ClipGallery.jsx";
import {
  continueVeoAfterStart,
  startSeedanceJob,
  startWan2gpJob,
  waitForJob,
} from "../../lib/jobRunner.js";
import { createJobId } from "../../lib/jobStore.js";

/** Seedance = payant Replicate (~$0.9–2 / plan). Défaut économique = Veo (Gemini). */
const SEEDANCE_SHOTS = 2;
const SEEDANCE_SHOT_SEC = 5;
/** Wan2GP local — mêmes découpes que Seedance, image→vidéo Gradio. */
const WAN2GP_SHOTS = 2;
const WAN2GP_SHOT_SEC = 5;
const MAX_IMPORT_BYTES = 80_000_000;

function isUsableSocialBrief(social) {
  const brief = social?.audioBrief || social?.veo?.audioBrief;
  if (!brief || typeof brief !== "object") return false;
  return Boolean(
    brief.veoDirection ||
      brief.energy ||
      brief.mood ||
      (Array.isArray(brief.visualBeats) && brief.visualBeats.length),
  );
}

function probeVideoDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const d = Number.isFinite(el.duration) ? Math.round(el.duration) : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    el.src = url;
  });
}

function hasAudio(track) {
  return Boolean(track?.audioUrl);
}

function isEphemeralHttp(url = "") {
  return (
    /^https?:\/\//i.test(url) &&
    /replicate\.delivery|pb\.replicate\.com|fal\.media|oaidalleapiprodscus/i.test(url)
  );
}

function isDurableRaster(url = "") {
  return /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(url);
}

function blobToObjectUrl(blob) {
  return URL.createObjectURL(blob);
}

export default function ClipStep({
  social,
  clip,
  clips = [],
  activeClipId = null,
  projectId,
  artist,
  track,
  cover,
  lyrics,
  loading,
  onGeneratePack,
  onClipReady,
  onSelectClip,
  onRemoveClip,
  onGoToTracks,
  onGoToArtist,
  onGoToCover,
  onGoToSocial,
}) {
  const normalized = normalizeProjectClips({ clip, clips, activeClipId });
  const allClips = normalized.clips;
  const activeId = normalized.activeClipId;
  const activeClip = allClips.find((c) => c.id === activeId) || clip || null;

  const [kindTab, setKindTab] = useState(
    activeClip?.kind === CLIP_KIND_FULL ? CLIP_KIND_FULL : CLIP_KIND_SHORT,
  );
  const [creatingNew, setCreatingNew] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoBlob, setVideoBlob] = useState(null);
  const [videoMeta, setVideoMeta] = useState(null);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  /** veo | seedance | wan2gp */
  const [clipEngine, setClipEngine] = useState(() => {
    try {
      const k = loadKeys();
      return String(k.videoProvider || "").trim() === "wan2gp" ? "wan2gp" : "veo";
    } catch {
      return "veo";
    }
  });

  const hasPortrait = Boolean(artist?.imageUrl && !/^data:image\/svg/i.test(artist.imageUrl));
  const hasCover = Boolean(cover?.imageUrl && !/^data:image\/svg/i.test(cover.imageUrl));
  const portraitExpired = isEphemeralHttp(artist?.imageUrl);
  const coverExpired = isEphemeralHttp(cover?.imageUrl);
  const portraitDurable = isDurableRaster(artist?.imageUrl);
  const trackReady = Boolean(track);
  const audioReady = hasAudio(track);

  const kindClips = clipsOfKind(allClips, kindTab);
  const activeInTab = kindClips.some((c) => c.id === activeId);

  useEffect(() => {
    if (activeClip?.kind && activeClip.kind !== kindTab) {
      setKindTab(activeClip.kind);
    }
  }, [activeClip?.id, activeClip?.kind]);

  useEffect(() => {
    if (creatingNew) {
      setVideoBlob(null);
      setVideoMeta(null);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }
    const hasMeta = isClipReady(activeClip) || activeClip?.provider === "canvas-fallback";
    if (!hasMeta) {
      setVideoBlob(null);
      setVideoMeta(null);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const blob = await resolveClipBlob(projectId, activeClip);
        if (cancelled) return;
        if (!blob || blob.size < 1000) {
          setError(
            activeClip?.s3Key || activeClip?.storedRemote
              ? "Clip distant inaccessible — vérifie les variables S3 du conteneur ou régénère."
              : "Clip introuvable (IndexedDB vide) — régénère ou réimporte.",
          );
          return;
        }
        const typed =
          blob.type?.startsWith("video/")
            ? blob
            : new Blob([blob], {
                type: activeClip?.mimeType || activeClip?.publishMimeType || "video/mp4",
              });
        const url = blobToObjectUrl(typed);
        setVideoBlob(typed);
        setVideoUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setVideoMeta({
          id: activeClip.id,
          kind: activeClip.kind,
          provider: activeClip.provider,
          usedPortrait: activeClip.usedPortrait,
          usedCover: activeClip.usedCover,
          warning: activeClip.warning,
          fileName: activeClip.fileName,
          isVeo: activeClip.provider !== "canvas-fallback" && activeClip.provider !== "user-upload",
          durationSec: activeClip.durationSec,
        });
        setError("");
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Clip illisible — régénère ou réimporte.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    projectId,
    activeClip?.id,
    activeClip?.storedLocally,
    activeClip?.storedRemote,
    activeClip?.provider,
    activeClip?.at,
    activeClip?.videoUrl,
    activeClip?.s3Key,
    creatingNew,
  ]);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  async function analyzeBeatsSafe() {
    try {
      const analysis = await detectBeatsFromUrl(track.audioUrl, PROMO_SHORT_SECONDS);
      return {
        beats: analysis.beats || [],
        cutPoints: pickCutPoints(analysis.beats || [], {
          durationSec: PROMO_SHORT_SECONDS,
          minGap: 2.4,
          maxCuts: 6,
        }),
        bpmEstimate: analysis.bpmEstimate,
      };
    } catch (e) {
      console.warn("[clip] beats:", e.message);
      return { beats: [], cutPoints: [0], bpmEstimate: track?.bpm || 100 };
    }
  }

  async function muxCinematic({
    videoUrls,
    providerLabel,
    audioBrief,
    clipId,
    extra = {},
    cutPoints: forcedCuts,
    shotSec,
  } = {}) {
    const beatInfo = await analyzeBeatsSafe();
    setStatusMsg("Montage cinéma : multi-plans + ton audio + beats…");
    setProgress(78);
    const objectUrls = [];
    let revokeResolved = () => {};
    try {
      setStatusMsg("Téléchargement des plans (proxy, anti-CORS)…");
      const resolved = await resolveVideoBlobUrls(videoUrls);
      revokeResolved = resolved.revokeAll;
      const urls = resolved.urls;
      if (!urls.length) throw new Error("Aucun plan vidéo à monter");

      // Seedance : cuts = offsets audio des extraits (pas un découpage égal arbitraire)
      const alignedCuts =
        forcedCuts?.length >= 1
          ? forcedCuts
          : urls.length > 1 && shotSec
            ? Array.from({ length: urls.length }, (_, i) => i * shotSec)
            : urls.length > 1
              ? beatInfo.cutPoints?.length >= urls.length
                ? beatInfo.cutPoints.slice(0, urls.length)
                : Array.from({ length: urls.length }, (_, i) => (i * PROMO_SHORT_SECONDS) / urls.length)
              : beatInfo.cutPoints;
      setStatusMsg("Montage cinéma : multi-plans + ton audio + beats…");
      const finalBlob = await assemblePromoShort({
        veoVideoUrls: urls,
        track,
        artist,
        social,
        durationSec: PROMO_SHORT_SECONDS,
        beats: beatInfo.beats,
        cutPoints: alignedCuts,
        cinematic: true,
        onProgress: (p) => setProgress(78 + Math.round(p * 0.2)),
      });
      const muxMime = finalBlob.type?.startsWith("video/") ? finalBlob.type : "video/webm";
      const isMp4 = /mp4/i.test(muxMime);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(blobToObjectUrl(finalBlob));
      setVideoBlob(finalBlob);
      setProgress(100);
      const meta = clipMetaOnly({
        id: clipId,
        kind: CLIP_KIND_SHORT,
        provider: providerLabel,
        warning: [
          "1080×1920 · 9:16 TikTok",
          audioBrief?.bpmEstimate || beatInfo.bpmEstimate
            ? `Montage ~${audioBrief?.bpmEstimate || beatInfo.bpmEstimate} BPM (pas de lip-sync)`
            : "Montage rythme (pas de lip-sync)",
          `${urls.length} plan(s) + audio du morceau`,
          isMp4 ? "" : "WebM — Chrome recommandé pour TikTok MP4",
        ]
          .filter(Boolean)
          .join(" · "),
        isVeo: /veo/i.test(providerLabel),
        durationSec: PROMO_SHORT_SECONDS,
        mimeType: muxMime,
        publishMimeType: isMp4 ? "video/mp4" : muxMime,
        muxed: true,
        cinematic: true,
        audioBrief: audioBrief || null,
        at: new Date().toISOString(),
        storedLocally: true,
        ...extra,
      });
      await commitClip(finalBlob, meta);
      return finalBlob;
    } finally {
      objectUrls.forEach((u) => URL.revokeObjectURL(u));
      try {
        revokeResolved();
      } catch {
        /* ignore */
      }
    }
  }

  async function loadClipAfterJob(clipId) {
    let meta = { id: clipId, kind: CLIP_KIND_SHORT, storedLocally: true };
    if (projectId) {
      try {
        const row = await api.getProject(projectId);
        const proj = normalizeProjectClips(row.project || row);
        meta = proj.clips.find((c) => c.id === clipId) || proj.clip || meta;
      } catch {
        /* ignore */
      }
    }
    const blob = await resolveClipBlob(projectId, meta);
    if (!blob) throw new Error("Clip généré introuvable — rouvre Clips depuis la sidebar");
    const typed =
      blob.type?.startsWith("video/")
        ? blob
        : new Blob([blob], { type: meta.mimeType || "video/mp4" });
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(blobToObjectUrl(typed));
    setVideoBlob(typed);
    setVideoMeta(meta);
    setProgress(100);
    setReplaceMode(false);
    setCreatingNew(false);
    onClipReady?.(meta, typed, ensureClipStorageKey(projectId, clipId));
    setStatusMsg("");
    return typed;
  }

  /** Pipeline local : Wan2GP image→vidéo (Gradio) — poll + mux en fond. */
  async function renderWithWan2gp() {
    setError("");
    setStatusMsg("");
    setRendering(true);
    setProgress(4);
    const clipId = resolveTargetClipId({ forceNew: !replaceMode });
    const keys = loadKeys();
    if (!keys.wan2gpBaseUrl?.trim()) {
      throw new Error("URL Wan2GP manquante — Paramètres → Provider vidéo = Wan2GP");
    }
    if (!track?.audioUrl) throw new Error("Audio du morceau requis");

    try {
      setStatusMsg("Analyse beats + brief pour Wan2GP…");
      const listenExcerpt = await extractTrackExcerpt(track.audioUrl, PROMO_SHORT_SECONDS, 0);
      setProgress(8);
      let audioBrief = isUsableSocialBrief(social) ? social.audioBrief || social?.veo?.audioBrief : null;
      if (!audioBrief && keys.geminiApiKey?.trim()) {
        try {
          const listened = await api.wan2gpListen({
            track,
            lyrics,
            social,
            audioExcerptBase64: listenExcerpt.base64,
            audioExcerptMimeType: listenExcerpt.mimeType,
          });
          audioBrief = listened?.audioBrief || null;
        } catch (e) {
          console.warn("[clip] wan2gp listen:", e.message);
        }
      }

      const shotPlan = planMusicVideoShots({
        lyrics,
        social,
        audioBrief,
        shotCount: WAN2GP_SHOTS,
        shotSec: WAN2GP_SHOT_SEC,
      });

      const jobId = createJobId("wan");
      startWan2gpJob({
        jobId,
        audioBrief,
        shotPlan,
        shotSec: WAN2GP_SHOT_SEC,
        shotTotal: WAN2GP_SHOTS,
        label: `Wan2GP${track?.title ? ` · ${track.title}` : ""}`,
        context: {
          projectId,
          clipId,
          artist,
          track,
          cover,
          social,
          lyrics,
        },
      });

      setStatusMsg("Wan2GP en arrière-plan — tu peux naviguer (suivi sidebar)");
      await waitForJob(jobId, {
        onUpdate: (j) => {
          if (typeof j.progress === "number") setProgress(j.progress);
          if (j.message) setStatusMsg(`${j.message} · sidebar`);
        },
      });
      return await loadClipAfterJob(clipId);
    } finally {
      setRendering(false);
    }
  }

  /** Pipeline pro : Seedance — poll + mux en fond. */
  async function renderWithSeedance() {
    setError("");
    setStatusMsg("");
    setRendering(true);
    setProgress(4);
    const clipId = resolveTargetClipId({ forceNew: !replaceMode });
    const keys = loadKeys();
    if (!keys.replicateApiToken?.trim()) {
      throw new Error("Token Replicate manquant pour Seedance");
    }
    if (!track?.audioUrl) throw new Error("Audio du morceau requis");

    try {
      setStatusMsg("Analyse beats + extraits du morceau…");
      const listenExcerpt = await extractTrackExcerpt(track.audioUrl, PROMO_SHORT_SECONDS, 0);
      setProgress(8);
      let audioBrief = isUsableSocialBrief(social) ? social.audioBrief || social?.veo?.audioBrief : null;
      if (audioBrief) {
        setStatusMsg("Brief audio réutilisé (économie)…");
      } else {
        try {
          const listened = await api.seedanceListen({
            track,
            lyrics,
            social,
            audioExcerptBase64: listenExcerpt.base64,
            audioExcerptMimeType: listenExcerpt.mimeType,
          });
          audioBrief = listened?.audioBrief || null;
        } catch (e) {
          console.warn("[clip] listen:", e.message);
        }
      }

      const shotPlan = planMusicVideoShots({
        lyrics,
        social,
        audioBrief,
        shotCount: SEEDANCE_SHOTS,
        shotSec: SEEDANCE_SHOT_SEC,
      });

      const jobId = createJobId("seed");
      startSeedanceJob({
        jobId,
        audioBrief,
        shotPlan,
        shotSec: SEEDANCE_SHOT_SEC,
        shotTotal: SEEDANCE_SHOTS,
        label: `Seedance${track?.title ? ` · ${track.title}` : ""}`,
        context: {
          projectId,
          clipId,
          artist,
          track,
          cover,
          social,
          lyrics,
        },
      });

      setStatusMsg("Seedance en arrière-plan — tu peux naviguer (suivi sidebar)");
      await waitForJob(jobId, {
        onUpdate: (j) => {
          if (typeof j.progress === "number") setProgress(j.progress);
          if (j.message) setStatusMsg(`${j.message} · sidebar`);
        },
      });
      return await loadClipAfterJob(clipId);
    } finally {
      setRendering(false);
    }
  }

  function resolveTargetClipId({ forceNew = false } = {}) {
    if (forceNew || creatingNew) return createClipId();
    if (replaceMode && activeInTab && activeId) return activeId;
    return createClipId();
  }

  async function commitClip(blob, metaBase) {
    const clipId = metaBase.id || createClipId();
    const kind = metaBase.kind || CLIP_KIND_SHORT;
    let meta = clipMetaOnly(metaBase, { id: clipId, kind });
    setVideoMeta(meta);

    const storageKey = ensureClipStorageKey(projectId, clipId);
    await saveClipBlob(storageKey, blob, meta);

    try {
      setStatusMsg("Upload S3…");
      setProgress(96);
      const remote = await api.uploadClip({
        videoBlob: blob,
        projectId: storageKey,
        mimeType: meta.mimeType || blob.type || "video/mp4",
      });
      meta = clipMetaOnly(meta, {
        videoUrl: remote.videoUrl,
        s3Key: remote.s3Key,
        storedRemote: true,
        storedLocally: true,
        byteLength: remote.byteLength,
        warning: `${meta.warning || "Clip"} · S3`,
      });
      setVideoMeta(meta);
      await saveClipBlob(storageKey, blob, meta);
    } catch (upErr) {
      console.warn("[clip] S3 upload skip:", upErr.message);
      meta = clipMetaOnly(meta, {
        warning: `${meta.warning || "Clip"} · local only (${upErr.message})`,
      });
      setVideoMeta(meta);
    }

    setReplaceMode(false);
    setCreatingNew(false);
    setStatusMsg("");
    onClipReady?.(meta, blob, storageKey);
    return meta;
  }

  async function renderWithVeo(safePrompt = false) {
    setError("");
    setStatusMsg("");
    setRendering(true);
    setProgress(5);
    const clipId = resolveTargetClipId({ forceNew: !replaceMode });
    try {
      let audioExcerptBase64;
      let audioExcerptMimeType;
      if (track?.audioUrl) {
        try {
          setStatusMsg("Extrait du morceau (28 s) pour caler le clip…");
          setProgress(6);
          const excerpt = await extractTrackExcerpt(track.audioUrl, PROMO_SHORT_SECONDS);
          audioExcerptBase64 = excerpt.base64;
          audioExcerptMimeType = excerpt.mimeType;
        } catch (exErr) {
          console.warn("[clip] extrait audio:", exErr.message);
          setStatusMsg("Extrait local KO — écoute via URL du morceau…");
        }
      }

      setStatusMsg(
        audioExcerptBase64 || track?.audioUrl
          ? "Écoute du morceau + démarrage Veo…"
          : "Veo : démarrage…",
      );
      setProgress(8);
      const started = await api.veoShortStart({
        artist,
        track,
        cover,
        social,
        lyrics,
        safePrompt,
        audioExcerptBase64,
        audioExcerptMimeType,
      });
      if (!started?.operationName) throw new Error("Veo n’a pas renvoyé d’opération");

      const jobId = createJobId("veo");
      continueVeoAfterStart({
        jobId,
        started,
        label: `Short Veo${track?.title ? ` · ${track.title}` : ""}`,
        context: {
          projectId,
          clipId,
          artist,
          track,
          cover,
          social,
          lyrics,
        },
      });

      setStatusMsg(
        started.warning
          ? `${started.warning} — tu peux naviguer (suivi sidebar)`
          : "Veo en arrière-plan — tu peux naviguer (suivi sidebar)",
      );

      await waitForJob(jobId, {
        onUpdate: (j) => {
          if (typeof j.progress === "number") setProgress(j.progress);
          if (j.message) setStatusMsg(`${j.message} · sidebar`);
        },
      });

      return await loadClipAfterJob(clipId);
    } catch (e) {
      const msg = String(e?.message || e);
      if (
        (!safePrompt || e.celebrity) &&
        /VEO_CELEBRITY_FILTER|celebrity|likeness|real people/i.test(msg)
      ) {
        if (!safePrompt) {
          setStatusMsg("Filtre Veo (noms/ressemblance) — nouvel essai sans noms…");
          setRendering(false);
          return renderWithVeo(true);
        }
        setError(
          "Veo refuse les noms / ressemblances « célébrité ». Régénère un portrait plus original, puis réessaie.",
        );
      } else {
        setError(msg || "Génération Veo impossible");
      }
      setStatusMsg("");
      return null;
    } finally {
      setRendering(false);
    }
  }

  async function renderWithCanvas() {
    setError("");
    setRendering(true);
    setProgress(0);
    const clipId = resolveTargetClipId({ forceNew: !replaceMode });
    try {
      const blob = await renderShortVideo({
        artist,
        track,
        coverUrl: cover?.imageUrl || artist?.imageUrl,
        social,
        onProgress: setProgress,
      });
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = blobToObjectUrl(blob);
      setVideoUrl(url);
      setVideoBlob(blob);
      const meta = clipMetaOnly({
        id: clipId,
        kind: CLIP_KIND_SHORT,
        provider: "canvas-fallback",
        isVeo: false,
        warning: "Maquette locale uniquement — ce n’est pas un clip Veo.",
        mimeType: blob.type || "video/webm",
        at: new Date().toISOString(),
        storedLocally: true,
      });
      await commitClip(blob, meta);
      return blob;
    } catch (e) {
      setError(e.message || "Maquette locale impossible");
      return null;
    } finally {
      setRendering(false);
    }
  }

  async function generateVeoClip() {
    setKindTab(CLIP_KIND_SHORT);
    if (!audioReady) {
      setError("Crée d'abord le morceau audio (étape 4).");
      return null;
    }
    if (!social) {
      setError("Génère d’abord le pack scènes (bouton 1).");
      return null;
    }
    if (!hasPortrait) {
      setError("Portrait artiste photo requis — régénère l’étape Artiste.");
      return null;
    }
    if (portraitExpired) {
      setError(
        "Portrait expiré (URL Replicate morte). Va à l’étape Artiste, régénère le portrait, puis relance.",
      );
      return null;
    }

    const keys = loadKeys();
    if (clipEngine === "wan2gp") {
      try {
        return await renderWithWan2gp();
      } catch (e) {
        console.warn("[clip] Wan2GP KO:", e.message);
        setRendering(false);
        setError(e.message || "Wan2GP impossible");
        return null;
      }
    }
    // Par défaut Veo (Gemini) — Seedance seulement si choisi (crédits Replicate)
    if (clipEngine === "seedance" && keys.replicateApiToken?.trim()) {
      try {
        return await renderWithSeedance();
      } catch (e) {
        console.warn("[clip] Seedance KO → fallback Veo:", e.message);
        setStatusMsg(`Seedance indisponible (${e.message?.slice(0, 80)}) — bascule Veo…`);
        setRendering(false);
      }
    }

    return renderWithVeo();
  }

  function exportOnly() {
    if (!videoBlob) {
      setError("Génère ou importe d’abord une vidéo.");
      return;
    }
    const ext = videoBlob.type.includes("mp4") ? "mp4" : "webm";
    const safe = (track?.title || "short").replace(/[^\w\-]+/g, "_").slice(0, 40);
    const kind = kindTab === CLIP_KIND_FULL ? "full" : "short";
    downloadBlob(videoBlob, `${safe}-${kind}-9x16.${ext}`);
  }

  async function importUserVideo(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;

    setError("");
    setStatusMsg("");

    const mime = file.type || "";
    const looksVideo =
      mime.startsWith("video/") ||
      /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name || "");
    if (!looksVideo) {
      setError("Choisis un fichier vidéo (mp4, webm, mov…).");
      return;
    }
    if (file.size < 1000) {
      setError("Fichier trop petit / invalide.");
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setError("Vidéo trop lourde (max ~80 Mo).");
      return;
    }

    setRendering(true);
    setProgress(10);
    const clipId = resolveTargetClipId({ forceNew: !replaceMode });
    try {
      const mimeType = mime.startsWith("video/")
        ? mime
        : /\.webm$/i.test(file.name)
          ? "video/webm"
          : "video/mp4";
      const blob = new Blob([await file.arrayBuffer()], { type: mimeType });
      const durationSec = (await probeVideoDuration(blob)) || undefined;
      const isMp4 = /mp4|quicktime/i.test(mimeType);

      setProgress(40);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = blobToObjectUrl(blob);
      setVideoUrl(url);
      setVideoBlob(blob);

      const meta = clipMetaOnly({
        id: clipId,
        kind: kindTab,
        provider: "user-upload",
        isVeo: false,
        fileName: file.name,
        warning: isMp4
          ? `Import · ${file.name}`
          : `Import · ${file.name} — préfère un MP4 pour TikTok`,
        mimeType,
        publishMimeType: isMp4 ? "video/mp4" : mimeType,
        durationSec,
        at: new Date().toISOString(),
        storedLocally: true,
      });
      await commitClip(blob, meta);
    } catch (err) {
      setError(err?.message || "Import vidéo impossible");
      setStatusMsg("");
    } finally {
      setRendering(false);
    }
  }

  async function removeClip(clipId) {
    if (!clipId) return;
    const key = clipBlobKey(projectId, clipId) || ensureClipStorageKey(projectId, clipId);
    try {
      await deleteClipBlob(key);
    } catch {
      /* ignore */
    }
    if (clipId === activeId) {
      setReplaceMode(false);
      setCreatingNew(false);
      setVideoBlob(null);
      setVideoMeta(null);
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    onRemoveClip?.(clipId);
  }

  async function removeActive() {
    if (!activeId || !activeInTab) return;
    await removeClip(activeId);
  }

  const isCanvasMock =
    videoMeta?.provider === "canvas-fallback" || activeClip?.provider === "canvas-fallback";
  const isUserUpload =
    videoMeta?.provider === "user-upload" || activeClip?.provider === "user-upload";
  const hasPublishableClip = Boolean(
    videoBlob && !isCanvasMock && activeInTab && !creatingNew,
  );
  const previewAspect = kindTab === CLIP_KIND_FULL ? "aspect-video" : "aspect-[9/16]";
  const previewMax = kindTab === CLIP_KIND_FULL ? "max-w-md" : "max-w-[220px]";

  if (!trackReady || !audioReady) {
    return (
      <section class="animate-rise space-y-6">
        <header class="space-y-2">
          <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Clips vidéo</h2>
          <p class="max-w-xl text-base-content/70">
            Shorts 9:16 et vidéos complètes — plusieurs par projet.
          </p>
        </header>
        <div class="border border-warning/40 bg-warning/10 p-5">
          <p class="font-display text-lg font-semibold text-warning">
            {!trackReady ? "Aucun morceau créé" : "Morceau sans fichier audio"}
          </p>
          <button type="button" class="btn btn-primary mt-4 gap-2" onClick={onGoToTracks}>
            <AudioLines size={18} />
            Aller créer le morceau
          </button>
        </div>
      </section>
    );
  }

  return (
    <section class="animate-rise space-y-6">
      <header class="space-y-2">
        <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">Clips vidéo</h2>
        <p class="max-w-xl text-base-content/70">
          Plusieurs shorts (9:16) et vidéos complètes par projet. Génère via Veo, ou importe tes
          fichiers.
        </p>
      </header>

      <div role="tablist" class="tabs tabs-boxed w-fit bg-base-200">
        <button
          type="button"
          role="tab"
          class={`tab ${kindTab === CLIP_KIND_SHORT ? "tab-active" : ""}`}
          onClick={() => {
            setKindTab(CLIP_KIND_SHORT);
            setReplaceMode(false);
            const first = clipsOfKind(allClips, CLIP_KIND_SHORT)[0];
            if (first) onSelectClip?.(first.id);
          }}
        >
          Shorts ({clipsOfKind(allClips, CLIP_KIND_SHORT).length})
        </button>
        <button
          type="button"
          role="tab"
          class={`tab ${kindTab === CLIP_KIND_FULL ? "tab-active" : ""}`}
          onClick={() => {
            setKindTab(CLIP_KIND_FULL);
            setReplaceMode(false);
            const first = clipsOfKind(allClips, CLIP_KIND_FULL)[0];
            if (first) onSelectClip?.(first.id);
          }}
        >
          Fulls ({clipsOfKind(allClips, CLIP_KIND_FULL).length})
        </button>
      </div>

      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-3">
          <p class="text-sm font-medium">
            Galerie {kindTab === CLIP_KIND_FULL ? "fulls" : "shorts"}
          </p>
          <p class="text-xs text-base-content/55">
            Clique pour choisir la vidéo à diffuser · survol pour supprimer
          </p>
        </div>
        <ClipGallery
          clips={kindClips}
          activeClipId={creatingNew ? null : activeId}
          projectId={projectId}
          disabled={rendering}
          showNew
          newLabel={kindTab === CLIP_KIND_FULL ? "Nouveau full" : "Nouveau short"}
          selectLabel="À diffuser"
          emptyLabel={
            kindTab === CLIP_KIND_FULL
              ? "Aucun full — importe une vidéo"
              : "Aucun short — génère ou importe"
          }
          onSelect={(id) => {
            setReplaceMode(false);
            setCreatingNew(false);
            onSelectClip?.(id);
          }}
          onRemove={removeClip}
          onNew={() => {
            setReplaceMode(false);
            setCreatingNew(true);
            setVideoBlob(null);
            setVideoMeta(null);
            setVideoUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return null;
            });
            setError("");
          }}
        />
      </div>

      <div class="grid gap-2 border border-base-content/10 bg-base-200/40 p-3 text-sm sm:grid-cols-2">
        <p
          class={
            portraitDurable
              ? "text-success"
              : portraitExpired || !hasPortrait
                ? "text-warning"
                : "text-success"
          }
        >
          Portrait{" "}
          {portraitDurable
            ? "✓ durable"
            : portraitExpired
              ? "✗ URL expirée — régénère Artiste"
              : hasPortrait
                ? "✓"
                : "✗ requis pour Veo"}
        </p>
        <p class={coverExpired ? "text-warning" : hasCover ? "text-success" : "text-base-content/50"}>
          Jaquette {coverExpired ? "✗ URL expirée" : hasCover ? "✓" : "· optionnelle"}
        </p>
      </div>

      {(portraitExpired ||
        (!portraitDurable && hasPortrait && /^https?:/i.test(artist?.imageUrl || ""))) && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm space-y-2">
          <p class="font-medium text-warning">Portrait non durable (URL temporaire).</p>
          <button type="button" class="btn btn-warning btn-sm" onClick={onGoToArtist}>
            Régénérer le portrait
          </button>
        </div>
      )}

      {coverExpired && !portraitExpired && (
        <div class="border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
          <p class="font-medium text-warning">Jaquette : lien temporaire expiré</p>
          <button type="button" class="btn btn-ghost btn-sm" onClick={onGoToCover}>
            Régénérer la jaquette
          </button>
        </div>
      )}

      <div class="flex flex-wrap gap-3">
        {kindTab === CLIP_KIND_SHORT && (
          <>
            <div class="flex w-full flex-wrap items-center gap-2 text-sm">
              <span class="text-base-content/60">Moteur vidéo :</span>
              <label class="label cursor-pointer gap-2 py-0">
                <input
                  type="radio"
                  name="clip-engine"
                  class="radio radio-sm radio-primary"
                  checked={clipEngine === "veo"}
                  onChange={() => setClipEngine("veo")}
                  disabled={rendering}
                />
                <span>Veo (Gemini)</span>
              </label>
              <label class="label cursor-pointer gap-2 py-0">
                <input
                  type="radio"
                  name="clip-engine"
                  class="radio radio-sm"
                  checked={clipEngine === "seedance"}
                  onChange={() => setClipEngine("seedance")}
                  disabled={rendering}
                />
                <span>Seedance (Replicate)</span>
              </label>
              <label class="label cursor-pointer gap-2 py-0">
                <input
                  type="radio"
                  name="clip-engine"
                  class="radio radio-sm"
                  checked={clipEngine === "wan2gp"}
                  onChange={() => setClipEngine("wan2gp")}
                  disabled={rendering}
                />
                <span>Wan2GP (local GPU)</span>
              </label>
            </div>
            <button
              class="btn btn-outline gap-2"
              disabled={loading || rendering}
              onClick={onGeneratePack}
            >
              {loading ? <span class="loading loading-spinner loading-sm" /> : <Clapperboard size={18} />}
              {loading ? "Script…" : "1. Pack scènes"}
            </button>
            <button
              class="btn btn-primary gap-2"
              disabled={!social || rendering || !hasPortrait || portraitExpired}
              onClick={generateVeoClip}
            >
              {rendering ? <span class="loading loading-spinner loading-sm" /> : <Sparkles size={18} />}
              {rendering
                ? `Short ${progress}%…`
                : replaceMode
                  ? `Remplacer short (${
                      clipEngine === "wan2gp"
                        ? "Wan2GP"
                        : clipEngine === "seedance"
                          ? "Seedance"
                          : "Veo"
                    } ~${PROMO_SHORT_SECONDS}s)`
                  : `2. Short ${
                      clipEngine === "wan2gp"
                        ? "Wan2GP"
                        : clipEngine === "seedance"
                          ? "Seedance"
                          : "Veo"
                    } (~${PROMO_SHORT_SECONDS}s)`}
            </button>
          </>
        )}

        <label class={`btn btn-secondary gap-2 ${rendering ? "btn-disabled" : "cursor-pointer"}`}>
          <Upload size={18} />
          {replaceMode && activeInTab
            ? "Remplacer par fichier"
            : kindTab === CLIP_KIND_FULL
              ? "Importer un full"
              : "Importer un short"}
          <input
            type="file"
            accept="video/*,.mp4,.webm,.mov,.m4v"
            class="hidden"
            disabled={rendering}
            onChange={importUserVideo}
          />
        </label>

        {activeInTab && (
          <>
            <button
              type="button"
              class={`btn gap-2 ${replaceMode ? "btn-warning" : "btn-ghost"}`}
              disabled={rendering}
              onClick={() => setReplaceMode((v) => !v)}
            >
              <RefreshCw size={16} />
              {replaceMode ? "Remplacement ON" : "Mode remplacer"}
            </button>
            <button
              type="button"
              class="btn btn-ghost text-error gap-2"
              disabled={rendering}
              onClick={removeActive}
            >
              <Trash2 size={16} /> Supprimer
            </button>
          </>
        )}

        <button class="btn btn-ghost gap-2" disabled={!videoBlob || rendering} onClick={exportOnly}>
          <Film size={18} /> Export fichier
        </button>
        {hasPublishableClip && (
          <button type="button" class="btn btn-secondary gap-2" onClick={onGoToSocial}>
            Diffuser <ChevronRight size={16} />
          </button>
        )}
      </div>

      {replaceMode && activeInTab && (
        <p class="text-xs text-warning">
          Mode remplacer : la prochaine génération / import écrase « {clipLabel(activeClip, 0)} ».
        </p>
      )}

      {kindTab === CLIP_KIND_SHORT && (
        <p class="text-xs text-base-content/55">
          Pipeline éco : Veo 1×base + 1×extend, brief audio réutilisé entre essais.
          Seedance (Replicate) reste optionnel (~$1–2). Pas de lip-sync : cutaways /
          silhouettes.
        </p>
      )}

      {(!track?.audioUrl || track?.audioEphemeral || track?.assetMissingReason) && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm space-y-1">
          <p class="font-medium text-warning">
            {!track?.audioUrl
              ? "Morceau audio manquant ou perdu"
              : "Audio temporaire / à risque"}
          </p>
          <p class="text-base-content/70">
            Les liens Replicate expirent (~1 h). Va à l’étape 4 → régénère MiniMax ou importe un
            fichier mp3 (sauvé sur S3).
          </p>
          {onGoToTracks ? (
            <button type="button" class="btn btn-warning btn-sm mt-2" onClick={onGoToTracks}>
              Réparer le morceau
            </button>
          ) : null}
        </div>
      )}

      {kindTab === CLIP_KIND_FULL && (
        <p class="text-sm text-base-content/60">
          Les fulls sont importés (fichier). Veo reste réservé aux shorts ~{PROMO_SHORT_SECONDS}s.
        </p>
      )}

      {isCanvasMock && activeInTab && (
        <div class="border border-warning/40 bg-warning/10 p-4 text-sm">
          <p class="font-medium text-warning">Maquette locale — pas un vrai short Veo.</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-primary btn-sm gap-2"
              disabled={rendering || !social || !hasPortrait}
              onClick={() => {
                setReplaceMode(true);
                generateVeoClip();
              }}
            >
              <Sparkles size={16} /> Remplacer par Veo
            </button>
          </div>
        </div>
      )}

      {isUserUpload && activeInTab && (
        <div class="border border-base-content/10 bg-base-200/40 p-3 text-sm text-base-content/70">
          Clip importé{videoMeta?.fileName ? ` · ${videoMeta.fileName}` : ""}.
        </div>
      )}

      {error && (
        <div class="border border-error/40 bg-error/10 p-4 text-sm text-error space-y-2">
          <p>{error}</p>
          {kindTab === CLIP_KIND_SHORT && (
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              disabled={rendering || !social}
              onClick={renderWithCanvas}
            >
              Utiliser maquette locale (secours)
            </button>
          )}
        </div>
      )}

      {(rendering || statusMsg) && (
        <div class="space-y-1">
          <p class="text-xs text-base-content/50">
            {statusMsg ||
              (kindTab === CLIP_KIND_SHORT
                ? "Pipeline : Veo → 1 extension (~2–5 min)…"
                : "Import en cours…")}
          </p>
          {rendering && (
            <div class="h-1.5 overflow-hidden rounded-full bg-base-300">
              <div
                class="h-full bg-primary transition-all"
                style={{ width: `${Math.max(progress, 8)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {videoMeta && activeInTab && !creatingNew && (
        <p class="text-xs text-base-content/55">
          {videoMeta.kind === CLIP_KIND_FULL ? "Full" : "Short"} · {videoMeta.provider}
          {videoMeta.durationSec ? ` · ${videoMeta.durationSec}s` : ""}
          {videoMeta.warning ? ` — ${videoMeta.warning}` : ""}
        </p>
      )}

      <div class="animate-rise grid gap-6 border-t border-base-content/10 pt-5 md:grid-cols-[minmax(220px,1fr)_1fr]">
        <div class="space-y-3">
          {videoUrl && activeInTab && !creatingNew ? (
            <div
              class={`relative mx-auto ${previewAspect} w-full ${previewMax} overflow-hidden rounded-xl bg-base-300 shadow-xl`}
            >
              <video
                key={videoUrl}
                class="absolute inset-0 h-full w-full object-cover"
                src={videoUrl}
                controls
                playsInline
                muted={!videoMeta?.muxed}
                loop
                preload="metadata"
              />
            </div>
          ) : (
            <div
              class={`relative mx-auto flex ${previewAspect} w-full ${previewMax} items-center justify-center overflow-hidden rounded-xl bg-base-300 shadow-xl`}
            >
              <p class="px-4 text-center text-xs text-base-content/55">
                {rendering
                  ? "Traitement…"
                  : kindTab === CLIP_KIND_FULL
                    ? "Aucun full — importe une vidéo"
                    : "Aucun short — lance Veo ou importe"}
              </p>
            </div>
          )}
          {videoUrl && activeInTab && !creatingNew && (
            <a class="btn btn-secondary btn-sm w-full gap-1" href={videoUrl} download>
              <Download size={14} /> Télécharger
            </a>
          )}
        </div>

        <div class="space-y-3">
          {kindTab === CLIP_KIND_SHORT ? (
            social ? (
              <>
                <p class="text-sm font-medium">Scènes du short</p>
                <ol class="list-decimal space-y-1 pl-5 text-sm text-base-content/75">
                  {(social.scenes || []).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {social.hook && <p class="text-sm text-primary">Hook : {social.hook}</p>}
              </>
            ) : (
              <p class="text-sm text-base-content/55">
                Commence par le pack scènes, puis lance Veo — ou importe directement.
              </p>
            )
          ) : (
            <p class="text-sm text-base-content/55">
              Vidéo complète du morceau (clip long). Idéal pour YouTube / archives ; TikTok préfère
              un short 9:16.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
