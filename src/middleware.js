import { defineMiddleware } from "astro:middleware";
import {
  getSessionFromCookies,
  isAuthConfigured,
  isPublicPath,
} from "./server/auth.js";

/**
 * Auth session + empêche Cloudflare / reverse-proxy de cacher les 404
 * (déploiements avec hash d'assets → 404 temporaire mis en cache = site sans CSS/JS).
 */
export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;

  if (isAuthConfigured() && !isPublicPath(pathname)) {
    const session = getSessionFromCookies(context.cookies);
    if (!session) {
      if (pathname.startsWith("/api/")) {
        return new Response(JSON.stringify({ error: "Non autorisé" }), {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }
      const nextUrl = `${pathname}${search || ""}`;
      return context.redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }
  }

  const response = await next();
  if (response.status >= 400) {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    headers.set("CDN-Cache-Control", "no-store");
    headers.set("Cloudflare-CDN-Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
});
