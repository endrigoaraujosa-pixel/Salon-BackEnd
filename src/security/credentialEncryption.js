import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { getTenantSchema } from '../config/tenantContext.js';
const prefix = 'b2enc:v1:';
function encryptionKey() {
  const value = process.env.B2_CREDENTIAL_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(value)) {
    throw Object.assign(new Error('Configure B2_CREDENTIAL_ENCRYPTION_KEY no servidor (64 caracteres hexadecimais).'), { status: 503 });
  }
  return Buffer.from(value, 'hex');
}
export function encryptCredential(value, tenant = getTenantSchema()) {
  if (!value) return value;
  if (value.startsWith(prefix)) { decryptCredential(value, tenant); return value; }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`b2:${tenant || 'public'}`));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return prefix + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptCredential(value, tenant = getTenantSchema()) {
  // Read legacy credentials during the additive migration; all new writes encrypt.
  if (!value || !value.startsWith(prefix)) return value;
  const data = Buffer.from(value.slice(prefix.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(`b2:${tenant || 'public'}`));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
