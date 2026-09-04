import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSessionToken,
  decidePasswordLogin,
  isPublicPath,
  readSessionToken,
  SSO_PASSWORD_BLOCKED,
} from "../src/server/auth.js";
import {
  buildOidcAuthorizeUrl,
  claimsFromOidcTokens,
  decodeJwtPayload,
  getOidcConfig,
  isOidcConfigured,
} from "../src/server/oidc.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const saved = {};
const OIDC_KEYS = [
  "OIDC_ISSUER",
  "OIDC_ISSUER_URL",
  "OIDC_DISCOVERY_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_SCOPES",
  "POCKET_ID_URL",
  "AUTH_POCKET_ID_ID",
  "AUTH_POCKET_ID_SECRET",
  "AUTH_POCKET_ID_ISSUER",
];

function setEnv(map) {
  for (const [key, value] of Object.entries(map)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("Pocket ID SSO optionnel", () => {
  before(() => {
    for (const key of OIDC_KEYS) saved[key] = process.env[key];
  });

  after(() => {
    setEnv(saved);
  });

  it("lit OIDC_* sans URL Pocket ID en dur", () => {
    setEnv({
      OIDC_ISSUER: "https://issuer.example.test",
      OIDC_CLIENT_ID: "client-a",
      OIDC_CLIENT_SECRET: "secret-a",
      OIDC_SCOPES: "openid email profile",
      AUTH_POCKET_ID_ISSUER: "https://should-not-win.example",
      AUTH_POCKET_ID_ID: "other",
      AUTH_POCKET_ID_SECRET: "other-secret",
      POCKET_ID_URL: "https://also-not.example",
    });
    const cfg = getOidcConfig();
    assert.equal(cfg.issuer, "https://issuer.example.test");
    assert.equal(cfg.clientId, "client-a");
    assert.equal(cfg.clientSecret, "secret-a");
    assert.equal(cfg.scopes, "openid email profile");
    assert.equal(
      cfg.discoveryUrl,
      "https://issuer.example.test/.well-known/openid-configuration",
    );
    assert.equal(isOidcConfigured(), true);
  });

  it("accepte les alias Auth.js AUTH_POCKET_ID_*", () => {
    setEnv({
      OIDC_ISSUER: "",
      OIDC_ISSUER_URL: "",
      OIDC_DISCOVERY_URL: "",
      OIDC_CLIENT_ID: "",
      OIDC_CLIENT_SECRET: "",
      OIDC_SCOPES: "",
      POCKET_ID_URL: "",
      AUTH_POCKET_ID_ISSUER: "https://alias.example.test",
      AUTH_POCKET_ID_ID: "authjs-id",
      AUTH_POCKET_ID_SECRET: "authjs-secret",
    });
    const cfg = getOidcConfig();
    assert.equal(cfg.issuer, "https://alias.example.test");
    assert.equal(cfg.clientId, "authjs-id");
    assert.equal(cfg.clientSecret, "authjs-secret");
    assert.equal(isOidcConfigured(), true);
  });

  it("ne hardcode pas l’issuer Pocket ID dans le runtime", () => {
    const files = [
      "src/server/oidc.js",
      "src/server/auth.js",
      "src/server/users.js",
      "src/pages/api/auth/pocket-id.js",
      "src/pages/api/auth/callback/pocket-id.js",
      "src/components/LoginForm.jsx",
      "src/components/PocketIdAccount.jsx",
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8");
      assert.equal(
        /id\.briseteia\.me/.test(src),
        false,
        `${rel} contient une URL Pocket ID en dur`,
      );
    }
  });

  it("laisse publics les endpoints OIDC", () => {
    assert.equal(isPublicPath("/api/auth/pocket-id"), true);
    assert.equal(isPublicPath("/api/auth/callback/pocket-id"), true);
    assert.equal(isPublicPath("/api/auth/sso-status"), true);
    assert.equal(isPublicPath("/login"), true);
    assert.equal(isPublicPath("/403"), true);
  });

  it("refuse le mot de passe uniquement si CE user a lié le SSO", () => {
    assert.deepEqual(decidePasswordLogin(true, false), { ok: true, role: "member" });
    assert.deepEqual(decidePasswordLogin(true, true), {
      ok: false,
      reason: "sso_required",
    });
    assert.deepEqual(decidePasswordLogin(false, true), {
      ok: false,
      reason: "invalid",
    });
    assert.equal(SSO_PASSWORD_BLOCKED, "Ce compte se connecte avec Pocket ID");
  });

  it("accepte une session HMAC pour un email SSO (pas seulement AUTH_EMAIL)", () => {
    const token = createSessionToken("sso.user@example.test");
    const session = readSessionToken(token);
    assert.equal(session.email, "sso.user@example.test");
    assert.equal(session.role, "member");
  });

  it("extrait email + sub depuis userinfo / id_token", () => {
    const payload = Buffer.from(
      JSON.stringify({ email: "From.JWT@Example.TEST", sub: "jwt-sub" }),
    ).toString("base64url");
    const jwt = `hdr.${payload}.sig`;
    assert.deepEqual(decodeJwtPayload(jwt).email, "From.JWT@Example.TEST");
    const claims = claimsFromOidcTokens(
      { id_token: jwt },
      { email: "user@example.test", sub: "pocket-sub-1" },
    );
    assert.equal(claims.email, "user@example.test");
    assert.equal(claims.sub, "pocket-sub-1");
  });

  it("construit l’authorize URL avec PKCE et le client env", () => {
    const url = new URL(
      buildOidcAuthorizeUrl({
        authorizationEndpoint: "https://issuer.example.test/authorize",
        clientId: "env-client",
        redirectUri: "https://app.example.test/api/auth/callback/pocket-id",
        scopes: "openid email profile",
        state: "st",
        codeChallenge: "ch",
        nonce: "n",
      }),
    );
    assert.equal(url.searchParams.get("client_id"), "env-client");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.match(url.searchParams.get("redirect_uri"), /\/api\/auth\/callback\/pocket-id$/);
  });
});
