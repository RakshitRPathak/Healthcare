import crypto from 'node:crypto';
import { config } from './config';

const PREFIX = 'enc:v1:';

/** AES-256-GCM for secrets stored in the database (Google refresh tokens). No key configured -> stored as-is (dev). */
export function encryptSecret(plain: string, keyHex = config.tokenEncKey): string {
  if (!keyHex) return plain;
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must be 64 hex characters');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(stored: string, keyHex = config.tokenEncKey): string {
  if (!stored.startsWith(PREFIX)) return stored;                     // legacy / dev plaintext
  if (!keyHex) throw new Error('encrypted secret found but TOKEN_ENC_KEY is not set');
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}
