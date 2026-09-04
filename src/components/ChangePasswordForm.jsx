import { useState } from "preact/hooks";

/**
 * Formulaire changement de mot de passe (compte connecté).
 */
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (newPassword !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Échec");
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      setMessage("Mot de passe mis à jour.");
    } catch (err) {
      setError(err.message || "Impossible de changer le mot de passe");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="max-w-xl space-y-4 border border-base-content/10 bg-base-200/40 p-4" onSubmit={onSubmit}>
      <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
        Mot de passe
      </h3>
      <label class="form-control w-full">
        <span class="label-text mb-1 text-xs text-base-content/50">Mot de passe actuel</span>
        <input
          type="password"
          class="input input-bordered w-full bg-base-300/60"
          autocomplete="current-password"
          required
          value={currentPassword}
          onInput={(e) => setCurrentPassword(e.currentTarget.value)}
        />
      </label>
      <label class="form-control w-full">
        <span class="label-text mb-1 text-xs text-base-content/50">Nouveau (min. 8)</span>
        <input
          type="password"
          class="input input-bordered w-full bg-base-300/60"
          autocomplete="new-password"
          minLength={8}
          required
          value={newPassword}
          onInput={(e) => setNewPassword(e.currentTarget.value)}
        />
      </label>
      <label class="form-control w-full">
        <span class="label-text mb-1 text-xs text-base-content/50">Confirmer</span>
        <input
          type="password"
          class="input input-bordered w-full bg-base-300/60"
          autocomplete="new-password"
          minLength={8}
          required
          value={confirm}
          onInput={(e) => setConfirm(e.currentTarget.value)}
        />
      </label>
      {error && (
        <p class="text-sm text-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p class="text-sm text-success" role="status">
          {message}
        </p>
      )}
      <button type="submit" class="btn btn-primary btn-sm" disabled={busy}>
        {busy ? <span class="loading loading-spinner loading-sm" /> : null}
        Enregistrer le mot de passe
      </button>
    </form>
  );
}
