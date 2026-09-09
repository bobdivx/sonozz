import { useState } from "preact/hooks";

export default function SignupForm({ next = "/studio" }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Inscription impossible");
      const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
      window.location.assign(dest);
    } catch (err) {
      setError(err.message || "Inscription impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="space-y-4" onSubmit={onSubmit}>
      <p class="text-center text-sm text-base-content/55">
        Crée ton compte pour accéder au studio. Tu démarres sur l’offre Free — tu pourras passer Pro quand tu veux.
      </p>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Email
        </span>
        <input
          type="email"
          class="input input-bordered w-full bg-base-200/80"
          required
          autocomplete="username"
          value={email}
          onInput={(e) => setEmail(e.currentTarget.value)}
        />
      </label>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Prénom / nom (optionnel)
        </span>
        <input
          type="text"
          class="input input-bordered w-full bg-base-200/80"
          autocomplete="name"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </label>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Mot de passe (min. 8)
        </span>
        <input
          type="password"
          class="input input-bordered w-full bg-base-200/80"
          required
          minLength={8}
          autocomplete="new-password"
          value={password}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
      </label>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Confirmer
        </span>
        <input
          type="password"
          class="input input-bordered w-full bg-base-200/80"
          required
          minLength={8}
          autocomplete="new-password"
          value={confirm}
          onInput={(e) => setConfirm(e.currentTarget.value)}
        />
      </label>

      {error && (
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" class="btn btn-primary w-full" disabled={busy}>
        {busy ? <span class="loading loading-spinner loading-sm" /> : null}
        Créer mon compte
      </button>

      <p class="text-center text-sm text-base-content/55">
        Déjà un compte ?{" "}
        <a class="link link-primary" href={`/login?next=${encodeURIComponent(next)}`}>
          Se connecter
        </a>
      </p>
    </form>
  );
}
