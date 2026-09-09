import { getSessionFromCookies, ROLE_ADMIN } from "../../../server/auth.js";
import { json, error } from "../../../server/http.js";
import { planLimitsForEmail } from "../../../server/quotas.js";
import { watermarkCoverBuffer } from "../../../server/exportWatermark.js";

export const prerender = false;

/**
 * GET /api/export/cover?url=… — jaquette (watermark si plan Free).
 */
export async function GET({ url, cookies, request }) {
  try {
    const session = getSessionFromCookies(cookies);
    if (!session?.email) return error("Non autorisé", 401);

    const src = String(url.searchParams.get("url") || "").trim();
    if (!src || !/^https?:\/\//i.test(src) && !src.startsWith("/")) {
      return error("URL jaquette invalide", 400);
    }

    let absolute = src;
    if (src.startsWith("/")) {
      const origin = new URL(request.url).origin;
      absolute = `${origin}${src}`;
    }

    const upstream = await fetch(absolute);
    if (!upstream.ok) {
      return error(`Jaquette introuvable (${upstream.status})`, 502);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());

    const isAdmin = session.role === ROLE_ADMIN;
    let needMark = false;
    if (!isAdmin) {
      const limits = await planLimitsForEmail(session.email);
      needMark = Boolean(limits.watermark);
    }

    const out = needMark ? await watermarkCoverBuffer(buf) : buf;
    const filename = needMark ? "cover-sonozz-free.jpg" : "cover.jpg";

    return new Response(out, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[export/cover]", e?.message || e);
    return error(e.message || "Export impossible", 500);
  }
}
