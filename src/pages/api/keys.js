import { json, error, readBody } from "../../server/http.js";
import { getUserKeys, saveUserKeys } from "../../server/db.js";

export const prerender = false;

export async function GET() {
  try {
    const keys = await getUserKeys();
    return json({
      keys: keys || null,
      source: keys ? "turso" : "empty",
    });
  } catch (e) {
    return error(e.message || "Lecture clés Turso impossible", 500);
  }
}

/** Enregistre (ou migre) le blob de clés vers Turso. */
export async function POST(context) {
  try {
    const body = await readBody(context.request);
    const keys = body?.keys;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
      return error("Body { keys } requis", 400);
    }
    const result = await saveUserKeys(keys);
    return json({ ok: true, ...result, source: "turso" });
  } catch (e) {
    return error(e.message || "Écriture clés Turso impossible", 500);
  }
}

export async function PUT(context) {
  return POST(context);
}
