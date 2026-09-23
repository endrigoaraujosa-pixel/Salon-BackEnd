import { Op } from 'sequelize';
import { getAuthSessionModel } from '../models/AuthSession.js';
import { getUserModel } from '../models/User.js';
import { sessionValid } from '../security/sessions.js';

export const PRESENCE_TTL_MS = 120000;

export async function heartbeat(req, res) {
  if (!req.user || !req.authSessionId) return res.status(401).json({ detail: 'Não autenticado' });
  try {
    const now = new Date();
    // Never accept user/session IDs or timestamps from the client. Conditional
    // UPDATE also limits writes from multiple tabs to once every 20 seconds.
    const [updated] = await getAuthSessionModel().update({ last_seen_at: now }, { where: {
      id: req.authSessionId, user_id: req.user.id,
      revoked_at: null, expires_at: { [Op.gt]: now },
      [Op.or]: [{ last_seen_at: null }, { last_seen_at: { [Op.lt]: new Date(now.getTime() - 20000) } }]
    } });
    if (updated) await getUserModel().update({ last_access_at: now }, { where: {
      id: req.user.id,
      [Op.or]: [{ last_access_at: null }, { last_access_at: { [Op.lt]: now } }]
    } });
    res.set('Cache-Control', 'no-store');
    return res.status(204).end();
  } catch {
    return res.status(503).json({ detail: 'Presença temporariamente indisponível.' });
  }
}

export async function listPresence(req, res) {
  if (!req.user) return res.status(401).json({ detail: 'Não autenticado' });
  try {
    // Same visibility as GET /users: without the permission, only oneself.
    const viewAll = req.user.role === 'admin' || req.user.perfil?.permissoes?.['usuarios.visualizar'] === true;
    const users = await getUserModel().findAll({
      where: { deletado: 'N', ...(viewAll ? {} : { id: req.user.id }) },
      attributes: ['id', 'ativo', 'password_hash', 'last_access_at']
    });
    const now = new Date();
    const sessions = users.length ? await getAuthSessionModel().findAll({ where: {
      user_id: { [Op.in]: users.map(user => user.id) },
      revoked_at: null, expires_at: { [Op.gt]: now },
      last_seen_at: { [Op.gt]: new Date(now.getTime() - PRESENCE_TTL_MS) }
    }, attributes: ['user_id', 'password_version', 'expires_at', 'revoked_at'] }) : [];
    const byId = new Map(users.map(user => [user.id, user]));
    const online = new Set(sessions.filter(session => {
      const user = byId.get(session.user_id);
      return user?.ativo !== false && sessionValid(session, user);
    }).map(session => session.user_id));
    res.set('Cache-Control', 'no-store');
    return res.json(users.map(user => ({ id: user.id, online: online.has(user.id), last_access_at: user.last_access_at || null })));
  } catch {
    return res.status(503).json({ detail: 'Presença temporariamente indisponível.' });
  }
}
