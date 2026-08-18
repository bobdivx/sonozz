import { defineMiddleware } from "astro:middleware";
import {
  getSessionFromCookies,
  isAccessControlEnabled,
  isPublicPath,
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

/**
 * Auth session + anti-cache HTML / 404
 * (déploiements avec hash d'assets → HTML ou 404 mis en cache = JS/_astro introuvables).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;

  if (isAccessControlEnabled() && !isPublicPath(pathname)) {
    const session = getSessionFromCookies(context.cookies);
    if (!session) {
      if (pathname.startsWith("/api/")) {
        return withNoStore(
          new Response(JSON.stringify({ error: "Non autorisé" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      const nextUrl = `${pathname}${search || ""}`;
      return withNoStore(
        context.redirect(`/login?next=${encodeURIComponent(nextUrl)}`),
      );
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
