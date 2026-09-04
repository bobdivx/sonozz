import { defineMiddleware } from "astro:middleware";
import {
  getSessionFromCookies,
  isAccessControlEnabled,
  isAdminOnlyPath,
  isPublicPath,
  ROLE_ADMIN,
} from "./server/auth.js";

function withNoStore(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("Pragma", "no-cache");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function forbidden(pathname) {
  if (pathname.startsWith("/api/")) {
    return withNoStore(
      new Response(JSON.stringify({ error: "Accès réservé à l’administrateur" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  return withNoStore(
    new Response(null, {
      status: 302,
      headers: { Location: "/compte" },
    }),
  );
}

/**
 * Auth session + anti-cache HTML / 404
 * (déploiements avec hash d'assets → HTML ou 404 mis en cache = JS/_astro introuvables).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;

  if (isAccessControlEnabled() && !isPublicPath(pathname)) {
    const session = getSessionFromCookies(context.cookies);
    if (!session) {
      // Pour les APIs, retourner 401 immédiatement
      if (pathname.startsWith("/api/")) {
        return withNoStore(
          new Response(JSON.stringify({ error: "Non autorisé" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      // Pour les pages, traiter d'abord la requête pour savoir si la route existe
      const response = await next();

      // Si 404 ou erreur >= 400, laisser passer (ne pas rediriger vers login pour URLs inexistantes)
      if (response.status >= 404) {
        return withNoStore(response);
      }

      // Si la page existe (200, 3xx mais pas 404), page d’accès réservé
      if (response.status < 400) {
        const nextUrl = `${pathname}${search || ""}`;
        return withNoStore(
          context.redirect(`/403?next=${encodeURIComponent(nextUrl)}`),
        );
      }

      // Autres erreurs 400-403, retourner la réponse
      return withNoStore(response);
    }

    // Membres : pas d’accès aux paramètres sensibles
    if (session.role !== ROLE_ADMIN && isAdminOnlyPath(pathname)) {
      return forbidden(pathname);
    }
  }

  const response = await next();

  // Ne jamais laisser CF/navigateur garder un 404 d’asset hashé
  if (response.status >= 400) {
    return withNoStore(response);
  }

  // HTML dynamique : toujours frais (évite d’appeler d’anciens /_astro/*.HASH.js)
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    return withNoStore(response);
  }

  return response;
});
