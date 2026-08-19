import { useEffect, useState } from "preact/hooks";
import {
  BarChart3,
  ExternalLink,
  Music2,
  RefreshCw,
  Store,
} from "lucide-preact";
import { loadKeys, ensureKeysHydrated } from "../../lib/keys.js";

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

function trackRowLabel(t) {
  return (
    t?.title ||
    t?.trackTitle ||
    t?.trackName ||
    t?.name ||
    t?.isrc ||
    t?.id ||
    "Piste"
  );
}

function trackRowStreams(t) {
  const n =
    t?.totalStreams ??
    t?.streams ??
    t?.streamsCount ??
    t?.kpis?.totalStreams ??
    t?.streamCount ??
    null;
  return n == null || Number.isNaN(Number(n)) ? null : Number(n);
}

function isLiveDelivery(delivery) {
  if (!delivery || delivery.error) return false;
  if (delivery.spotifyUrl) return true;
  return /live|distributed|delivered|success/i.test(
    `${delivery.spotifyStatus || ""} ${delivery.aggregateStatus || ""}`,
  );
}

export default function StatsStep({
  track,
  artist,
  distrokid,
  cover,
  projectId,
}) {
  const slug = artist?.slug;
  const releaseId = distrokid?.releaseId || null;

  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(Boolean(slug));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    if (!slug) {
      setHub(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Artiste introuvable");
      setHub(json.artist);
      return json.artist;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const artist = await load();
      if (cancelled) return;
      await ensureKeysHydrated();
      if (cancelled) return;
      const keys = loadKeys();
      const rid = distrokid?.releaseId || null;
      const delivery =
        (rid && artist?.stats?.delivery?.[rid]) ||
        distrokid?.delivery ||
        null;
      const token = keys.onceApiToken?.trim();
      if (token && rid && (!delivery || delivery.error)) {
        await refreshStats();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function refreshStats() {
    if (!slug) return;
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const keys = loadKeys();
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh-stats", keys, advise: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Stats KO");
      setHub((prev) =>
        prev
          ? {
              ...prev,
              stats: json.stats,
            }
          : prev,
      );
      setMsg(
        json.onceSynced
          ? "Stats ONCE synchronisées (stores + streams)"
          : "Stats catalogue OK — ajoute un token ONCE dans Réglages pour sync streams",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const stats = hub?.stats || {};
  const releases = hub?.releases || [];
  const deliveryMap = stats.delivery || {};
  const releaseStreamsMap = stats.releaseStreams || {};

  const matched =
    releases.find((r) => releaseId && r.releaseId === releaseId) ||
    releases.find((r) => projectId && r.id === projectId) ||
    null;

  const matchedReleaseId = matched?.releaseId || releaseId;
  const delivery = matchedReleaseId
    ? deliveryMap[matchedReleaseId] ||
      stats.releases?.find((x) => x.releaseId === matchedReleaseId)?.delivery ||
      distrokid?.delivery ||
      null
    : distrokid?.delivery || null;
  const rStreams = matchedReleaseId
    ? releaseStreamsMap[matchedReleaseId] ||
      stats.releases?.find((x) => x.releaseId === matchedReleaseId)?.streams ||
      null
    : null;

  const changeLabel = formatPct(rStreams?.periodChangePct);
  const title =
    track?.title ||
    distrokid?.form?.trackTitle ||
    distrokid?.title ||
    matched?.trackTitle ||
    matched?.title ||
    "Morceau";
  const artwork = cover?.imageUrl || matched?.coverUrl || distrokid?.assets?.coverUrl || null;
  const oncePublished = Boolean(
    matchedReleaseId ||
      /^(submitted|live|distributed|delivered)/i.test(String(distrokid?.status || "")),
  );
  const deliveryLive = isLiveDelivery(delivery);
  const trackRows = Array.isArray(rStreams?.tracks) ? rStreams.tracks : [];
  const storeRows =
    (Array.isArray(rStreams?.topStores) && rStreams.topStores.length > 0
      ? rStreams.topStores
      : null) ||
    (Array.isArray(rStreams?.distributors) ? rStreams.distributors : []) ||
    [];

  const metaKpis = [
    ["BPM", track?.bpm ?? "—"],
    ["Tonalité", track?.key ?? "—"],
    ["Durée", track?.duration ?? "—"],
    ["Style", track?.style || distrokid?.form?.genre || distrokid?.genre || "—"],
    ["Mood", track?.mood ?? "—"],
    ["Provider", track?.provider || (oncePublished ? "ONCE" : "—")],
  ];

  return (
    <section class="animate-rise space-y-6">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="space-y-2">
          <h2 class="font-display text-2xl font-bold tracking-tight md:text-3xl">
            Stats du morceau
          </h2>
          <p class="max-w-xl text-base-content/70">
            {slug
              ? `Métadonnées, livraisons stores et streams ONCE pour ${title}.`
              : (
                <>
                  Lie un{" "}
                  <a class="link" href="/artistes">
                    artiste
                  </a>{" "}
                  à ce morceau pour le catalogue et les analytics ONCE.
                </>
              )}
          </p>
        </div>
        {slug && (
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1"
            disabled={busy || loading}
            onClick={refreshStats}
          >
            {busy ? (
              <span class="loading loading-spinner loading-sm" />
            ) : (
              <RefreshCw size={14} />
            )}
            Rafraîchir
          </button>
        )}
      </header>

      {error && (
        <div class="border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}
      {msg && !error && (
        <p class="text-sm text-success">{msg}</p>
      )}

      {loading ? (
        <div class="flex items-center gap-2 text-sm text-base-content/55">
          <span class="loading loading-spinner loading-sm" /> Chargement des stats…
        </div>
      ) : (
        <>
          <div class="flex flex-wrap items-center gap-4 border border-base-content/10 bg-base-200/30 p-4">
            {artwork ? (
              <img src={artwork} alt="" class="h-20 w-20 object-cover" />
            ) : (
              <div class="flex h-20 w-20 items-center justify-center bg-base-300">
                <Music2 size={22} class="opacity-40" />
              </div>
            )}
            <div class="min-w-0 flex-1">
              <p class="font-display text-xl font-semibold">{title}</p>
              <p class="text-sm text-base-content/60">
                {track?.artist || artist?.name || distrokid?.form?.artistName || "—"}
                {matched?.onceStatus || distrokid?.status
                  ? ` · ${matched?.onceStatus || distrokid?.status}`
                  : ""}
                {matchedReleaseId ? ` · ONCE ${matchedReleaseId}` : ""}
              </p>
              {!track && !oncePublished && (
                <p class="mt-1 text-xs text-warning">
                  Pas encore de morceau généré — passe à l’étape Morceaux.
                </p>
              )}
              {!track?.audioUrl && oncePublished && (
                <p class="mt-1 text-xs text-base-content/55">
                  {deliveryLive
                    ? "En ligne sur les stores — l’audio local n’est plus dans ce projet."
                    : "Soumis via ONCE — l’audio local n’est plus dans ce projet."}
                </p>
              )}
            </div>
            {(delivery?.dashboardUrl || distrokid?.dashboardUrl) && (
              <a
                class="btn btn-ghost btn-sm gap-1"
                href={delivery?.dashboardUrl || distrokid?.dashboardUrl}
                target="_blank"
                rel="noreferrer"
              >
                ONCE <ExternalLink size={12} />
              </a>
            )}
            {(delivery?.spotifyUrl || distrokid?.spotifyUrl) && (
              <a
                class="btn btn-outline btn-sm gap-1"
                href={delivery?.spotifyUrl || distrokid?.spotifyUrl}
                target="_blank"
                rel="noreferrer"
              >
                Spotify <ExternalLink size={12} />
              </a>
            )}
          </div>

          {(track || oncePublished) && (
            <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {metaKpis.map(([label, value]) => (
                <div
                  key={label}
                  class="border border-base-content/10 bg-base-200/40 px-4 py-3"
                >
                  <p class="text-xs uppercase tracking-wider text-base-content/45">
                    {label}
                  </p>
                  <p class="font-display truncate text-lg font-bold">{value}</p>
                </div>
              ))}
            </div>
          )}

          <section class="space-y-3">
            <h3 class="font-display flex items-center gap-2 text-lg font-bold">
              <BarChart3 size={18} /> Streams
            </h3>
            {!matchedReleaseId ? (
              <p class="text-sm text-base-content/55">
                Aucune release ONCE liée — soumets le titre (étape ONCE) pour voir les streams.
              </p>
            ) : rStreams?.error ? (
              <p class="text-sm text-warning">{rStreams.error}</p>
            ) : rStreams?.totalStreams != null ? (
              <div class="space-y-3 border border-base-content/10 bg-base-200/30 p-4">
                <div class="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Streams ONCE
                      {rStreams.fromDate && rStreams.toDate
                        ? ` · ${rStreams.fromDate} → ${rStreams.toDate}`
                        : " · 30 j"}
                    </p>
                    <p class="font-display text-4xl font-bold">
                      {formatStreams(rStreams.totalStreams)}
                    </p>
                  </div>
                  <div class="text-right text-sm text-base-content/60">
                    {rStreams.avgDailyStreams != null && (
                      <p>
                        ~{formatStreams(Math.round(rStreams.avgDailyStreams))} / jour
                      </p>
                    )}
                    {changeLabel && (
                      <p
                        class={
                          rStreams.periodChangePct >= 0
                            ? "text-success"
                            : "text-error"
                        }
                      >
                        {changeLabel}
                      </p>
                    )}
                    {rStreams.topStore?.name && (
                      <p>
                        Top : {rStreams.topStore.name}
                        {rStreams.topStore.share != null
                          ? ` (${Math.round(rStreams.topStore.share * 100)} %)`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>

                {storeRows.length > 0 && (
                  <ul class="flex flex-wrap gap-2 text-xs text-base-content/60">
                    {storeRows.slice(0, 8).map((s) => (
                      <li
                        key={s.id ?? s.name ?? s.distributorName}
                        class="border border-base-content/10 px-2 py-1"
                      >
                        {s.name || s.distributorName || "Store"} ·{" "}
                        {formatStreams(s.total ?? s.totalStreams ?? s.streams)}
                      </li>
                    ))}
                  </ul>
                )}

                {trackRows.length > 0 && (
                  <div class="space-y-2 border-t border-base-content/10 pt-3">
                    <p class="text-xs uppercase tracking-wider text-base-content/45">
                      Détail pistes
                    </p>
                    <ul class="space-y-2 text-sm">
                      {trackRows.map((t, i) => {
                        const streams = trackRowStreams(t);
                        return (
                          <li
                            key={t.id ?? t.isrc ?? `${trackRowLabel(t)}-${i}`}
                            class="flex flex-wrap items-center justify-between gap-2 border-b border-base-content/5 pb-2 last:border-0"
                          >
                            <span class="font-medium">{trackRowLabel(t)}</span>
                            <span class="text-base-content/60">
                              {streams != null
                                ? `${formatStreams(streams)} streams`
                                : "—"}
                              {t.isrc ? ` · ${t.isrc}` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p class="text-sm text-base-content/55">
                {deliveryLive
                  ? "Le titre est livré sur les stores — les streams ONCE peuvent mettre 24–72 h+ à arriver (rapport DSP)."
                  : "Pas encore de streams ONCE — clique Rafraîchir, ou attends 24–72 h après la livraison stores."}
              </p>
            )}
          </section>

          <section class="space-y-3">
            <h3 class="font-display flex items-center gap-2 text-lg font-bold">
              <Store size={18} /> Livraison stores
            </h3>
            {!matchedReleaseId ? (
              <p class="text-sm text-base-content/55">
                Lie une release ONCE pour suivre Spotify, Apple Music, etc.
              </p>
            ) : delivery?.error ? (
              <p class="text-sm text-warning">{delivery.error}</p>
            ) : delivery ? (
              <div class="space-y-3 border border-base-content/10 bg-base-200/30 p-4">
                {delivery.identifiers && (
                  <p class="text-sm text-base-content/70">
                    UPC{" "}
                    {delivery.identifiers.upcPending
                      ? "pending"
                      : delivery.identifiers.upc || "—"}
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
                <p class={`text-sm ${storeBadgeClass(delivery.spotifyStatus || delivery.aggregateStatus)}`}>
                  {delivery.aggregateStatus || "—"}
                  {delivery.spotifyStatus ? ` · Spotify: ${delivery.spotifyStatus}` : ""}
                </p>
                {delivery.stores?.length > 0 && (
                  <ul class="flex flex-wrap gap-2 text-xs text-base-content/60">
                    {delivery.stores.map((s) => (
                      <li key={`${s.name}-${s.status}`} class="border border-base-content/10 px-2 py-1">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            class="underline-offset-2 hover:underline"
                          >
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
                <div class="flex flex-wrap gap-2">
                  {delivery.publishing?.canSubmitUnison && delivery.dashboardUrl && (
                    <a
                      class="btn btn-primary btn-sm gap-1"
                      href={delivery.dashboardUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Unison <ExternalLink size={12} />
                    </a>
                  )}
                  {(delivery.spotifyUrl || distrokid?.spotifyUrl) && (
                    <a
                      class="btn btn-outline btn-sm gap-1"
                      href={delivery.spotifyUrl || distrokid.spotifyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Spotify <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <p class="text-sm text-base-content/55">
                Statut stores non sync — clique Rafraîchir (token ONCE dans Paramètres).
              </p>
            )}
          </section>

          {stats.streamsNote && (
            <p class="text-xs text-base-content/45">{stats.streamsNote}</p>
          )}
        </>
      )}
    </section>
  );
}
