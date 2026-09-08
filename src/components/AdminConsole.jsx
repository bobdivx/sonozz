import { useEffect, useState } from "preact/hooks";
import AppShell from "./AppShell.jsx";

function StatCard({ label, value, hint }) {
  return (
    <div class="rounded-2xl border border-base-content/10 bg-base-200/60 p-5 shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-base-content/45">{label}</p>
      <p class="mt-2 font-display text-3xl font-extrabold tracking-tight text-base-content">
        {value === null || value === undefined ? "—" : value}
      </p>
      {hint ? <p class="mt-1 text-xs text-base-content/50">{hint}</p> : null}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

export default function AdminConsole() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/stats")
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
        return data;
      })
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || "Chargement impossible");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      active="admin"
      title="Admin"
      subtitle="Métriques produit — réservé au propriétaire"
    >
      {loading && (
        <p class="text-sm text-base-content/60">Chargement des métriques…</p>
      )}
      {err && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {err}
        </p>
      )}
      {stats && (
        <div class="space-y-8">
          <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Utilisateurs" value={stats.users} hint="Table users" />
            <StatCard label="Artistes" value={stats.artists} hint="Noms distincts (projets)" />
            <StatCard label="Titres / projets" value={stats.tracks} hint="Table projects" />
            <StatCard
              label="Événements"
              value={stats.events ?? stats.generations}
              hint="project_events (jobs / générations)"
            />
          </section>

          <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="Pistes album"
              value={stats.albumTracks}
              hint="Table album_tracks"
            />
            <StatCard label="MRR" value={null} hint={stats.stripeNote || "à brancher"} />
            <StatCard label="Churn" value={null} hint={stats.stripeNote || "à brancher"} />
          </section>

          <section class="rounded-2xl border border-base-content/10 bg-base-200/40 p-5">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-display text-lg font-bold">Entonnoir & ops</h2>
              <a class="btn btn-sm btn-outline" href="/parametres">
                Ouvrir Paramètres
              </a>
            </div>
            <p class="text-sm text-base-content/60">
              Facturation Stripe, MRR et churn : placeholders — à brancher plus tard.
              Aucune intégration paiement dans cette version.
            </p>
          </section>

          <section class="overflow-hidden rounded-2xl border border-base-content/10">
            <div class="border-b border-base-content/10 bg-base-200/60 px-4 py-3">
              <h2 class="font-display text-lg font-bold">Derniers utilisateurs</h2>
            </div>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Créé le</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats.recentUsers || []).length === 0 ? (
                    <tr>
                      <td colspan="2" class="text-base-content/50">
                        Aucun utilisateur
                      </td>
                    </tr>
                  ) : (
                    (stats.recentUsers || []).map((u) => (
                      <tr key={u.email + String(u.createdAt)}>
                        <td class="font-mono text-xs sm:text-sm">{u.email}</td>
                        <td class="text-base-content/70">{formatDate(u.createdAt)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
