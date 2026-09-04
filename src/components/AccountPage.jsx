import { useEffect, useState } from "preact/hooks";
import AppShell from "./AppShell.jsx";
import PocketIdAccount from "./PocketIdAccount.jsx";
import ChangePasswordForm from "./ChangePasswordForm.jsx";

/**
 * Page compte pour les membres (pas d’accès /parametres).
 */
export default function AccountPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [canManageSettings, setCanManageSettings] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.authenticated) {
          window.location.assign("/login?next=/compte");
          return;
        }
        setEmail(d.email || "");
        setRole(d.role || "member");
        setCanManageSettings(Boolean(d.canManageSettings));
        if (d.canManageSettings) {
          window.location.assign("/parametres?section=compte");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <AppShell active="compte" title="Mon compte" subtitle="Gère ton accès au studio.">
      <div class="mx-auto max-w-xl space-y-8">
        <p class="text-sm text-base-content/70">
          Connecté en tant que <span class="font-mono text-base-content">{email || "…"}</span>
          <span class="ml-2 rounded bg-base-content/10 px-1.5 py-0.5 text-[10px] uppercase">
            {role}
          </span>
        </p>

        <ChangePasswordForm />

        <div>
          <h2 class="mb-3 text-sm font-semibold uppercase tracking-wider text-base-content/50">
            Connexion SSO
          </h2>
          <PocketIdAccount accountPath="/compte" />
        </div>

        {canManageSettings ? (
          <p class="text-sm text-base-content/50">
            <a class="link" href="/parametres">
              Ouvrir les paramètres
            </a>
          </p>
        ) : (
          <p class="text-sm text-base-content/45">
            Les clés API et réglages sensibles sont réservés à l’administrateur du studio.
          </p>
        )}
      </div>
    </AppShell>
  );
}
