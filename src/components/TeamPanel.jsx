import { useEffect, useState } from "preact/hooks";
import { UserPlus, Ban, CheckCircle2, Trash2 } from "lucide-preact";

export default function TeamPanel() {
  const [invites, setInvites] = useState([]);
  const [members, setMembers] = useState([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/invites");
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Chargement impossible");
    setInvites(json.invites || []);
    setMembers(json.members || []);
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  async function invite(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Invitation impossible");
      setEmail("");
      setMessage(`Invitation envoyée à ${json.invite?.email || email}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Révocation impossible");
      setMessage("Invitation révoquée.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setDisabled(memberEmail, disable) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: disable ? "disable" : "enable",
          email: memberEmail,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Action impossible");
      setMessage(disable ? "Membre désactivé." : "Membre réactivé.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = invites.filter((i) => i.status === "pending");

  return (
    <div class="space-y-8">
      <form class="max-w-xl space-y-3 border border-base-content/10 bg-base-200/40 p-4" onSubmit={invite}>
        <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
          Inviter quelqu’un
        </h3>
        <p class="text-sm text-base-content/60">
          L’invité reçoit un email pour définir son mot de passe. Il aura accès au studio, sans les
          paramètres sensibles.
        </p>
        <label class="form-control w-full">
          <span class="label-text mb-1 text-xs text-base-content/50">Email</span>
          <input
            type="email"
            class="input input-bordered w-full bg-base-300/60"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            placeholder="collegue@exemple.com"
          />
        </label>
        <button type="submit" class="btn btn-primary btn-sm gap-2" disabled={busy}>
          {busy ? <span class="loading loading-spinner loading-sm" /> : <UserPlus size={14} />}
          Envoyer l’invitation
        </button>
      </form>

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

      <div class="space-y-3">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
          Invitations en attente
        </h3>
        {pending.length === 0 ? (
          <p class="text-sm text-base-content/50">Aucune invitation en cours.</p>
        ) : (
          <ul class="space-y-2">
            {pending.map((inv) => (
              <li
                key={inv.id}
                class="flex flex-wrap items-center justify-between gap-2 border border-base-content/10 bg-base-200/30 px-3 py-2 text-sm"
              >
                <div>
                  <span class="font-mono">{inv.email}</span>
                  <span class="ml-2 text-xs text-base-content/45">
                    expire {new Date(inv.expiresAt).toLocaleDateString("fr-FR")}
                  </span>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1 text-error"
                  disabled={busy}
                  onClick={() => revoke(inv.id)}
                >
                  <Trash2 size={12} />
                  Révoquer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div class="space-y-3">
        <h3 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
          Membres
        </h3>
        <ul class="space-y-2">
          {members.map((m) => (
            <li
              key={m.id}
              class="flex flex-wrap items-center justify-between gap-2 border border-base-content/10 bg-base-200/30 px-3 py-2 text-sm"
            >
              <div>
                <span class="font-mono">{m.email}</span>
                {m.name ? <span class="ml-2 text-base-content/60">· {m.name}</span> : null}
                <span class="ml-2 rounded bg-base-content/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                  {m.role}
                </span>
                {m.disabledAt ? (
                  <span class="ml-2 text-xs text-error">désactivé</span>
                ) : null}
              </div>
              {m.role !== "admin" ? (
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1"
                  disabled={busy}
                  onClick={() => setDisabled(m.email, !m.disabledAt)}
                >
                  {m.disabledAt ? (
                    <>
                      <CheckCircle2 size={12} /> Réactiver
                    </>
                  ) : (
                    <>
                      <Ban size={12} /> Désactiver
                    </>
                  )}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
