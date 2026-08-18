import { json } from "../../../server/http.js";
import { isOidcConfigured } from "../../../server/oidc.js";
import { isSsoLinkedEmail } from "../../../server/users.js";

export const prerender = false;

export async function GET({ url }) {
  const email = String(url.searchParams.get("email") || "")
    .trim()
    .toLowerCase();
  const oidcConfigured = isOidcConfigured();
  if (!email || !oidcConfigured) {
    return json({ oidcConfigured, ssoLinked: false });
  }
  const ssoLinked = await isSsoLinkedEmail(email);
  return json({ oidcConfigured, ssoLinked });
}
