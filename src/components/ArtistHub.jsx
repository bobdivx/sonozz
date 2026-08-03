import { useEffect, useState } from "preact/hooks";
import {
  ArrowLeft,
  AudioLines,
  BarChart3,
  ExternalLink,
  Music2,
  Plus,
  RefreshCw,
  UserRound,
} from "lucide-preact";

export default function ArtistHub({ slug }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [theme, setTheme] = useState("");
  const [msg, setMsg] = useState("");

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
    setMsg("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh-stats" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Stats KO");
      setData((prev) => (prev ? { ...prev, stats: json.stats } : prev));
      setMsg("Stats mises à jour");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createTrack({ variantOf } = {}) {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch(`/api/artists/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "new-track",
          theme: theme.trim(),
          variantOf: variantOf || null,
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

  const profile = data?.profile || {};
  const stats = data?.stats || {};
  const releases = data?.releases || [];

  return (
    <div class="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <div class="mb-8 flex flex-wrap items-center gap-3">
        <a href="/" class="btn btn-ghost btn-sm gap-1">
          <ArrowLeft size={14} /> Studio
        </a>
        <a href="/artistes" class="btn btn-ghost btn-sm">
          Tous les artistes
        </a>
        <a
          class="btn btn-ghost btn-sm gap-1"
          href="https://once.app/"
          target="_blank"
          rel="noreferrer"
        >
          ONCE <ExternalLink size={12} />
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
            </div>
          </header>

          <section class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
                <BarChart3 size={22} /> Stats
              </h2>
              <button type="button" class="btn btn-outline btn-sm gap-1" disabled={busy} onClick={refreshStats}>
                <RefreshCw size={14} /> Rafraîchir
              </button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
              {[
                ["Morceaux", stats.tracks ?? releases.length],
                ["Avec audio", stats.withAudio ?? 0],
                ["Soumis ONCE", stats.submitted ?? 0],
                ["Distribués", stats.distributed ?? 0],
              ].map(([label, value]) => (
                <div key={label} class="border border-base-content/10 bg-base-200/40 px-4 py-3">
                  <p class="text-xs uppercase tracking-wider text-base-content/45">{label}</p>
                  <p class="font-display text-3xl font-bold">{value}</p>
                </div>
              ))}
            </div>
            <p class="text-xs text-base-content/45">{stats.streamsNote}</p>
          </section>

          <section class="space-y-4">
            <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
              <Plus size={22} /> Nouveau morceau
            </h2>
            <p class="text-sm text-base-content/65">
              Garde le même artiste et lance un nouveau single (paroles → audio → jaquette → ONCE → short).
            </p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <input
                class="input input-bordered flex-1 bg-base-200"
                placeholder="Thème / titre suggéré (ex. nuit d’été, version acoustique…)"
                value={theme}
                onInput={(e) => setTheme(e.currentTarget.value)}
              />
              <button type="button" class="btn btn-primary gap-2" disabled={busy} onClick={() => createTrack()}>
                {busy ? <span class="loading loading-spinner loading-sm" /> : <AudioLines size={16} />}
                Créer dans le studio
              </button>
            </div>
          </section>

          <section class="space-y-4">
            <h2 class="font-display flex items-center gap-2 text-2xl font-bold">
              <Music2 size={22} /> Catalogue
            </h2>
            {releases.length === 0 ? (
              <p class="text-sm text-base-content/55">Aucun morceau encore — crée le premier ci-dessus.</p>
            ) : (
              <ul class="space-y-3">
                {releases.map((r) => (
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
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <a class="btn btn-ghost btn-sm" href={`/?project=${r.id}`}>
                        Ouvrir
                      </a>
                      <button
                        type="button"
                        class="btn btn-outline btn-sm"
                        disabled={busy}
                        onClick={() =>
                          createTrack({ variantOf: r.trackTitle || r.title })
                        }
                      >
                        Variante / suite
                      </button>
                      {r.audioUrl && (
                        <audio controls class="h-8 max-w-[180px]" src={r.audioUrl} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
