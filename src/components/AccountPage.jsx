import { useEffect, useState } from "preact/hooks";
import AppShell from "./AppShell.jsx";
import PocketIdAccount from "./PocketIdAccount.jsx";
import ChangePasswordForm from "./ChangePasswordForm.jsx";
import { PageHeader, SectionCard } from "./ui/index.js";

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
    <AppShell active="compte">
      <div class="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Compte"
          title="Mon compte"
          description="Gère ton accès, ton abonnement et ta connexion."
        />

        <div class="space-y-8">
          <p class="text-sm text-base-content/70">
            Connecté en tant que{" "}
            <span class="font-mono text-base-content">{email || "…"}</span>
            <span class="ml-2 rounded-full bg-base-content/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">
              {role}
            </span>
          </p>

          <SectionCard
            tone="solid"
            title="Abonnement"
            description="Passe Pro, achète des crédits ou gère ton abo Stripe."
          >
            <a href="/billing" class="btn btn-primary rounded-full px-6">
              Ouvrir la facturation
            </a>
          </SectionCard>

          <ChangePasswordForm />

          <SectionCard tone="solid" eyebrow="Connexion" title="SSO">
            <PocketIdAccount accountPath="/compte" />
          </SectionCard>

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
      </div>
    </AppShell>
  );
}
