import jwt from 'jsonwebtoken';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getTenantSchema } from '../config/tenantContext.js';

export const normalizePhone = phone => String(phone || '').replace(/\D/g, '');
export function issueOnlineProof(scope, claims, expiresIn = '30m') {
  return jwt.sign({ ...claims, tenant: getTenantSchema(), scope }, process.env.JWT_SECRET,
    { expiresIn, audience: 'salon-online', issuer: 'salon-api', algorithm: 'HS256' });
}
export function readOnlineProof(token, scope) {
  try {
    const proof = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'], audience: 'salon-online', issuer: 'salon-api'
    });
    return proof.scope === scope && proof.tenant === getTenantSchema() ? proof : null;
  } catch { return null; }
}
export function phoneProof(req, telefone) {
  const proof = readOnlineProof(req.body?.online_token, 'phone');
  return proof?.phone === normalizePhone(telefone) ? proof : null;
}
// Fits the existing column. The HMAC binds the code to its record and tenant.
export const otpDigest = (id, code) => createHmac('sha256', process.env.JWT_SECRET)
  .update(JSON.stringify([getTenantSchema(), id, String(code).trim()])).digest('base64url').slice(0, 10);
export function matchesOtp(record, code) {
  const expected = Buffer.from(record.codigo_otp);
  const actual = Buffer.from(otpDigest(record.id, code));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
