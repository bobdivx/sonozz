import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;
const MIN_PASSWORD_LEN = 8;

/**
 * Format stocké : scrypt$N$r$p$saltHex$hashHex
 */
export function hashPassword(password) {
  const plain = String(password || "");
  if (plain.length < MIN_PASSWORD_LEN) {
    throw new Error(`Mot de passe trop court (min. ${MIN_PASSWORD_LEN})`);
  }
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password, stored) {
  const raw = String(stored || "");
  const parts = raw.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (!salt.length || !expected.length || !Number.isFinite(N)) return false;
  try {
    const actual = scryptSync(String(password || ""), salt, expected.length, { N, r, p });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function isPasswordStrongEnough(password) {
  return String(password || "").length >= MIN_PASSWORD_LEN;
}

export { MIN_PASSWORD_LEN };
