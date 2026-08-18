import { useEffect, useState } from "preact/hooks";
import { Link2, Unlink } from "lucide-preact";

const ERRORS = {
  sso_mismatch: "L’email Pocket ID ne correspond pas à ce compte.",
  sso: "Liaison Pocket ID impossible. Réessaie.",
};

export default function PocketIdAccount() {
  const [email, setEmail] = useState("");
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [ssoLinked, setSsoLinked] = useState(false);
  const [ssoLinkedAt, setSsoLinkedAt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pocket") === "linked") {
      setMessage("Pocket ID lié — la prochaine connexion passera par le SSO.");
      window.history.replaceState({}, "", "/parametres?section=compte");
    }
    const err = params.get("error");
    if (err && ERRORS[err]) {
      setMessage(ERRORS[err]);
      window.history.replaceState({}, "", "/parametres?section=compte");
    }

    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setEmail(d.email || "");
        setOidcConfigured(Boolean(d.oidcConfigured));
        setSsoLinked(Boolean(d.ssoLinked));
        setSsoLinkedAt(d.ssoLinkedAt || null);
      })
      .catch(() => {});
  }, []);

  async function unlink() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/auth/pocket-id", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Déliaison impossible");
      setSsoLinked(false);
      setSsoLinkedAt(null);
      setMessage("Pocket ID délié — le mot de passe est de nouveau disponible pour ce compte.");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!oidcConfigured) {
    return (
      <p class="text-sm text-base-content/55">
        Pocket ID n’est pas configuré sur ce déploiement (variables OIDC_* absentes).
      </p>
    );
  }

  return (
    <div class="max-w-xl space-y-4 border border-base-content/10 bg-base-200/40 p-4">
      <p class="text-sm text-base-content/70">
        Compte : <span class="font-mono text-base-content">{email || "—"}</span>
      </p>
      {ssoLinked ? (
        <>
          <p class="text-sm text-success">
            Pocket ID lié{ssoLinkedAt ? ` le ${new Date(ssoLinkedAt).toLocaleString("fr-FR")}` : ""}.
            La connexion mot de passe est désactivée pour ce compte.
          </p>
          <button type="button" class="btn btn-outline btn-sm gap-2" disabled={busy} onClick={unlink}>
            {busy ? <span class="loading loading-spinner loading-sm" /> : <Unlink size={14} />}
            Délier Pocket ID
          </button>
        </>
      ) : (
        <>
          <p class="text-sm text-base-content/60">
            Optionnel. Une fois lié, ce compte se connecte uniquement avec Pocket ID.
          </p>
          <a href="/api/auth/pocket-id?intent=link" class="btn btn-primary btn-sm gap-2">
            <Link2 size={14} />
            Lier Pocket ID
          </a>
        </>
      )}
      {message && <p class="text-sm text-primary">{message}</p>}
    </div>
  );
}
