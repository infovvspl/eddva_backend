import { randomInt } from 'crypto';

/**
 * Characters a temp password can be made of. Excludes 0/O and 1/l/I —
 * every one of these passwords is meant to be readable off a printed
 * slip or an email and typed back in by hand, and those pairs are the
 * ones people actually mistype.
 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Cryptographically random temp password — replaces the old
 * `Math.random().toString(36).substring(2, 10)` generator, which was
 * neither cryptographically random nor ambiguous-character-safe.
 * Every "send credentials" flow (parent portal login, student login) goes
 * through this one implementation.
 */
export function generateTempPassword(length = 10): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}
