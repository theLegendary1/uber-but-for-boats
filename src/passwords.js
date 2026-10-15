import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Accounts made with Google have no password until they set one with "Forgot password". */
export const NO_PASSWORD = '!';

export async function checkPassword(password, stored) {
  if (!stored.startsWith('scrypt$')) return false;
  const [, salt, key] = stored.split('$');
  const got = await scryptAsync(password, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(got, Buffer.from(key, 'hex'));
}
