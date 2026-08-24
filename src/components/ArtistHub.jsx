import { useEffect, useState } from "preact/hooks";
import {
  AudioLines,
  BarChart3,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  Library,
  Music2,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import ArtistAlbumSection from "./ArtistAlbumSection.jsx";
import AlbumCreationModal from "./AlbumCreationModal.jsx";
import TrackCreationModal from "./TrackCreationModal.jsx";
import TrackReviewPanel from "./TrackReviewPanel.jsx";
import { api } from "../lib/apiClient.js";
import { loadKeys } from "../lib/keys.js";
import { listArtistImageUrl } from "../lib/artistPhotos.js";
import { confirmDeleteProject, languageLabel, studioHref, artistEditHref, uniqueGenreLabels } from "../lib/studio.js";
import { organizeArtistReleases } from "../lib/albumTracks.js";
import { playTracks } from "../lib/playEngine.js";
import {
  currentPlayTrack,
  readPlaySession,
  subscribePlaySession,
} from "../lib/playSession.js";

const TABS = [
  { id: "titres", label: "Catalogue", icon: Music2 },
  { id: "album", label: "Album", icon: Library },
  { id: "revue", label: "Revue", icon: RefreshCw },
  { id: "coach", label: "Coach", icon: Sparkles },
  { id: "style", label: "Style", icon: Palette },
  { id: "chiffres", label: "Chiffres", icon: BarChart3 },
];

const VERDICT_LABEL = {
  produce: "Nouveau titre",
  wait: "On laisse mûrir",
  promote: "On pousse le clip",
  pivot: "On recale le son",
  publish: "Prêt pour les stores",
};

function verdictClass(verdict) {
  if (verdict === "produce") return "badge-success";
  if (verdict === "wait") return "badge-warning";
  if (verdict === "promote") return "badge-info";
  if (verdict === "pivot") return "badge-error";
  if (verdict === "publish") return "badge-primary";
  return "badge-ghost";
}

function formatStreams(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("fr-FR");
}

function formatPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(1)} %`;
}

function releasePhase(release, delivery) {
  const live = /live|distributed|delivered/i.test(
    delivery?.spotifyStatus || delivery?.aggregateStatus || "",
  );
  if (delivery?.spotifyUrl || live) {
    return { label: "En store", cls: "bg-success/15 text-success" };
  }
  if (delivery?.publishing?.canSubmitUnison) {
    return { label: "Prêt Unison", cls: "bg-primary/15 text-primary" };
  }
  if (release.releaseId || /submit|inspect|pending/i.test(release.onceStatus || "")) {
    return { label: "Chez ONCE", cls: "bg-warning/15 text-warning" };
  }
  if (release.hasAudio) {
    return { label: "Audio prêt", cls: "bg-info/15 text-info" };
  }
  return { label: "Brouillon", cls: "bg-base-content/10 text-base-content/55" };
}

function toPlayTracks(list, extras = {}) {
  return (list || [])
    .filter((r) => r.audioUrl || r.audioS3Key)
    .map((r) => ({
      id: r.id,
      trackTitle: r.trackTitle || r.title,
      artistName: extras.artistName || r.artistName,
      audioUrl: r.audioUrl,
      audioS3Key: r.audioS3Key,
      coverUrl: r.coverUrl || extras.coverUrl,
      artistImage: extras.artistImage,
      slug: extras.slug || r.slug,
    }));
}

function CatalogTrackCard({
  release: r,
  slug,
  delivery,
  streams,
  phase,
  busy,
  onDelete,
  index = null,
  queue = null,
  playMeta = {},
  nowPlayingId = null,
  playing = false,
}) {
  const playable = Boolean(r.audioUrl || r.audioS3Key);
  const isCurrent = nowPlayingId === r.id;
  const showPause = isCurrent && playing;

  function onPlayCover() {
    if (!playable) return;
    playTracks(queue || toPlayTracks([r], { ...playMeta, slug }), r.id);
  }

  return (
    <li
      class={`group flex gap-3 rounded-2xl border bg-base-300/40 p-3 transition hover:border-primary/35 hover:bg-base-300/70 ${
        isCurrent ? "border-primary/50" : "border-base-content/10"
      }`}
    >
      {playable ? (
        <button
          type="button"
          class="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-base-300 sm:h-20 sm:w-20"
          aria-label={showPause ? "Pause" : "Lire dans le lecteur"}
          onClick={onPlayCover}
        >
          {r.coverUrl ? (
            <img src={r.coverUrl} alt="" class="h-full w-full object-cover" />
          ) : (
            <div class="flex h-full items-center justify-center">
              <Music2 size={18} class="opacity-35" />
            </div>
          )}
          <span
            class={`absolute inset-0 flex items-center justify-center bg-black/35 transition ${
              isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {showPause ? (
              <Pause size={16} fill="currentColor" class="text-white" />
            ) : (
              <Play size={16} fill="currentColor" class="text-white" />
            )}
          </span>
        </button>
      ) : (
        <a
          href={studioHref(r.id, "lyrics")}
          class="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-base-300 sm:h-20 sm:w-20"
        >
          {r.coverUrl ? (
            <img src={r.coverUrl} alt="" class="h-full w-full object-cover" />
          ) : (
            <div class="flex h-full items-center justify-center">
              <Music2 size={18} class="opacity-35" />
            </div>
          )}
        </a>
      )}
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">
          {index != null ? (
            <span class="mr-1.5 tabular-nums text-base-content/40">{index}.</span>
          ) : null}
          {r.trackTitle || r.title}
        </p>
        <div class="mt-1 flex flex-wrap items-center gap-1.5">
          <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${phase.cls}`}>
            {phase.label}
          </span>
          {streams?.totalStreams != null && !streams.error && (
            <span class="text-[11px] text-base-content/45">
              {formatStreams(streams.totalStreams)} écoutes
            </span>
          )}
        </div>
        <div class="mt-2 flex flex-wrap gap-1">
          {delivery?.spotifyUrl && (
            <a
              class="btn btn-ghost btn-xs rounded-full"
              href={delivery.spotifyUrl}
              target="_blank"
              rel="noreferrer"
            >
              Spotify
            </a>
          )}
          {delivery?.dashboardUrl && (
            <a
              class="btn btn-ghost btn-xs rounded-full"
              href={delivery.dashboardUrl}
              target="_blank"
              rel="noreferrer"
            >
              ONCE
            </a>
          )}
          <a class="btn btn-ghost btn-xs rounded-full" href={studioHref(r.id, "lyrics")}>
            Ouvrir le morceau
          </a>
          <button
            type="button"
            class="btn btn-ghost btn-xs rounded-full text-error/80"
            disabled={busy}
            onClick={() => onDelete(r)}
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </li>
  );
}

function readHashState() {
  if (typeof window === "undefined") return { tab: "titres", albumId: "" };
  const hash = String(window.location.hash || "").replace(/^#/, "");
  if (hash.startsWith("album-")) {
    return { tab: "titres", albumId: hash.slice(6) };
  }
  return {
    tab: TABS.some((t) => t.id === hash) ? hash : "titres",
    albumId: "",
  };
}

function styleRowsFromProfile(profile = {}) {
  const lock = profile.styleLock || {};
  const genres = uniqueGenreLabels(
    [
      ...(Array.isArray(profile.genres) ? profile.genres : profile.genre ? [profile.genre] : []),
      lock.genreSummary,
    ],
    { limit: 6 },
  );
  const refs =
    Array.isArray(profile.styleArtists) && profile.styleArtists.length
      ? profile.styleArtists
      : Array.isArray(lock.refs)
        ? lock.refs.map((r) => r.matchedName).filter(Boolean)
        : profile.styleArtist
          ? [profile.styleArtist]
          : lock.matchedName
            ? [lock.matchedName]
            : [];
  const topTracks = Array.isArray(lock.topTracks) ? lock.topTracks.filter(Boolean) : [];
  const instruments = Array.isArray(lock.instruments) ? lock.instruments.filter(Boolean) : [];
  const influences = Array.isArray(profile.influences) ? profile.influences.filter(Boolean) : [];

  return {
    genres,
    refs,
    topTracks,
    instruments,
    influences,
    lock,
    language: profile.language,
    mood: profile.mood || lock.mood,
    voice: profile.voice || lock.vocalStyle,
    genreSummary: lock.genreSummary || genres.join(" · "),
    production: lock.production,
    mode: profile.mode,
  };
}

export default function ArtistHub({ slug }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [careerBusy, setCareerBusy] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [schedulePreview, setSchedulePreview] = useState(null);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [pendingTrackTheme, setPendingTrackTheme] = useState("");
  const initialHash = readHashState();
  const [tab, setTab] = useState(initialHash.tab);
  const [openAlbumId, setOpenAlbumId] = useState(initialHash.albumId);
  const [playSession, setPlaySession] = useState(() =>
    typeof window === "undefined" ? { queue: [], playing: false, index: 0 } : readPlaySession(),
  );
  const [showAlbumModal, setShowAlbumModal] = useState(false);

  useEffect(() => subscribePlaySession(setPlaySession), []);

  useEffect(() => {
    const onHash = () => {
      const next = readHashState();
      setTab(next.tab);
      setOpenAlbumId(next.albumId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function selectTab(id) {
    setTab(id);
    if (id !== "titres") setOpenAlbumId("");
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  }

  function selectAlbum(id) {
    const next = openAlbumId === id ? "" : id;
    setTab("titres");
    setOpenAlbumId(next);
    if (typeof history !== "undefined") {
      history.replaceState(null, "", next ? `#album-${next}` : "#titres");
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Artiste introuvable");
      setData(json.artist);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [slug]);

  async function refreshStats() {
    setBusy(true);
    setCareerBusy(true);
    setMsg("");
    setError("");
    try {
      const keys = loadKeys();
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh-stats", keys, advise: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Stats KO");
      setData((prev) =>
        prev
          ? {
              ...prev,
              stats: json.stats,
              career: json.career || prev.career,
            }
          : prev,
      );
      const unison = json.stats?.unisonReady || 0;
      setMsg(
        [
          json.onceSynced
            ? "Stats + statut ONCE / streams synchronisés"
            : "Stats catalogue OK — ajoute un token ONCE dans Réglages pour sync streams",
          json.career ? "· conseil carrière mis à jour" : "",
          unison > 0 ? `· ${unison} prêt(s) Unison` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setCareerBusy(false);
    }
  }

  function promptCreateTrack(themeOverride) {
    const themeValue = typeof themeOverride === "string" ? themeOverride.trim() : "";
    setPendingTrackTheme(themeValue);
    setShowTrackModal(true);
  }

  async function createTrack(themeOverride, options = {}) {
    setShowTrackModal(false);
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const themeValue =
        typeof themeOverride === "string" ? themeOverride.trim() : "";
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "new-track",
          theme: themeValue,
          genreOverride: options.genre,
          referencesOverride: options.references,
          referenceTrackOverride: options.referenceTrack,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Création impossible");
      window.location.href = json.studioUrl || studioHref(json.projectId, "lyrics");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function openStyleEditor() {
    window.location.href = artistEditHref(slug);
  }

  async function runCareerAdvice(force = false) {
    setCareerBusy(true);
    setError("");
    setMsg("");
    try {
      const keys = loadKeys();
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "career-advice", keys, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Agent carrière KO");
      setData((prev) =>
        prev
          ? {
              ...prev,
              career: json.career,
              stats: json.stats ? { ...prev.stats, ...json.stats } : prev.stats,
            }
          : prev,
      );
      setMsg(
        json.cached
          ? "Conseil carrière (cache < 6 h) — force pour recalculer"
          : json.career?.warning
            ? `Conseil prêt (heuristiques) — ${json.career.warning}`
            : "Agent carrière : recommandation à jour",
      );
      await loadSchedulePreview();
    } catch (e) {
      setError(e.message);
    } finally {
      setCareerBusy(false);
    }
  }

  async function loadSchedulePreview() {
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "schedule-preview" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setSchedulePreview(json.preview || null);
    } catch {
      /* ignore */
    }
  }

  async function runSchedulePromo() {
    setScheduleBusy(true);
    setError("");
    setMsg("");
    try {
      const keys = loadKeys();
      if (
        !keys.tiktokAccessToken?.trim() &&
        !keys.youtubeAccessToken?.trim() &&
        !keys.youtubeRefreshToken?.trim() &&
        !keys.socialWebhookUrl?.trim()
      ) {
        throw new Error("Configure TikTok, YouTube et/ou un webhook social dans Paramètres.");
      }
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-schedule", keys }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Exécution agenda KO");
      if (json.tiktokTokens || json.youtubeTokens) {
        const { saveKeysAsync, loadKeys: loadKeysNow } = await import("../lib/keys.js");
        await saveKeysAsync({
          ...loadKeysNow(),
          ...(json.tiktokTokens || {}),
          ...(json.youtubeTokens || {}),
        });
      }
      if (json.career) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                career: json.career,
                stats: prev.stats ? { ...prev.stats, career: json.career } : prev.stats,
              }
            : prev,
        );
      }
      if (json.skipped && !json.ok) {
        setMsg(json.message || (json.blockers || []).join(" · ") || "Rien à publier");
      } else if (json.ok) {
        setMsg(`Promo agenda : ${json.status} — clip poussé TikTok / YouTube / webhook`);
      } else {
        setError(json.message || `Publication ${json.status || "échouée"}`);
      }
      await loadSchedulePreview();
    } catch (e) {
      setError(e.message);
    } finally {
      setScheduleBusy(false);
    }
  }

  async function deleteRelease(release) {
    const label = release?.trackTitle || release?.title || release?.id || "ce morceau";
    if (
      !confirmDeleteProject(label, {
        status: release?.onceStatus,
        onceStatus: release?.onceStatus,
        provider: release?.distributed ? "once" : undefined,
        releaseId: release?.releaseId,
        distributed: Boolean(release?.distributed),
      })
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      await api.deleteProject(release.id);
      setData((prev) =>
        prev
          ? {
              ...prev,
              releases: (prev.releases || []).filter((r) => r.id !== release.id),
              stats: prev.stats
                ? {
                    ...prev.stats,
                    tracks: Math.max(0, (prev.stats.tracks ?? 1) - 1),
                    withAudio: release.hasAudio
                      ? Math.max(0, (prev.stats.withAudio ?? 1) - 1)
                      : prev.stats.withAudio,
                  }
                : prev.stats,
            }
          : prev,
      );
      setMsg(`« ${label} » supprimé`);
    } catch (e) {
      setError(e.message || "Suppression impossible");
    } finally {
      setBusy(false);
    }
  }

  async function regenerateTrack(track, options = {}) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "regenerate-track",
          projectId: track.id,
          genreOverride: options.genre,
          referencesOverride: options.references,
          referenceTrackOverride: options.referenceTrack,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Régénération impossible");
      setMsg(`Régénération de « ${track.trackTitle || track.title} » lancée — ouvre le Studio pour suivre.`);
      window.location.href = json.studioUrl || studioHref(track.id, "tracks");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (data?.career) loadSchedulePreview();
  }, [data?.career?.updatedAt, slug]);

  const profile = data?.profile || {};
  const stats = data?.stats || {};
  const career = data?.career || stats.career || null;
  const releases = data?.releases || [];
  const albumsData = data?.albums || [];
  const { albums, singles } = organizeArtistReleases(releases, albumsData);
  const canCreateAlbum = releases.some(
    (r) => r.hasAudio && r.hasLyrics && !r.albumStatus && !r.albumLeadId,
  );
  const streams = stats.streams || {};
  const deliveryMap = stats.delivery || {};
  const releaseStreamsMap = stats.releaseStreams || {};
  const style = styleRowsFromProfile(profile);
  const links = stats.links || {
    once: "https://once.app/",
    spotifyForArtists: "https://artists.spotify.com/",
  };
  const changeLabel = formatPct(streams.periodChangePct);
  const today = new Date().toISOString().slice(0, 10);
  const dueToday = Array.isArray(career?.schedule)
    ? career.schedule.filter(
        (item) =>
          item.status !== "done" &&
          (item.date === today || item.status === "active"),
      )
    : [];
  const recentRuns = Array.isArray(career?.scheduleRuns)
    ? career.scheduleRuns.slice(0, 5)
    : [];
  const portrait = profile.imageUrl || listArtistImageUrl(data?.slug, profile);
  const playMeta = {
    artistName: data?.name,
    artistImage: portrait,
    slug: data?.slug,
  };
  const artistQueue = toPlayTracks(
    [...albums.flatMap((a) => a.tracks), ...singles],
    playMeta,
  );
  const hasPlayable = artistQueue.length > 0;
  const nowPlaying = currentPlayTrack(playSession);
  const nowPlayingId = nowPlaying?.id || null;
  const playing = Boolean(playSession.playing);
  const unisonHref =
    career?.releaseFocus?.dashboardUrl ||
    career?.actions?.find((a) => a.href)?.href ||
    null;
  const nextMove = !data
    ? null
    : !releases.length
      ? {
          kicker: "Premier pas",
          title: "Créer le premier titre",
          text: "On ouvre le Studio pour les paroles et l’audio — le style reste celui de cette fiche.",
          cta: "Nouveau titre",
          onClick: () => promptCreateTrack(),
        }
      : dueToday.some((i) => i.type === "promote") && schedulePreview?.canRun
        ? {
            kicker: "Promo du jour",
            title: "Le clip peut partir",
            text: "Un clic pour pousser TikTok, YouTube ou le webhook.",
            cta: "Publier la promo",
            onClick: runSchedulePromo,
          }
        : career?.verdict === "produce" && career.nextSingle?.theme
          ? {
              kicker: "Le coach",
              title: career.nextSingle.titleHint || "Nouveau single",
              text: career.nextSingle.theme,
              cta: "Nouveau titre",
              onClick: () => promptCreateTrack(career.nextSingle.theme),
            }
          : career?.verdict === "publish" && unisonHref
            ? {
                kicker: "Stores",
                title: "Un titre est prêt à sortir",
                text: career.summary || "Envoie-le vers Unison depuis ONCE.",
                cta: "Ouvrir ONCE",
                href: unisonHref,
              }
            : null;

  return (
    <AppShell active="artistes">
      <div class="mx-auto w-full max-w-5xl space-y-6">
        <a
          href="/artistes"
          class="inline-flex items-center gap-1 text-sm text-base-content/55 transition hover:text-primary"
        >
          ← Tous les artistes
        </a>

        {loading && (
          <div class="animate-pulse overflow-hidden rounded-3xl border border-base-content/10 bg-base-300/40">
            <div class="grid md:grid-cols-[260px_1fr]">
              <div class="aspect-square bg-base-300" />
              <div class="space-y-3 p-8">
                <div class="h-4 w-24 rounded-full bg-base-300" />
                <div class="h-10 w-64 rounded-lg bg-base-300" />
                <div class="h-4 w-full max-w-md rounded bg-base-300" />
              </div>
            </div>
          </div>
        )}
        {error && (
          <div class="rounded-2xl border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}
        {msg && <p class="text-sm text-success">{msg}</p>}

        {data && (
          <div class="space-y-6 animate-rise">
            <header class="overflow-hidden rounded-3xl border border-base-content/10 bg-base-300/35 shadow-2xl shadow-black/20">
              <div class="grid md:grid-cols-[minmax(220px,280px)_1fr]">
                <figure class="relative aspect-square bg-base-300">
                  {portrait ? (
                    <img src={portrait} alt="" class="h-full w-full object-cover" />
                  ) : (
                    <div class="flex h-full items-center justify-center">
                      <UserRound size={48} class="opacity-30" />
                    </div>
                  )}
                  <div class="pointer-events-none absolute inset-0 bg-gradient-to-t from-base-200/80 via-transparent to-transparent md:hidden" />
                </figure>
                <div class="flex flex-col justify-end gap-4 p-5 sm:p-7">
                  <div class="flex flex-wrap gap-1.5">
                    {style.genres.slice(0, 4).map((g) => (
                      <span
                        key={g}
                        class="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] text-primary"
                      >
                        {g}
                      </span>
                    ))}
                    {style.language && (
                      <span class="rounded-full border border-base-content/12 bg-base-content/5 px-2.5 py-0.5 text-[11px] text-base-content/65">
                        {languageLabel(style.language)}
                      </span>
                    )}
                    {profile.city && (
                      <span class="rounded-full border border-base-content/12 bg-base-content/5 px-2.5 py-0.5 text-[11px] text-base-content/65">
                        {profile.city}
                      </span>
                    )}
                    {style.mode === "self" && (
                      <span class="rounded-full border border-secondary/30 bg-secondary/10 px-2.5 py-0.5 text-[11px] text-secondary">
                        C’est toi
                      </span>
                    )}
                  </div>
                  <div>
                    <h1 class="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
                      {data.name}
                    </h1>
                    {profile.aka && (
                      <p class="mt-1 text-base text-base-content/55">{profile.aka}</p>
                    )}
                  </div>
                  <p class="line-clamp-3 max-w-xl text-sm leading-relaxed text-base-content/70">
                    {profile.bio || "Artiste créé dans SONOZZ — catalogue, clips et sortie stores."}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    {hasPlayable && (
                      <button
                        type="button"
                        class="btn btn-primary gap-2 rounded-full"
                        onClick={() =>
                          playTracks(
                            artistQueue,
                            artistQueue.some((t) => t.id === nowPlayingId)
                              ? nowPlayingId
                              : null,
                          )
                        }
                      >
                        {nowPlayingId &&
                        artistQueue.some((t) => t.id === nowPlayingId) &&
                        playing ? (
                          <Pause size={16} fill="currentColor" />
                        ) : (
                          <Play size={16} fill="currentColor" />
                        )}
                        Écouter
                      </button>
                    )}
                    <button
                      type="button"
                      class={`btn gap-2 rounded-full ${hasPlayable ? "btn-ghost border border-base-content/15" : "btn-primary"}`}
                      disabled={busy}
                      onClick={() => promptCreateTrack()}
                    >
                      {busy ? (
                        <span class="loading loading-spinner loading-sm" />
                      ) : (
                        <Plus size={16} />
                      )}
                      Nouveau titre
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost rounded-full border border-base-content/15 gap-2"
                      onClick={() => selectTab("album")}
                    >
                      <Library size={16} /> Créer un album
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost rounded-full border border-base-content/15 gap-2"
                      disabled={busy}
                      onClick={openStyleEditor}
                    >
                      <Pencil size={14} /> Modifier le profil
                    </button>
                  </div>
                </div>
              </div>
            </header>

            {nextMove && (
              <div class="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/20 via-accent/10 to-secondary/15 p-5 sm:p-6">
                <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                  {nextMove.kicker}
                </p>
                <p class="font-display mt-1 text-2xl font-bold">{nextMove.title}</p>
                <p class="mt-1 max-w-xl text-sm text-base-content/70">{nextMove.text}</p>
                <div class="mt-4">
                  {nextMove.href ? (
                    <a
                      class="btn btn-primary btn-sm gap-1 rounded-full"
                      href={nextMove.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {nextMove.cta} <ExternalLink size={12} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      class="btn btn-primary btn-sm gap-1 rounded-full"
                      disabled={busy || scheduleBusy}
                      onClick={nextMove.onClick}
                    >
                      {(busy || scheduleBusy) && (
                        <span class="loading loading-spinner loading-xs" />
                      )}
                      {nextMove.cta}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div
              class="flex gap-1 overflow-x-auto rounded-full border border-base-content/10 bg-base-300/50 p-1"
              role="tablist"
              aria-label="Sections de la fiche"
            >
              {TABS.map((t) => {
                const Icon = t.icon;
                const on = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    class={`flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-2 text-sm transition ${
                      on
                        ? "bg-primary font-semibold text-primary-content shadow-md shadow-black/20"
                        : "text-base-content/55 hover:text-base-content"
                    }`}
                    onClick={() => selectTab(t.id)}
                  >
                    <Icon size={14} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {tab === "titres" && (
              <div class="space-y-8">
                <section class="space-y-4">
                  <div class="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 class="font-display text-2xl font-bold">Le catalogue</h2>
                      <p class="text-sm text-base-content/55">
                        {releases.length
                          ? `${albums.length ? `${albums.length} album${albums.length > 1 ? "s" : ""}` : ""}${
                              albums.length && singles.length ? " · " : ""
                            }${singles.length ? `${singles.length} single${singles.length > 1 ? "s" : ""}` : ""}`
                          : "Rien pour l’instant. Un titre s’écrit dans le Studio ; un album se lance ici, après un single audio."}
                      </p>
                    </div>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm gap-1 rounded-full"
                      disabled={busy}
                      onClick={() => promptCreateTrack()}
                    >
                      <Plus size={14} /> Nouveau titre
                    </button>
                  </div>

                  {releases.length === 0 ? (
                    <button
                      type="button"
                      class="flex w-full flex-col items-center gap-3 rounded-3xl border border-dashed border-primary/35 bg-primary/5 px-6 py-14 text-center transition hover:border-primary/60 hover:bg-primary/10"
                      disabled={busy}
                      onClick={() => promptCreateTrack()}
                    >
                      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 text-primary">
                        <AudioLines size={26} />
                      </span>
                      <span class="font-display text-xl font-bold">Créer le premier titre</span>
                      <span class="max-w-sm text-sm text-base-content/55">
                        Ouvre le Studio (paroles, puis audio). L’album se crée ensuite dans l’onglet Album.
                      </span>
                    </button>
                  ) : (
                    <div class="space-y-8">
                      {albums.length > 0 && (
                        <div class="space-y-3">
                          <h3 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-base-content/45">
                            <Library size={14} /> Albums
                          </h3>
                          <ul class="space-y-3">
                            {albums.map((album) => {
                              const open = openAlbumId === album.id;
                              const firstPlayable = album.tracks.find(
                                (t) => t.audioUrl || t.audioS3Key,
                              );
                              return (
                                <li
                                  key={album.id}
                                  class="overflow-hidden rounded-3xl border border-base-content/10 bg-base-300/40"
                                >
                                  <div class="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                                    <button
                                      type="button"
                                      class="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-base-300"
                                      onClick={() => selectAlbum(album.id)}
                                    >
                                      {album.coverUrl ? (
                                        <img
                                          src={album.coverUrl}
                                          alt=""
                                          class="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div class="flex h-full items-center justify-center">
                                          <Library size={22} class="opacity-35" />
                                        </div>
                                      )}
                                    </button>
                                    <div class="min-w-0 flex-1">
                                      <p class="font-display text-lg font-bold">{album.title}</p>
                                      <p class="text-xs text-base-content/55">
                                        {album.tracks.length} titre
                                        {album.tracks.length > 1 ? "s" : ""}
                                        {album.status ? ` · ${album.status}` : ""}
                                      </p>
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                      {firstPlayable && (
                                        <button
                                          type="button"
                                          class="btn btn-primary btn-sm gap-1 rounded-full"
                                          onClick={() =>
                                            playTracks(
                                              toPlayTracks(album.tracks, playMeta),
                                              firstPlayable.id,
                                            )
                                          }
                                        >
                                          <Play size={12} fill="currentColor" /> Écouter
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        class="btn btn-ghost btn-sm gap-1 rounded-full border border-base-content/15"
                                        onClick={() => selectAlbum(album.id)}
                                      >
                                        <ChevronDown
                                          size={14}
                                          class={`transition ${open ? "rotate-180" : ""}`}
                                        />
                                        {open ? "Fermer" : "Gérer"}
                                      </button>
                                    </div>
                                  </div>
                                  {open && (
                                    <div class="space-y-4 border-t border-base-content/10 p-3 sm:p-4">
                                      <ul class="space-y-2">
                                        {album.tracks.map((r, i) => {
                                          const delivery = r.releaseId
                                            ? deliveryMap[r.releaseId] ||
                                              stats.releases?.find((x) => x.id === r.id)
                                                ?.delivery
                                            : null;
                                          const rStreams = r.releaseId
                                            ? releaseStreamsMap[r.releaseId] ||
                                              stats.releases?.find((x) => x.id === r.id)?.streams
                                            : null;
                                          return (
                                            <CatalogTrackCard
                                              key={r.id}
                                              release={r}
                                              slug={data.slug}
                                              delivery={delivery}
                                              streams={rStreams}
                                              phase={releasePhase(r, delivery)}
                                              busy={busy}
                                              onDelete={deleteRelease}
                                              index={r.albumIndex || i + 1}
                                              queue={toPlayTracks(album.tracks, playMeta)}
                                              playMeta={playMeta}
                                              nowPlayingId={nowPlayingId}
                                              playing={playing}
                                            />
                                          );
                                        })}
                                      </ul>
                                      <ArtistAlbumSection
                                        slug={data.slug}
                                        releases={releases}
                                        pinnedLeadId={album.lead?.id || album.id}
                                        embedded
                                      />
                                    </div>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {singles.length > 0 && (
                        <div class="space-y-3">
                          <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/45">
                            Singles
                          </h3>
                          <ul class="grid gap-3 sm:grid-cols-2">
                            {singles.map((r) => {
                              const delivery = r.releaseId
                                ? deliveryMap[r.releaseId] ||
                                  stats.releases?.find((x) => x.id === r.id)?.delivery
                                : null;
                              const rStreams = r.releaseId
                                ? releaseStreamsMap[r.releaseId] ||
                                  stats.releases?.find((x) => x.id === r.id)?.streams
                                : null;
                              return (
                                <CatalogTrackCard
                                  key={r.id}
                                  release={r}
                                  slug={data.slug}
                                  delivery={delivery}
                                  streams={rStreams}
                                  phase={releasePhase(r, delivery)}
                                  busy={busy}
                                  onDelete={deleteRelease}
                                  queue={toPlayTracks(singles, playMeta)}
                                  playMeta={playMeta}
                                  nowPlayingId={nowPlayingId}
                                  playing={playing}
                                />
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}

            {tab === "album" && (
              <section class="space-y-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h2 class="font-display text-2xl font-bold">Albums</h2>
                    <p class="text-sm text-base-content/55">
                      Crée plusieurs albums indépendants. Chaque album part d'un single (paroles + audio).
                    </p>
                  </div>
                  {canCreateAlbum && (
                    <button
                      type="button"
                      class="btn btn-primary btn-sm gap-1 rounded-full"
                      onClick={() => setShowAlbumModal(true)}
                      disabled={busy}
                    >
                      <Plus size={14} /> Nouvel album
                    </button>
                  )}
                </div>

                {albums.length > 0 ? (
                  <div class="space-y-4">
                    {albums.map((album) => (
                      <div key={album.id} class="rounded-3xl border border-base-content/10 bg-base-300/30 p-5">
                        <div class="mb-3 flex items-start justify-between">
                          <div>
                            <h3 class="font-display text-lg font-bold">{album.title}</h3>
                            <p class="text-xs text-base-content/55">
                              {album.tracks?.length || 0} titre{album.tracks?.length > 1 ? "s" : ""} · {album.status}
                            </p>
                          </div>
                        </div>
                        <ArtistAlbumSection
                          slug={data.slug}
                          releases={releases}
                          pinnedLeadId={album.lead?.id}
                          embedded
                        />
                      </div>
                    ))}
                  </div>
                ) : canCreateAlbum ? (
                  <div class="rounded-3xl border border-dashed border-base-content/15 bg-base-300/20 px-5 py-8 text-center">
                    <p class="text-sm text-base-content/60">
                      Tu n'as pas encore créé d'album. Clique sur « Nouvel album » pour commencer.
                    </p>
                  </div>
                ) : (
                  <div class="rounded-3xl border border-dashed border-base-content/15 bg-base-300/20 px-5 py-8 text-center">
                    <p class="text-sm text-base-content/60">
                      Il faut d'abord un single avec paroles et audio. L'album part de ce titre.
                    </p>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm mt-4 gap-1 rounded-full"
                      disabled={busy}
                      onClick={() => promptCreateTrack()}
                    >
                      <Plus size={14} /> Nouveau titre
                    </button>
                  </div>
                )}
              </section>
            )}

            {tab === "revue" && (
              <section class="space-y-4">
                <div>
                  <h2 class="font-display text-2xl font-bold">Revue des morceaux</h2>
                  <p class="text-sm text-base-content/55">
                    Écoute tes titres, note-les et régénère ceux qui ne te conviennent pas. Les versions précédentes sont conservées.
                  </p>
                </div>
                <TrackReviewPanel
                  tracks={releases.filter((r) => r.hasAudio || r.hasLyrics)}
                  onPlayTrack={(track) => playTracks(toPlayTracks([track], playMeta), track.id)}
                  onRegenerateTrack={regenerateTrack}
                  nowPlayingId={nowPlayingId}
                  playing={playing}
                  busy={busy}
                  currentGenre={style.genres[0] || profile.genre || ""}
                  currentReferences={style.refs || []}
                  currentReferenceTrack={style.topTracks?.[0] || style.lock?.topTracks?.[0] || ""}
                />
              </section>
            )}

            {tab === "coach" && (
              <section class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 class="font-display text-2xl font-bold">Coach carrière</h2>
                    <p class="text-sm text-base-content/55">
                      Quoi faire ensuite : un titre, un clip, ou laisser les streams travailler.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm gap-1 rounded-full"
                    disabled={careerBusy || busy}
                    onClick={() => runCareerAdvice(Boolean(career))}
                  >
                    {careerBusy ? (
                      <span class="loading loading-spinner loading-sm" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {career ? "Recalculer" : "Conseiller"}
                  </button>
                </div>

                {dueToday.length > 0 && (
                  <div class="space-y-2 rounded-2xl border border-primary/30 bg-primary/10 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <p class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                        <CalendarDays size={12} /> Aujourd’hui
                      </p>
                      {dueToday.some((i) => i.type === "promote") && (
                        <button
                          type="button"
                          class="btn btn-primary btn-xs gap-1 rounded-full"
                          disabled={scheduleBusy || busy}
                          onClick={runSchedulePromo}
                        >
                          {scheduleBusy ? (
                            <span class="loading loading-spinner loading-xs" />
                          ) : (
                            <Sparkles size={12} />
                          )}
                          Publier promo
                        </button>
                      )}
                    </div>
                    {schedulePreview?.blockers?.length > 0 && (
                      <p class="text-xs text-warning">{schedulePreview.blockers.join(" · ")}</p>
                    )}
                    <ul class="space-y-2">
                      {dueToday.map((item) => (
                        <li
                          key={`due-${item.date}-${item.type}-${item.title}`}
                          class="flex flex-wrap items-center gap-2 text-sm"
                        >
                          <span class="font-medium">{item.title}</span>
                          {item.detail && (
                            <span class="text-base-content/55">— {item.detail}</span>
                          )}
                          {item.type === "produce" && career?.nextSingle?.theme && (
                            <button
                              type="button"
                              class="btn btn-outline btn-xs rounded-full"
                              disabled={busy}
                              onClick={() => createTrack(career.nextSingle.theme)}
                            >
                              Ouvrir le Studio
                            </button>
                          )}
                          {item.type === "promote" && career?.releaseFocus?.id && (
                            <a
                              class="btn btn-outline btn-xs rounded-full"
                              href={studioHref(career.releaseFocus.id, "clip")}
                            >
                              Clip
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!career ? (
                  <button
                    type="button"
                    class="flex w-full flex-col items-center gap-2 rounded-3xl border border-dashed border-base-content/20 px-6 py-12 text-center"
                    disabled={careerBusy || busy}
                    onClick={() => runCareerAdvice(false)}
                  >
                    <Sparkles size={22} class="text-primary" />
                    <span class="font-display text-lg font-bold">Demander un conseil</span>
                    <span class="max-w-sm text-sm text-base-content/55">
                      L’agent lit le catalogue et propose le prochain geste.
                    </span>
                  </button>
                ) : (
                  <div class="space-y-4 rounded-3xl border border-base-content/10 bg-base-300/40 p-5">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class={`badge ${verdictClass(career.verdict)}`}>
                        {VERDICT_LABEL[career.verdict] || career.verdict}
                      </span>
                      {career.updatedAt && (
                        <span class="text-xs text-base-content/40">
                          {new Date(career.updatedAt).toLocaleString("fr-FR")}
                        </span>
                      )}
                    </div>
                    <p class="text-sm leading-relaxed text-base-content/80">{career.summary}</p>

                    {career.nextSingle && (
                      <div class="rounded-2xl bg-base-200/60 p-4">
                        <p class="text-[11px] uppercase tracking-wider text-base-content/45">
                          Prochain single
                        </p>
                        {career.nextSingle.titleHint && (
                          <p class="font-display text-lg font-semibold">
                            {career.nextSingle.titleHint}
                          </p>
                        )}
                        <p class="text-sm">{career.nextSingle.theme}</p>
                        {career.nextSingle.why && (
                          <p class="mt-1 text-xs text-base-content/45">{career.nextSingle.why}</p>
                        )}
                      </div>
                    )}

                    {Array.isArray(career.actions) && career.actions.length > 0 && (
                      <ol class="space-y-2 text-sm">
                        {career.actions.map((a) => (
                          <li
                            key={`${a.priority}-${a.label}`}
                            class="flex flex-wrap items-baseline gap-2"
                          >
                            <span class="text-primary/70">{a.priority}.</span>
                            <span class="min-w-0 flex-1">
                              <span class="font-medium">{a.label}</span>
                              {a.detail ? (
                                <span class="text-base-content/55"> — {a.detail}</span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}

                    {Array.isArray(career.schedule) && career.schedule.length > 0 && (
                      <div class="space-y-2">
                        <p class="flex items-center gap-1.5 text-xs uppercase tracking-wider text-base-content/45">
                          <CalendarDays size={12} /> Agenda
                        </p>
                        <ul class="space-y-1.5">
                          {career.schedule.map((item) => (
                            <li
                              key={`${item.date}-${item.type}-${item.title}`}
                              class={`flex flex-wrap gap-2 border-l-2 py-1 pl-3 text-sm ${
                                item.status === "done"
                                  ? "border-success/50 text-base-content/45 line-through"
                                  : item.status === "active"
                                    ? "border-primary text-base-content"
                                    : "border-base-content/15 text-base-content/65"
                              }`}
                            >
                              <span class="w-24 shrink-0 text-xs tabular-nums text-base-content/45 no-underline">
                                {item.date}
                              </span>
                              <span class="min-w-0 flex-1">
                                <span class="font-medium">{item.title}</span>
                                {item.detail ? (
                                  <span class="text-base-content/50"> — {item.detail}</span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {recentRuns.length > 0 && (
                      <p class="text-xs text-base-content/45">
                        Dernière promo :{" "}
                        {recentRuns[0].title || recentRuns[0].type} ·{" "}
                        {recentRuns[0].ok ? "ok" : recentRuns[0].status || "ko"}
                      </p>
                    )}

                    <div class="flex flex-wrap gap-2">
                      {(career.verdict === "publish" ||
                        career.actions?.some((a) => a.type === "publish_unison" && a.href)) &&
                        unisonHref && (
                          <a
                            class="btn btn-primary btn-sm gap-2 rounded-full"
                            href={unisonHref}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ouvrir ONCE <ExternalLink size={12} />
                          </a>
                        )}
                      {career.verdict === "produce" && career.nextSingle?.theme && (
                        <button
                          type="button"
                          class="btn btn-primary btn-sm gap-2 rounded-full"
                          disabled={busy}
                          onClick={() => createTrack(career.nextSingle.theme)}
                        >
                          <AudioLines size={14} /> Nouveau titre
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}

            {tab === "style" && (
              <section class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 class="font-display text-2xl font-bold">Identité sonore</h2>
                    <p class="text-sm text-base-content/55">
                      Ce qui guide paroles, voix et pochettes des prochains titres.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm gap-1 rounded-full"
                    disabled={busy}
                    onClick={openStyleEditor}
                  >
                    <Pencil size={14} /> Modifier le profil
                  </button>
                </div>

                {!style.genreSummary && !style.refs.length && !style.genres.length ? (
                  <button
                    type="button"
                    class="w-full rounded-3xl border border-dashed border-base-content/20 px-6 py-12 text-center"
                    disabled={busy}
                    onClick={openStyleEditor}
                  >
                    <Palette size={22} class="mx-auto mb-2 text-primary" />
                    <p class="font-display text-lg font-bold">Définir le style</p>
                    <p class="mx-auto mt-1 max-w-sm text-sm text-base-content/55">
                      Références, voix et photos se règlent sur Modifier le profil — pas dans le Studio.
                    </p>
                  </button>
                ) : (
                  <div class="space-y-5 rounded-3xl border border-base-content/10 bg-base-300/40 p-5">
                    <div class="flex flex-wrap gap-2">
                      {style.genres.map((g) => (
                        <span
                          key={g}
                          class="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary"
                        >
                          <Music2 size={12} />
                          {g}
                        </span>
                      ))}
                      {style.language && (
                        <span class="rounded-full border border-base-content/12 px-3 py-1 text-xs text-base-content/70">
                          {languageLabel(style.language)}
                        </span>
                      )}
                      {style.mood && (
                        <span class="rounded-full border border-base-content/12 px-3 py-1 text-xs text-base-content/70">
                          {style.mood}
                        </span>
                      )}
                    </div>

                    {style.refs.length > 0 && (
                      <div>
                        <p class="text-[11px] uppercase tracking-wider text-base-content/45">
                          {style.mode === "self" ? "Artistes aimés" : "Modèles"}
                        </p>
                        <p class="mt-1 text-lg text-primary">{style.refs.join(" · ")}</p>
                      </div>
                    )}

                    {style.topTracks.length > 0 && (
                      <div>
                        <p class="text-[11px] uppercase tracking-wider text-base-content/45">
                          Titres phares
                        </p>
                        <p class="mt-1 text-sm text-base-content/80">
                          {style.topTracks.slice(0, 6).join(" · ")}
                        </p>
                      </div>
                    )}

                    {(style.lock.timbre ||
                      style.lock.rhythmFeel ||
                      style.lock.bpm ||
                      style.voice) && (
                      <div class="grid gap-2 sm:grid-cols-2">
                        {style.lock.bpm ? (
                          <p class="rounded-2xl bg-base-200/70 px-3 py-2 text-sm">
                            <span class="text-base-content/45">Tempo</span>
                            <br />~{style.lock.bpm} BPM
                          </p>
                        ) : null}
                        {(style.lock.rhythmFeel || style.lock.tempoFeel) && (
                          <p class="rounded-2xl bg-base-200/70 px-3 py-2 text-sm">
                            <span class="text-base-content/45">Groove</span>
                            <br />
                            {style.lock.rhythmFeel || style.lock.tempoFeel}
                          </p>
                        )}
                        {style.voice && (
                          <p class="rounded-2xl bg-base-200/70 px-3 py-2 text-sm">
                            <span class="text-base-content/45">Voix</span>
                            <br />
                            {[style.voice, style.lock.vocalRegister].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {style.lock.timbre && (
                          <p class="rounded-2xl bg-base-200/70 px-3 py-2 text-sm">
                            <span class="text-base-content/45">Timbre</span>
                            <br />
                            {style.lock.timbre}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {tab === "chiffres" && (
              <section class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 class="font-display text-2xl font-bold">Les chiffres</h2>
                    <p class="text-sm text-base-content/55">
                      Catalogue SONOZZ et streams ONCE — les revenus restent chez le distributeur.
                    </p>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="btn btn-outline btn-sm gap-1 rounded-full"
                      disabled={busy}
                      onClick={refreshStats}
                    >
                      <RefreshCw size={14} /> Actualiser
                    </button>
                    <a
                      class="btn btn-ghost btn-sm gap-1 rounded-full"
                      href={links.once}
                      target="_blank"
                      rel="noreferrer"
                    >
                      ONCE <ExternalLink size={12} />
                    </a>
                    <a
                      class="btn btn-ghost btn-sm gap-1 rounded-full"
                      href={links.spotifyForArtists}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Spotify <ExternalLink size={12} />
                    </a>
                  </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Titres", stats.tracks ?? releases.length],
                    ["Avec audio", stats.withAudio ?? 0],
                    ["Chez ONCE", stats.submitted ?? 0],
                    ["En store", stats.liveOnSpotify ?? "—"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      class="rounded-2xl border border-base-content/10 bg-base-300/40 px-4 py-4"
                    >
                      <p class="text-[11px] uppercase tracking-wider text-base-content/45">
                        {label}
                      </p>
                      <p class="font-display text-3xl font-bold">{value}</p>
                    </div>
                  ))}
                </div>

                {(streams.totalStreams != null || streams.error) && (
                  <div class="space-y-3 rounded-3xl border border-base-content/10 bg-base-300/40 p-5">
                    <p class="text-[11px] uppercase tracking-wider text-base-content/45">
                      Écoutes · 30 jours
                    </p>
                    {streams.error ? (
                      <p class="text-sm text-warning">{streams.error}</p>
                    ) : (
                      <p class="font-display text-4xl font-bold">
                        {formatStreams(streams.totalStreams)}
                      </p>
                    )}
                    {!streams.error && (
                      <div class="flex flex-wrap gap-3 text-sm text-base-content/60">
                        {streams.avgDailyStreams != null && (
                          <span>~{formatStreams(Math.round(streams.avgDailyStreams))} / jour</span>
                        )}
                        {changeLabel && (
                          <span
                            class={streams.periodChangePct >= 0 ? "text-success" : "text-error"}
                          >
                            {changeLabel}
                          </span>
                        )}
                      </div>
                    )}
                    {!streams.error &&
                      Array.isArray(streams.topStores) &&
                      streams.topStores.length > 0 && (
                        <ul class="flex flex-wrap gap-2 text-xs">
                          {streams.topStores.slice(0, 6).map((s) => (
                            <li
                              key={s.id ?? s.name}
                              class="rounded-full border border-base-content/10 px-2.5 py-1 text-base-content/60"
                            >
                              {s.name} · {formatStreams(s.total)}
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                )}
                {stats.streamsNote && (
                  <p class="text-xs text-base-content/45">{stats.streamsNote}</p>
                )}
              </section>
            )}
          </div>
        )}
      </div>

      {showAlbumModal && (
        <AlbumCreationModal
          slug={slug}
          leadCandidates={releases.filter((r) => r.hasAudio && r.hasLyrics)}
          onClose={() => setShowAlbumModal(false)}
          onCreate={() => {
            setShowAlbumModal(false);
            loadData();
          }}
        />
      )}

      <TrackCreationModal
        open={showTrackModal}
        onClose={() => setShowTrackModal(false)}
        onConfirm={(options) => createTrack(pendingTrackTheme, options)}
        currentGenre={style.genres[0] || profile.genre || ""}
        currentReferences={style.refs || []}
        currentReferenceTrack={style.topTracks?.[0] || style.lock?.topTracks?.[0] || ""}
      />
    </AppShell>
  );
}
