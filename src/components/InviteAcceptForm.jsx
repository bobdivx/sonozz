import { useEffect, useState } from "preact/hooks";

const REASON_MSG = {
  invalid: "Lien d’invitation invalide.",
  revoked: "Cette invitation a été révoquée.",
  accepted: "Cette invitation a déjà été utilisée.",
  expired: "Cette invitation a expiré. Demande un nouvel email.",
};

export default function InviteAcceptForm({ token: tokenProp = "" }) {
  const [token, setToken] = useState(tokenProp);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState("loading"); // loading | ready | error | done
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t =
      tokenProp ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("token") || ""
        : "");
    setToken(t);
    if (!t) {
      setStatus("error");
      setError("Lien incomplet — token manquant.");
      return;
    }
    fetch(`/api/invites/accept?token=${encodeURIComponent(t)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok || !j.ok) {
          setStatus("error");
          setError(REASON_MSG[j.reason] || j.error || "Invitation invalide");
          if (j.email) setEmail(j.email);
          return;
        }
        setEmail(j.email || "");
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setError("Impossible de vérifier l’invitation.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tokenProp]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, name: name || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Acceptation impossible");
      setStatus("done");
      window.location.assign("/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading") {
    return (
      <p class="text-center text-sm text-base-content/55">
        <span class="loading loading-spinner loading-sm mr-2" />
        Vérification de l’invitation…
      </p>
    );
  }

  if (status === "error") {
    return (
      <div class="space-y-4 text-center">
        <p class="rounded-md bg-error/15 px-3 py-2 text-sm text-error" role="alert">
          {error}
        </p>
        <a href="/login" class="btn btn-ghost btn-sm">
          Retour à la connexion
        </a>
      </div>
    );
  }

  return (
    <form class="space-y-4" onSubmit={onSubmit}>
      <p class="text-center text-sm text-base-content/55">
        Définis ton mot de passe pour rejoindre le studio
        {email ? (
          <>
            {" "}
            en tant que <span class="font-mono text-base-content">{email}</span>
          </>
        ) : null}
        .
      </p>

      <label class="form-control w-full">
        <span class="label-text mb-1.5 text-xs uppercase tracking-wider text-base-content/50">
          Prénom / nom (optionnel)
        </span>
        <input
          type="text"
          class="input input-bordered w-full bg-base-200/80"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          autocomplete="name"
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
        Rejoindre le studio
      </button>
    </form>
  );
}
