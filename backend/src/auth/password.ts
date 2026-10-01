import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'crypto';

/**
 * Password hashing with scrypt (Node built-in). Stored as "scrypt$N$r$p$salt$key" (base64 salt/key), so the
 * cost parameters travel with each hash and can be raised later without breaking existing accounts.
 */

// OWASP minimum for scrypt: N=2^17, r=8, p=1 (128 MiB). maxmem must exceed 128 * N * r bytes.
const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

function scrypt(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, { ...opts, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Constant-time check. Returns false (never throws) for a wrong password or a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, key] = stored.split('$');
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (alg !== 'scrypt' || !salt || !key || !Object.values(params).every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(key, 'base64');
  if (expected.length === 0) return false;
  try {
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Verified against when an email is unknown, so response time doesn't reveal which accounts exist. */
export const DUMMY_PASSWORD_HASH = 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

/** Readable random password for provisioning, e.g. "k7qp-3mxa-9vtr-h2zd" (~80 bits). */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const chars = Array.from({ length: 16 }, () => alphabet[randomInt(alphabet.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}
