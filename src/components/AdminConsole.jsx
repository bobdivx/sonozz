import { useEffect, useState } from "preact/hooks";
import AppShell from "./AppShell.jsx";
import { PageHeader, AlertBanner, SectionCard } from "./ui/index.js";

function StatCard({ label, value, hint }) {
  return (
    <div class="rounded-3xl border border-base-content/10 bg-gradient-to-br from-base-200/80 via-base-100/50 to-primary/5 p-5 sm:p-6">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">{label}</p>
      <p class="mt-2 font-display text-3xl font-extrabold tracking-tight text-base-content">
        {value === null || value === undefined ? "—" : value}
      </p>
      {hint ? <p class="mt-1 text-sm text-base-content/50">{hint}</p> : null}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return String(iso);
  }
}

function Num({ label, value, onChange, min = 0 }) {
  return (
    <label class="form-control w-full">
      <span class="label-text mb-1 text-sm text-base-content/60">{label}</span>
      <input
        type="number"
        class="input input-bordered h-11 w-full bg-base-200"
        min={min}
        value={value}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}

export default function AdminConsole() {
  const [stats, setStats] = useState(null);
  const [plans, setPlans] = useState(null);
  const [users, setUsers] = useState([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingPlans, setSavingPlans] = useState(false);

  async function reload() {
    setErr("");
    const [s, p, u] = await Promise.all([
      fetch("/api/admin/stats").then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `stats ${r.status}`);
        return d;
      }),
      fetch("/api/admin/plans").then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `plans ${r.status}`);
        return d;
      }),
      fetch("/api/admin/users").then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `users ${r.status}`);
        return d;
      }),
    ]);
    setStats(s);
    setPlans(p.plans);
    setUsers(u.users || []);
  }

  useEffect(() => {
    let cancelled = false;
    reload()
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

  async function savePlans() {
    setSavingPlans(true);
    setMsg("");
    setErr("");
    try {
      const res = await fetch("/api/admin/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plans }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlans(data.plans);
      setMsg("Plans enregistrés — landing / billing utilisent ces quotas.");
    } catch (e) {
      setErr(e.message || "Sauvegarde plans KO");
    } finally {
      setSavingPlans(false);
    }
  }

  async function patchUser(email, patch) {
    setErr("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, ...patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(`Utilisateur ${email} mis à jour`);
      await reload();
    } catch (e) {
      setErr(e.message || "Maj user KO");
    }
  }

  return (
    <AppShell active="admin">
      <div class="mx-auto max-w-5xl">
        <PageHeader
          eyebrow="Console"
          title="Admin"
          description="Métriques, plans, crédits et utilisateurs."
        />

        <div class="space-y-8">
      {loading && <p class="text-sm text-base-content/60">Chargement…</p>}
      {err && <AlertBanner tone="error">{err}</AlertBanner>}
      {msg && <AlertBanner tone="success">{msg}</AlertBanner>}

      {stats && (
        <section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Utilisateurs" value={stats.users} />
          <StatCard label="Artistes" value={stats.artists} />
          <StatCard label="Titres / projets" value={stats.tracks} />
          <StatCard label="Événements" value={stats.events ?? stats.generations} />
        </section>
      )}

      {plans && (
        <SectionCard
          eyebrow="Offres"
          title="Plans & crédits"
          description={`1 crédit = 1 ${plans.creditUnitLabel || "génération de titre"}. Affiché sur la landing et /billing.`}
          actions={
            <button
              type="button"
              class="btn btn-primary rounded-full px-5"
              disabled={savingPlans}
              onClick={savePlans}
            >
              {savingPlans ? "Enregistrement…" : "Enregistrer les plans"}
            </button>
          }
        >
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="rounded-2xl border border-base-content/10 bg-base-100/80 p-5">
              <h3 class="font-display font-semibold">Free</h3>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Num
                  label="Artistes max"
                  value={plans.free.artists}
                  onChange={(v) => setPlans({ ...plans, free: { ...plans.free, artists: v } })}
                />
                <Num
                  label="Albums max"
                  value={plans.free.albums}
                  onChange={(v) => setPlans({ ...plans, free: { ...plans.free, albums: v } })}
                />
                <Num
                  label="Crédits / mois"
                  value={plans.free.creditsPerMonth}
                  onChange={(v) => setPlans({ ...plans, free: { ...plans.free, creditsPerMonth: v } })}
                />
              </div>
              <label class="label cursor-pointer justify-start gap-2 mt-2">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  checked={Boolean(plans.free.watermark)}
                  onChange={(e) =>
                    setPlans({ ...plans, free: { ...plans.free, watermark: e.currentTarget.checked } })
                  }
                />
                <span class="label-text text-sm">Watermark</span>
              </label>
            </div>

            <div class="rounded-2xl border border-primary/30 bg-base-100/80 p-5">
              <h3 class="font-display font-semibold">Pro ({plans.pro.priceLabel})</h3>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Num
                  label="Artistes max"
                  value={plans.pro.artists}
                  onChange={(v) => setPlans({ ...plans, pro: { ...plans.pro, artists: v } })}
                />
                <Num
                  label="Albums max"
                  value={plans.pro.albums}
                  onChange={(v) => setPlans({ ...plans, pro: { ...plans.pro, albums: v } })}
                />
                <Num
                  label="Crédits / mois"
                  value={plans.pro.creditsPerMonth}
                  onChange={(v) => setPlans({ ...plans, pro: { ...plans.pro, creditsPerMonth: v } })}
                />
                <Num
                  label="Prix € / mois"
                  value={plans.pro.priceMonthlyEur}
                  onChange={(v) =>
                    setPlans({
                      ...plans,
                      pro: {
                        ...plans.pro,
                        priceMonthlyEur: v,
                        priceLabel: `${v} €/mois`,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div class="rounded-2xl border border-base-content/10 bg-base-100/80 p-5">
              <h3 class="font-display font-semibold">Pack crédits</h3>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Num
                  label="Crédits du pack"
                  value={plans.creditsPack.credits}
                  onChange={(v) =>
                    setPlans({ ...plans, creditsPack: { ...plans.creditsPack, credits: v } })
                  }
                />
                <Num
                  label="Prix €"
                  value={plans.creditsPack.priceEur}
                  onChange={(v) =>
                    setPlans({
                      ...plans,
                      creditsPack: {
                        ...plans.creditsPack,
                        priceEur: v,
                        priceLabel: `${v} €`,
                      },
                    })
                  }
                />
              </div>
            </div>

            <div class="rounded-2xl border border-base-content/10 bg-base-100/80 p-5">
              <h3 class="font-display font-semibold">Publish+</h3>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Num
                  label="Prix € / mois"
                  value={plans.publishPlus.priceMonthlyEur}
                  onChange={(v) =>
                    setPlans({
                      ...plans,
                      publishPlus: {
                        ...plans.publishPlus,
                        priceMonthlyEur: v,
                        priceLabel: `${v} €/mois`,
                      },
                    })
                  }
                />
              </div>
              <p class="mt-2 text-xs text-base-content/55">
                Add-on DistroKid — pas de crédits. Les Price IDs Stripe restent dans les env DevForge.
              </p>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        eyebrow="Comptes"
        title="Utilisateurs & crédits"
        description="Ajuste le plan ou les crédits d’un compte."
        bodyClass="!p-0"
      >
        <div class="overflow-x-auto">
          <table class="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Plan</th>
                <th>Crédits</th>
                <th>Publish+</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colspan="5" class="text-base-content/50">
                    Aucun utilisateur
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id || u.email}>
                    <td class="font-mono text-xs">
                      {u.email}
                      <div class="text-[10px] text-base-content/45">{formatDate(u.createdAt)}</div>
                    </td>
                    <td>
                      <select
                        class="select select-bordered select-sm"
                        value={u.plan || "free"}
                        onChange={(e) => patchUser(u.email, { plan: e.currentTarget.value })}
                      >
                        <option value="free">free</option>
                        <option value="pro">pro</option>
                      </select>
                    </td>
                    <td class="font-mono">{u.credits ?? 0}</td>
                    <td>{u.publishPlus ? "oui" : "non"}</td>
                    <td class="whitespace-nowrap">
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm rounded-full"
                        onClick={() => patchUser(u.email, { creditsDelta: 10 })}
                      >
                        +10 crédits
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-sm rounded-full"
                        onClick={() => patchUser(u.email, { credits: 0 })}
                      >
                        Reset crédits
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
        </div>
      </div>
    </AppShell>
  );
}
