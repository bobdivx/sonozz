import { useState } from "preact/hooks";
import { Headphones } from "lucide-preact";

function safeNext(raw) {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

export default function LoginForm({ next = "/" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Connexion refusée");
      location.assign(safeNext(next));
    } catch (err) {
      setError(err.message || "Erreur de connexion");
      setLoading(false);
    }
  }

  return (
    <div class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div class="rise-in mb-8 text-center">
        <img
          src="/logo.png"
          alt="SONOZZ"
          class="mx-auto mb-6 h-20 w-20 rounded-2xl object-cover shadow-lg shadow-black/40"
          width="80"
          height="80"
        />
        <h1 class="font-display text-3xl font-bold tracking-tight text-base-content">SONOZZ</h1>
      </div>

      <a
        href="/play"
        class="rise-in group mb-8 block rounded-2xl border border-primary/35 bg-gradient-to-br from-primary/25 via-primary/10 to-secondary/15 p-5 text-center shadow-[0_12px_40px_rgba(201,162,39,0.12)] transition hover:border-primary/60 hover:from-primary/35 hover:via-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        style="animation-delay: 40ms"
      >
        <span class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-content shadow-md shadow-primary/30 transition group-hover:scale-105">
          <Headphones size={22} />
        </span>
        <span class="font-display block text-xl font-bold tracking-tight text-base-content sm:text-2xl">
          Écouter les titres
        </span>
        <span class="mt-1.5 block text-sm text-base-content/70">
          Accès libre — aucune connexion requise
        </span>
        <span class="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-content transition group-hover:bg-primary/90">
          Ouvrir le lecteur
        </span>
      </a>

      <div
        class="rise-in mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-base-content/40"
        style="animation-delay: 80ms"
        aria-hidden="true"
      >
        <span class="h-px flex-1 bg-base-content/15" />
        Studio
        <span class="h-px flex-1 bg-base-content/15" />
      </div>

      <form class="rise-in space-y-4" style="animation-delay: 100ms" onSubmit={onSubmit}>
        <p class="text-center text-sm text-base-content/55">Connexion réservée à l’équipe</p>

        <label class="form-control w-full">
          <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
            Email
          </span>
          <input
            type="email"
            class="input input-bordered w-full bg-base-200/80"
            autocomplete="username"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
          />
        </label>

        <label class="form-control w-full">
          <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
            Mot de passe
          </span>
          <input
            type="password"
            class="input input-bordered w-full bg-base-200/80"
            autocomplete="current-password"
            required
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
        </label>

        {error && (
          <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" class="btn btn-ghost w-full border border-base-content/15" disabled={loading}>
          {loading ? "Connexion…" : "Se connecter au studio"}
        </button>
      </form>
    </div>
  );
}
