import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import {
  createSessionToken,
  readSessionToken,
  isPublicPath,
  isAdminOnlyPath,
  sessionCapabilities,
  decidePasswordLogin,
  ROLE_ADMIN,
  ROLE_MEMBER,
} from "../src/server/auth.js";
import {
  hashPassword,
  verifyPassword,
  isPasswordStrongEnough,
  MIN_PASSWORD_LEN,
} from "../src/server/password.js";
import { hashInviteToken, generateInviteToken } from "../src/server/invites.js";
import { resolveRoleForEmail } from "../src/server/users.js";

const AUTH_KEYS = ["AUTH_EMAIL", "AUTH_PASSWORD", "AUTH_SECRET"];
const saved = {};

describe("Invitations / auth multi-comptes", () => {
  before(() => {
    for (const key of AUTH_KEYS) saved[key] = process.env[key];
    process.env.AUTH_EMAIL = "admin@sonozz.test";
    process.env.AUTH_PASSWORD = "admin-secret";
    process.env.AUTH_SECRET = "test-secret-for-invites";
  });

  after(() => {
    for (const key of AUTH_KEYS) {
      if (saved[key] == null) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("hash / verify mot de passe scrypt", () => {
    const hash = hashPassword("motdepasse1");
    assert.match(hash, /^scrypt\$/);
    assert.equal(verifyPassword("motdepasse1", hash), true);
    assert.equal(verifyPassword("autre", hash), false);
    assert.equal(isPasswordStrongEnough("short"), false);
    assert.equal(isPasswordStrongEnough("a".repeat(MIN_PASSWORD_LEN)), true);
  });

  it("hash token d’invitation de façon déterministe", () => {
    const token = generateInviteToken();
    assert.ok(token.length >= 32);
    assert.equal(hashInviteToken(token), hashInviteToken(token));
    assert.notEqual(hashInviteToken(token), hashInviteToken(token + "x"));
  });

  it("session inclut le rôle (admin / member)", () => {
    const adminTok = createSessionToken("admin@sonozz.test", ROLE_ADMIN);
    const admin = readSessionToken(adminTok);
    assert.equal(admin.email, "admin@sonozz.test");
    assert.equal(admin.role, ROLE_ADMIN);

    const memberTok = createSessionToken("invitee@sonozz.test", ROLE_MEMBER);
    const member = readSessionToken(memberTok);
    assert.equal(member.role, ROLE_MEMBER);

    const capsAdmin = sessionCapabilities(ROLE_ADMIN);
    assert.equal(capsAdmin.canManageSettings, true);
    assert.equal(capsAdmin.canInvite, true);

    const capsMember = sessionCapabilities(ROLE_MEMBER);
    assert.equal(capsMember.canManageSettings, false);
    assert.equal(capsMember.canInvite, false);
  });

  it("lit encore les sessions legacy à 4 parties", () => {
    const secret = "test-secret-for-invites";
    const email = "legacy@sonozz.test";
    const exp = Date.now() + 60_000;
    const nonce = randomBytes(8).toString("hex");
    const payload = `${email}|${exp}|${nonce}`;
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    const token = `${payload}|${sig}`;
    const session = readSessionToken(token);
    assert.equal(session.email, email);
    assert.equal(session.role, ROLE_MEMBER);
  });

  it("chemins publics invitation + ACL admin", () => {
    assert.equal(isPublicPath("/rejoindre"), true);
    assert.equal(isPublicPath("/api/invites/accept"), true);
    assert.equal(isPublicPath("/api/invites"), false);

    assert.equal(isAdminOnlyPath("/parametres"), true);
    assert.equal(isAdminOnlyPath("/api/keys"), true);
    assert.equal(isAdminOnlyPath("/lab/ace"), true);
    assert.equal(isAdminOnlyPath("/api/invites"), true);
    assert.equal(isAdminOnlyPath("/api/invites/accept"), false);
    assert.equal(isAdminOnlyPath("/"), false);
  });

  it("AUTH_EMAIL est toujours admin", () => {
    assert.equal(resolveRoleForEmail("admin@sonozz.test"), ROLE_ADMIN);
    assert.equal(resolveRoleForEmail("autre@sonozz.test"), ROLE_MEMBER);
    assert.equal(resolveRoleForEmail("autre@sonozz.test", ROLE_ADMIN), ROLE_ADMIN);
  });

  it("decidePasswordLogin propage le rôle", () => {
    assert.deepEqual(decidePasswordLogin(true, false, ROLE_ADMIN), {
      ok: true,
      role: ROLE_ADMIN,
    });
  });
});
