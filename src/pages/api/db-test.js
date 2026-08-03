import { json, error } from "../../server/http.js";
import { testDb } from "../../server/db.js";

export const prerender = false;

export async function GET() {
  try {
    const result = await testDb();
    return json(result);
  } catch (e) {
    return error(e.message || "Erreur Turso", 500);
  }
}
