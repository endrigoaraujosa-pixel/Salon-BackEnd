import { createHash, createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import { getAuthSessionModel } from '../models/AuthSession.js';
import { getTenantSchema } from '../config/tenantContext.js';
import { sequelize } from '../config/db.js';

const refreshSecret = () => process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_refresh';
const hash = value => createHash('sha256').update(value).digest('hex');
const passwordVersion = user => createHmac('sha256', process.env.JWT_SECRET).update(user.password_hash).digest('hex');
const signRefresh = session => jwt.sign({ sub: session.user_id, tenant: getTenantSchema(), sid: session.id,
  iat: Math.floor(new Date(session.rotated_at).getTime() / 1000), exp: Math.floor(new Date(session.expires_at).getTime() / 1000)
}, refreshSecret(), { algorithm: 'HS256' });
export const sessionValid = (session, user) => Boolean(session && session.user_id === user.id && !session.revoked_at &&
  new Date(session.expires_at).getTime() > Date.now() && session.password_version === passwordVersion(user));

export async function createSession(user) {
  const model = getAuthSessionModel();
  await model.destroy({ where: { expires_at: { [Op.lt]: new Date() } } });
  const session = { id: randomUUID(), user_id: user.id, password_version: passwordVersion(user),
    rotated_at: new Date(), expires_at: new Date(Date.now() + 86400000), previous_hash: null, revoked_at: null };
  const token = signRefresh(session);
  await model.create({ ...session, refresh_hash: hash(token) });
  return { sid: session.id, token };
}
export async function validateAccessSession(decoded, user) {
  if (!decoded.sid) return false;
  return sessionValid(await getAuthSessionModel().findByPk(decoded.sid), user);
}
export async function rotateSession(decoded, token, user, mobile) {
  if (!decoded.sid) return null;
  return sequelize.transaction(async transaction => {
    const session = await getAuthSessionModel().findByPk(decoded.sid, { transaction, lock: transaction.LOCK.UPDATE });
    if (!sessionValid(session, user)) return null;
    const incoming = hash(token);
    // Simultaneous requests/tabs may refresh together. Return the same token for 10s.
    if (incoming === session.previous_hash && Date.now() - new Date(session.rotated_at).getTime() < 10000) {
      return { sid: session.id, token: signRefresh(session) };
    }
    if (incoming !== session.refresh_hash) return null;
    // Avoid rotating to an identical token within the same second.
    if (Date.now() - new Date(session.rotated_at).getTime() < 1000) return { sid: session.id, token };
    session.previous_hash = session.refresh_hash;
    session.rotated_at = new Date();
    session.expires_at = new Date(Date.now() + (mobile ? 86400000 : 3600000));
    const next = signRefresh(session);
    session.refresh_hash = hash(next);
    await session.save({ transaction });
    return { sid: session.id, token: next };
  });
}
export async function revokeSession(token) {
  if (!token) return;
  let decoded;
  try { decoded = jwt.verify(token, refreshSecret(), { algorithms: ['HS256'] }); } catch { return; }
  if (decoded.tenant !== getTenantSchema() || !decoded.sid) return;
  await getAuthSessionModel().update({ revoked_at: new Date() }, { where: { id: decoded.sid, user_id: decoded.sub } });
}
