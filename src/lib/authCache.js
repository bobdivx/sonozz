/**
 * Cache client de /api/auth/me — évite le flash AppShell invité → connecté
 * (sensation de « page chargée deux fois »).
 */

const KEY = "sonozz-auth-v1";

/**
 * @returns {{ authenticated: boolean, email: string | null, canManageSettings: boolean } | null}
 */
export function readAuthCache() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data?.authenticated !== "boolean") return null;
    return {
      authenticated: data.authenticated,
      email: data.email || null,
      canManageSettings: Boolean(data.canManageSettings),
    };
  } catch {
    return null;
  }
}

export function writeAuthCache(payload) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        authenticated: Boolean(payload?.authenticated),
        email: payload?.email || null,
        canManageSettings: Boolean(payload?.canManageSettings),
        at: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function clearAuthCache() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
