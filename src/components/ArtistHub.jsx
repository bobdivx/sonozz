import { useEffect, useState } from "preact/hooks";
import {
  AudioLines,
  BarChart3,
  Bot,
  CalendarDays,
  ExternalLink,
  Headphones,
  Music2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-preact";
import AppShell from "./AppShell.jsx";
import ArtistAlbumSection from "./ArtistAlbumSection.jsx";
import { api } from "../lib/apiClient.js";
import { loadKeys } from "../lib/keys.js";
import { confirmDeleteProject, languageLabel } from "../lib/studio.js";

const VERDICT_LABEL = {
  produce: "Produire",
  wait: "Attendre",
  promote: "Promouvoir",
  pivot: "Corriger",
  publish: "Unison",
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

function storeBadgeClass(status = "") {
  if (/live|distributed|delivered/i.test(status)) return "text-success";
  if (/fail|error|reject/i.test(status)) return "text-error";
  if (/pending|queued|process/i.test(status)) return "text-warning";
  return "text-base-content/55";
}

function styleRowsFromProfile(profile = {}) {
  const lock = profile.styleLock || {};
  const genres = Array.isArray(profile.genres)
    ? profile.genres.filter(Boolean)
    : profile.genre
      ? [profile.genre]
      : [];
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

  async function createTrack(themeOverride) {
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
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Création impossible");
      window.location.href = json.studioUrl || `/?project=${json.projectId}&step=3`;
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function openStyleEditor() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit-style" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Ouverture impossible");
      window.location.href = json.studioUrl || `/?project=${json.projectId}&step=2`;
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
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
        const { saveKeysAsync, loadKeys } = await import("../lib/keys.js");
        await saveKeysAsync({
          ...loadKeys(),
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

  useEffect(() => {
    if (data?.career) loadSchedulePreview();
  }, [data?.career?.updatedAt, slug]);

  const profile = data?.profile || {};
  const stats = data?.stats || {};
  const career = data?.career || stats.career || null;
  const releases = data?.releases || [];
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

  return (
    <AppShell active="artistes">
    <div class="mx-auto w-full max-w-5xl">
      <div class="mb-8 flex flex-wrap items-center gap-3">
        <a href="/artistes" class="btn btn-ghost btn-sm">
          Tous les artistes
        </a>
        <a
          class="btn btn-ghost btn-sm gap-1"
          href={links.once}
          target="_blank"
          rel="noreferrer"
        >
          ONCE <ExternalLink size={12} />
        </a>
        <a
          class="btn btn-ghost btn-sm gap-1"
          href={links.spotifyForArtists}
          target="_blank"
          rel="noreferrer"
        >
          Spotify for Artists <ExternalLink size={12} />
        </a>
      </div>

      {loading && (
        <p class="text-base-content/60">
          <span class="loading loading-spinner loading-sm" /> Chargement…
        </p>
      )}
      {error && <div class="mb-4 border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {msg && <p class="mb-3 text-sm text-success">{msg}</p>}

      {data && (
        <div class="space-y-10 animate-rise">
          <header class="grid gap-6 md:grid-cols-[200px_1fr] md:items-end">
            <figure>
              {profile.imageUrl ? (
                <img
                  src={profile.imageUrl}
                  alt={data.name}
                  class="aspect-square w-full object-cover shadow-2xl shadow-black/40"
                />
              ) : (
                <div class="flex aspect-square items-center justify-center bg-base-300">
                  <UserRound size={40} class="opacity-40" />
                </div>
              )}
            </figure>
            <div class="space-y-3">
              <p class="text-xs uppercase tracking-[0.28em] text-primary">/{data.slug}</p>
              <h1 class="font-display text-4xl font-extrabold tracking-tight md:text-6xl">{data.name}</h1>
              {profile.aka && <p class="text-lg text-base-content/60">{profile.aka}</p>}
              <p class="max-w-xl text-base-content/70">{profile.bio || "Profil artiste SONOZZ"}</p>
              <div class="flex flex-wrap gap-2 text-sm text-base-content/55">
                {profile.genre && <span>{profile.genre}</span>}
                {profile.city && <span>· {profile.city}</span>}
                {profile.mood && <span>· {profile.mood}</span>}
              </div>
              {releases.some((r) => r.audioUrl) && (
                <a
                  class="btn btn-primary gap-2"
                  href={`/play?artist=${encodeURIComponent(data.slug)}&play=1`}
                >
                  <Headphones size={16} /> Écouter dans Play
                </a>
              )}
            </div>
          </header>

          <section class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
                <Music2 size={22} /> Style musical
              </h2>
              <button
                type="button"
                class="btn btn-outline btn-sm gap-1"
                disabled={busy}
                onClick={openStyleEditor}
              >
                <Pencil size={14} /> Modifier
              </button>
            </div>
            <p class="text-sm text-base-content/65">
              Synthèse des choix qui guident paroles, audio et jaquette. Modifie-les dans le studio
              (étape Artiste) — le profil artiste est mis à jour pour les prochains morceaux.
            </p>

            {!style.genreSummary && !style.refs.length ? (
              <div class="border border-dashed border-base-content/20 bg-base-200/20 px-4 py-5">
                <p class="text-sm text-base-content/60">
                  Aucun style défini pour cet artiste.
                </p>
                <button
                  type="button"
                  class="btn btn-primary btn-sm mt-3 gap-1"
                  disabled={busy}
                  onClick={openStyleEditor}
                >
                  <Pencil size={14} /> Définir le style
                </button>
              </div>
            ) : (
              <div class="space-y-4 border border-base-content/10 bg-base-200/30 p-4">
                <div class="flex flex-wrap gap-2">
                  {(style.genres.length ? style.genres : style.genreSummary ? [style.genreSummary] : []).map(
                    (g) => (
                      <span
                        key={g}
                        class="inline-flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary"
                      >
                        <Music2 size={12} />
                        {g}
                      </span>
                    ),
                  )}
                  {style.language && (
                    <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                      {languageLabel(style.language)}
                    </span>
                  )}
                  {style.mood && (
                    <span class="inline-flex items-center border border-base-content/15 px-2.5 py-1 text-xs text-base-content/70">
                      {style.mood}
                    </span>
                  )}
                  {style.mode === "self" && (
                    <span class="inline-flex items-center border border-secondary/30 bg-secondary/10 px-2.5 py-1 text-xs text-secondary">
                      Profil « c’est moi »
                    </span>
                  )}
                </div>

                {style.refs.length > 0 && (
                  <div>
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      {style.mode === "self" ? "Artistes aimés" : "Artistes modèles"}
                    </p>
                    <p class="mt-1 text-sm text-primary">{style.refs.join(" · ")}</p>
                    {style.lock.source && (
                      <p class="mt-0.5 text-xs text-base-content/40">
                        {style.lock.source}
                        {style.lock.confidence ? ` · ${style.lock.confidence}` : ""}
                        {style.lock.audioListened ? " · preview écouté" : ""}
                      </p>
                    )}
                  </div>
                )}

                {style.topTracks.length > 0 && (
                  <div>
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Morceaux de référence
                    </p>
                    <p class="mt-1 text-sm text-base-content/80">{style.topTracks.slice(0, 6).join(" · ")}</p>
                  </div>
                )}

                {style.influences.length > 0 && (
                  <div>
                    <p class="text-xs uppercase tracking-wider text-base-content/45">Influences</p>
                    <p class="mt-1 text-sm text-base-content/70">{style.influences.join(" · ")}</p>
                  </div>
                )}

                {(style.lock.timbre ||
                  style.lock.rhythmFeel ||
                  style.lock.tempoFeel ||
                  style.lock.bpm ||
                  style.instruments.length > 0 ||
                  style.voice) && (
                  <div class="space-y-1 border-t border-base-content/10 pt-3 text-xs text-base-content/65">
                    <p class="font-medium uppercase tracking-wider text-base-content/45">DNA sonore</p>
                    {style.lock.timbre && (
                      <p>
                        Timbre — <span class="text-base-content/80">{style.lock.timbre}</span>
                      </p>
                    )}
                    {(style.lock.rhythmFeel || style.lock.tempoFeel) && (
                      <p>
                        Groove —{" "}
                        <span class="text-base-content/80">
                          {style.lock.rhythmFeel || style.lock.tempoFeel}
                        </span>
                      </p>
                    )}
                    {style.lock.bpm ? (
                      <p>
                        Tempo — <span class="text-base-content/80">~{style.lock.bpm} BPM</span>
                        {style.lock.energy ? ` · énergie ${style.lock.energy}` : ""}
                      </p>
                    ) : null}
                    {style.instruments.length > 0 && (
                      <p>
                        Instruments —{" "}
                        <span class="text-base-content/80">{style.instruments.slice(0, 6).join(" · ")}</span>
                      </p>
                    )}
                    {style.voice && (
                      <p>
                        Voix —{" "}
                        <span class="text-base-content/80">
                          {[style.voice, style.lock.vocalRegister].filter(Boolean).join(" · ")}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {style.production && (
                  <p class="text-xs text-base-content/45">{style.production}</p>
                )}
              </div>
            )}
          </section>

          <section class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
                <BarChart3 size={22} /> Stats
              </h2>
              <button type="button" class="btn btn-outline btn-sm gap-1" disabled={busy} onClick={refreshStats}>
                <RefreshCw size={14} /> Rafraîchir
              </button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
              {[
                ["Morceaux", stats.tracks ?? releases.length],
                ["Avec audio", stats.withAudio ?? 0],
                ["Soumis ONCE", stats.submitted ?? 0],
                ["Live Spotify", stats.liveOnSpotify ?? "—"],
                ["Prêt Unison", stats.unisonReady ?? 0],
              ].map(([label, value]) => (
                <div key={label} class="border border-base-content/10 bg-base-200/40 px-4 py-3">
                  <p class="text-xs uppercase tracking-wider text-base-content/45">{label}</p>
                  <p class="font-display text-3xl font-bold">{value}</p>
                </div>
              ))}
            </div>

            {(streams.totalStreams != null || streams.error) && (
              <div class="space-y-3 border border-base-content/10 bg-base-200/30 p-4">
                <div class="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Streams ONCE
                      {streams.fromDate && streams.toDate
                        ? ` · ${streams.fromDate} → ${streams.toDate}`
                        : " · 30 j"}
                    </p>
                    {streams.error ? (
                      <p class="mt-1 text-sm text-warning">{streams.error}</p>
                    ) : (
                      <p class="font-display text-4xl font-bold">{formatStreams(streams.totalStreams)}</p>
                    )}
                  </div>
                  {!streams.error && (
                    <div class="text-right text-sm text-base-content/60">
                      {streams.avgDailyStreams != null && (
                        <p>~{formatStreams(Math.round(streams.avgDailyStreams))} / jour</p>
                      )}
                      {changeLabel && <p class={streams.periodChangePct >= 0 ? "text-success" : "text-error"}>{changeLabel}</p>}
                      {streams.topStore?.name && (
                        <p>
                          Top : {streams.topStore.name}
                          {streams.topStore.share != null
                            ? ` (${Math.round(streams.topStore.share * 100)} %)`
                            : ""}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                {!streams.error && Array.isArray(streams.topStores) && streams.topStores.length > 0 && (
                  <ul class="flex flex-wrap gap-2 text-xs text-base-content/60">
                    {streams.topStores.slice(0, 6).map((s) => (
                      <li key={s.id ?? s.name} class="border border-base-content/10 px-2 py-1">
                        {s.name} · {formatStreams(s.total)}
                      </li>
                    ))}
                  </ul>
                )}
                <p class="text-xs text-base-content/45">
                  Les revenus restent chez ONCE (puis Spotify for Artists pour le détail). SONOZZ ne reverse pas.
                </p>
              </div>
            )}

            <p class="text-xs text-base-content/45">{stats.streamsNote}</p>
          </section>

          <section class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
                <Bot size={22} /> Agent carrière
              </h2>
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-outline btn-sm gap-1"
                  disabled={careerBusy || busy}
                  onClick={() => runCareerAdvice(false)}
                >
                  {careerBusy ? (
                    <span class="loading loading-spinner loading-sm" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Conseiller
                </button>
                {career && (
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm"
                    disabled={careerBusy || busy}
                    onClick={() => runCareerAdvice(true)}
                  >
                    Recalculer
                  </button>
                )}
              </div>
            </div>
            <p class="text-sm text-base-content/65">
              Analytics → Unison / promo / prochain single + agenda. Webhook ONCE = maj auto à chaque
              changement de statut store.
            </p>

            {dueToday.length > 0 && (
              <div class="space-y-2 border border-primary/30 bg-primary/5 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="flex items-center gap-1.5 text-xs uppercase tracking-wider text-primary">
                    <CalendarDays size={12} /> À faire aujourd’hui
                  </p>
                  {dueToday.some((i) => i.type === "promote") && (
                    <button
                      type="button"
                      class="btn btn-primary btn-xs gap-1"
                      disabled={scheduleBusy || busy}
                      onClick={runSchedulePromo}
                      title={
                        schedulePreview?.blockers?.length
                          ? schedulePreview.blockers.join(" · ")
                          : "Publier le clip focus sur TikTok / YouTube / webhook"
                      }
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
                {schedulePreview?.canRun && (
                  <p class="text-xs text-success">
                    Clip MP4 prêt — la promo peut partir maintenant.
                  </p>
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
                      {item.href && (
                        <a
                          class="btn btn-primary btn-xs gap-1"
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ouvrir <ExternalLink size={10} />
                        </a>
                      )}
                      {item.type === "produce" && career?.nextSingle?.theme && (
                        <button
                          type="button"
                          class="btn btn-outline btn-xs gap-1"
                          disabled={busy}
                          onClick={() => createTrack(career.nextSingle.theme)}
                        >
                          Studio
                        </button>
                      )}
                      {item.type === "promote" && career?.releaseFocus?.id && (
                        <a
                          class="btn btn-outline btn-xs"
                          href={`/?project=${career.releaseFocus.id}&step=7`}
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
              <p class="text-sm text-base-content/50">
                Lance l’agent (ou Rafraîchir les stats) pour analyser le catalogue ONCE.
              </p>
            ) : (
              <div class="space-y-4 border border-base-content/10 bg-base-200/30 p-4">
                <div class="flex flex-wrap items-center gap-2">
                  <span class={`badge ${verdictClass(career.verdict)}`}>
                    {VERDICT_LABEL[career.verdict] || career.verdict}
                  </span>
                  {career.source && (
                    <span class="text-xs text-base-content/45">{career.source}</span>
                  )}
                  {career.updatedAt && (
                    <span class="text-xs text-base-content/40">
                      {new Date(career.updatedAt).toLocaleString("fr-FR")}
                    </span>
                  )}
                </div>
                <p class="text-sm text-base-content/80">{career.summary}</p>

                {(career.releaseFocus?.isrc ||
                  career.releaseFocus?.upc ||
                  career.releaseFocus?.publishingStatus) && (
                  <p class="text-xs text-base-content/55">
                    {career.releaseFocus.upc
                      ? `UPC ${career.releaseFocus.upc}`
                      : "UPC pending"}
                    {" · "}
                    {career.releaseFocus.isrc
                      ? `ISRC ${career.releaseFocus.isrc}`
                      : "ISRC pending"}
                  </p>
                )}

                {career.nextSingle && (
                  <div class="space-y-1">
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Prochain single
                    </p>
                    {career.nextSingle.titleHint && (
                      <p class="font-display text-lg font-semibold">{career.nextSingle.titleHint}</p>
                    )}
                    <p class="text-sm">{career.nextSingle.theme}</p>
                    {career.nextSingle.angle && (
                      <p class="text-xs text-base-content/55">{career.nextSingle.angle}</p>
                    )}
                    {career.nextSingle.why && (
                      <p class="text-xs text-base-content/45">{career.nextSingle.why}</p>
                    )}
                  </div>
                )}

                {Array.isArray(career.actions) && career.actions.length > 0 && (
                  <ol class="space-y-2 text-sm">
                    {career.actions.map((a) => (
                      <li key={`${a.priority}-${a.label}`} class="flex flex-wrap items-baseline gap-2">
                        <span class="text-base-content/40">{a.priority}.</span>
                        <span class="min-w-0 flex-1">
                          <span class="font-medium">{a.label}</span>
                          {a.detail ? (
                            <span class="text-base-content/55"> — {a.detail}</span>
                          ) : null}
                        </span>
                        {a.href && (
                          <a
                            class="btn btn-ghost btn-xs gap-1"
                            href={a.href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ONCE <ExternalLink size={10} />
                          </a>
                        )}
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
                            {item.status === "done" && (
                              <span class="ml-1 text-xs text-success no-underline">fait</span>
                            )}
                            {item.detail ? (
                              <span class="text-base-content/50"> — {item.detail}</span>
                            ) : null}
                          </span>
                          {item.href && item.status !== "done" && (
                            <a
                              class="btn btn-ghost btn-xs gap-1"
                              href={item.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ouvrir <ExternalLink size={10} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {recentRuns.length > 0 && (
                  <div class="space-y-1">
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Dernières publications agenda
                    </p>
                    <ul class="space-y-1 text-xs text-base-content/55">
                      {recentRuns.map((run) => (
                        <li key={`${run.key}-${run.at}`}>
                          {run.at ? new Date(run.at).toLocaleString("fr-FR") : "—"}
                          {" · "}
                          {run.title || run.type}
                          {" · "}
                          <span class={run.ok ? "text-success" : "text-warning"}>
                            {run.status || (run.ok ? "ok" : "ko")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {career.cadence?.note && (
                  <p class="text-xs text-base-content/45">{career.cadence.note}</p>
                )}
                {career.releaseFocus?.title && (
                  <p class="text-xs text-base-content/50">
                    Focus : {career.releaseFocus.title}
                    {career.releaseFocus.reason ? ` (${career.releaseFocus.reason})` : ""}
                  </p>
                )}

                <div class="flex flex-wrap gap-2">
                  {(career.verdict === "publish" ||
                    career.actions?.some((a) => a.type === "publish_unison" && a.href)) &&
                    (career.releaseFocus?.dashboardUrl ||
                      career.actions?.find((a) => a.href)?.href) && (
                      <a
                        class="btn btn-primary btn-sm gap-2"
                        href={
                          career.releaseFocus?.dashboardUrl ||
                          career.actions.find((a) => a.href)?.href
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Soumettre Unison sur ONCE <ExternalLink size={12} />
                      </a>
                    )}
                  {career.verdict === "produce" && career.nextSingle?.theme && (
                    <button
                      type="button"
                      class="btn btn-primary btn-sm gap-2"
                      disabled={busy}
                      onClick={() => createTrack(career.nextSingle.theme)}
                    >
                      <AudioLines size={14} /> Lancer ce single dans le studio
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section class="space-y-4">
            <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
              <Plus size={22} /> Nouveau morceau
            </h2>
            <p class="text-sm text-base-content/65">
              Garde le même artiste et lance un nouveau single (paroles → audio → jaquette → ONCE → short).
              Le thème se choisit à l’étape paroles dans le studio.
            </p>
            <button
              type="button"
              class="btn btn-primary gap-2"
              disabled={busy}
              onClick={() => createTrack()}
            >
              {busy ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={16} />}
              Créer morceau
            </button>
          </section>

          <ArtistAlbumSection slug={data.slug} releases={releases} />

          <section class="space-y-4">
            <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
              <Music2 size={22} /> Catalogue
            </h2>
            {releases.length === 0 ? (
              <p class="text-sm text-base-content/55">Aucun morceau encore — crée le premier ci-dessus.</p>
            ) : (
              <ul class="space-y-3">
                {releases.map((r) => {
                  const delivery = r.releaseId
                    ? deliveryMap[r.releaseId] || stats.releases?.find((x) => x.id === r.id)?.delivery
                    : null;
                  const rStreams = r.releaseId
                    ? releaseStreamsMap[r.releaseId] ||
                      stats.releases?.find((x) => x.id === r.id)?.streams
                    : null;
                  return (
                  <li
                    key={r.id}
                    class="flex flex-wrap items-center gap-4 border border-base-content/10 bg-base-200/30 p-3"
                  >
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt="" class="h-14 w-14 object-cover" />
                    ) : (
                      <div class="flex h-14 w-14 items-center justify-center bg-base-300">
                        <Music2 size={18} class="opacity-40" />
                      </div>
                    )}
                    <div class="min-w-0 flex-1">
                      <p class="font-medium">{r.trackTitle || r.title}</p>
                      <p class="text-xs text-base-content/50">
                        {r.onceStatus || r.status}
                        {r.releaseId ? ` · ONCE ${r.releaseId}` : ""}
                        {r.hasAudio ? " · audio" : ""}
                      </p>
                      {delivery?.identifiers && (
                        <p class="mt-1 text-xs text-base-content/45">
                          UPC {delivery.identifiers.upcPending ? "pending" : delivery.identifiers.upc || "—"}
                          {" · "}
                          ISRC{" "}
                          {delivery.identifiers.isrcPending
                            ? "pending"
                            : delivery.identifiers.isrc || "—"}
                          {delivery.publishing?.label
                            ? ` · ${delivery.publishing.label}`
                            : ""}
                        </p>
                      )}
                      {delivery && !delivery.error && (
                        <p class={`mt-1 text-xs ${storeBadgeClass(delivery.spotifyStatus || delivery.aggregateStatus)}`}>
                          {delivery.aggregateStatus ? `${delivery.aggregateStatus}` : ""}
                          {delivery.spotifyStatus ? ` · Spotify: ${delivery.spotifyStatus}` : ""}
                          {rStreams?.totalStreams != null && !rStreams.error
                            ? ` · ${formatStreams(rStreams.totalStreams)} streams`
                            : ""}
                        </p>
                      )}
                      {delivery?.error && (
                        <p class="mt-1 text-xs text-warning">{delivery.error}</p>
                      )}
                      {delivery?.stores?.length > 0 && (
                        <ul class="mt-1 flex flex-wrap gap-1.5 text-[11px] text-base-content/50">
                          {delivery.stores.slice(0, 5).map((s) => (
                            <li key={`${s.name}-${s.status}`}>
                              {s.url ? (
                                <a href={s.url} target="_blank" rel="noreferrer" class="underline-offset-2 hover:underline">
                                  {s.name}: {s.status}
                                </a>
                              ) : (
                                <span>
                                  {s.name}: {s.status}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div class="flex flex-wrap gap-2">
                      {delivery?.publishing?.canSubmitUnison && delivery?.dashboardUrl && (
                        <a
                          class="btn btn-primary btn-sm gap-1"
                          href={delivery.dashboardUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Unison <ExternalLink size={12} />
                        </a>
                      )}
                      {delivery?.spotifyUrl && (
                        <a
                          class="btn btn-ghost btn-sm gap-1"
                          href={delivery.spotifyUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Spotify <ExternalLink size={12} />
                        </a>
                      )}
                      {delivery?.dashboardUrl && !delivery?.publishing?.canSubmitUnison && (
                        <a
                          class="btn btn-ghost btn-sm gap-1"
                          href={delivery.dashboardUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ONCE <ExternalLink size={12} />
                        </a>
                      )}
                      <a class="btn btn-ghost btn-sm" href={`/?project=${r.id}`}>
                        Ouvrir
                      </a>
                      {r.audioUrl && (
                        <a
                          class="btn btn-primary btn-sm gap-1"
                          href={`/play?artist=${encodeURIComponent(data.slug)}&track=${encodeURIComponent(r.id)}&play=1`}
                        >
                          <Headphones size={12} /> Lire
                        </a>
                      )}
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm gap-1 text-error"
                        disabled={busy}
                        title="Supprimer ce morceau"
                        onClick={() => deleteRelease(r)}
                      >
                        <Trash2 size={12} /> Supprimer
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
    </AppShell>
  );
}
