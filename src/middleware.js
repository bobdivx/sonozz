import { defineMiddleware } from "astro:middleware";

/**
 * Empêche Cloudflare / reverse-proxy de cacher les 404
 * (déploiements avec hash d'assets → 404 temporaire mis en cache = site sans CSS/JS).
 */
export const onRequest = defineMiddleware(async (_context, next) => {
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
