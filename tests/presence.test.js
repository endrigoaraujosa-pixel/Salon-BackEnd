import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';
import jwt from 'jsonwebtoken';
import { tenantStorage } from '../src/config/tenantContext.js';

process.env.JWT_SECRET = 'presence-test-secret';
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db } });
const { getUserModel } = await import('../src/models/User.js');
const { getPerfilAcessoModel } = await import('../src/models/PerfilAcesso.js');
const { getAuthSessionModel } = await import('../src/models/AuthSession.js');
const { createSession } = await import('../src/security/sessions.js');
const { protect } = await import('../src/middleware/auth.js');
const { heartbeat, listPresence } = await import('../src/controllers/presenceController.js');
const tenant = (name, fn) => tenantStorage.run(name, fn);
const res = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  set(k, v) { this.headers[k] = v; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
const admin = { id: 'a', role: 'admin' };
const status = async user => { const r = res(); await listPresence({ user }, r); return r; };
const beat = async (id, sid, body = {}) => { const r = res(); await heartbeat({ user: { id }, authSessionId: sid, body }, r); return r; };
let sidA, sidB;
before(async () => {
  for (const schema of ['company_presence_a', 'company_presence_b']) await tenant(schema, async () => {
    for (const get of [getUserModel, getAuthSessionModel, getPerfilAcessoModel]) await get().sync();
    for (const id of ['a', 'b']) await getUserModel().create({ id, email: `${id}@example.invalid`, name: id,
      password_hash: `hash-${id}`, ativo: true, deletado: 'N', role: id === 'a' ? 'admin' : 'funcionario' });
  });
  await tenant('company_presence_a', async () => {
    sidA = (await createSession(await getUserModel().findByPk('a'))).sid;
    sidB = (await createSession(await getUserModel().findByPk('b'))).sid;
  });
});
after(() => db.close());

test('migration adds nullable presence and index without modifying existing sessions', async () => {
  const migration = (await import('../src/migrations/20260923120000-auth-session-presence.js')).default;
  const q = db.getQueryInterface();
  const table = { schema: 'company_presence_migration', tableName: 'auth_sessions' };
  const previousSchema = db.options.schema;
  db.options.schema = table.schema;
  try {
    await q.createTable(table, { id: { type: Sequelize.STRING, primaryKey: true } });
    await q.bulkInsert(table, [{ id: 'existing' }]);
    await migration.up(q, Sequelize);
    const columns = await q.describeTable(table);
    assert.equal(columns.last_seen_at.allowNull, true);
    assert.ok((await q.showIndex(table)).some(index => index.name === 'auth_sessions_last_seen_at'));
    const [rows] = await db.query('SELECT id, last_seen_at FROM "company_presence_migration.auth_sessions"');
    assert.deepEqual(rows, [{ id: 'existing', last_seen_at: null }]);
  } finally {
    db.options.schema = previousSchema;
  }
});

test('protect requires a valid session and supplies its ID; body cannot impersonate another user', async () => tenant('company_presence_a', async () => {
  const token = jwt.sign({ sub: 'a', sid: sidA, tenant: 'company_presence_a' }, process.env.JWT_SECRET);
  const req = { cookies: { access_token: token }, headers: {}, body: { user_id: 'b', session_id: sidB } };
  let passed = false;
  await protect(req, res(), () => { passed = true; });
  assert.equal(passed, true);
  assert.equal(req.authSessionId, sidA);
  const r = res(); await heartbeat(req, r);
  assert.equal(r.statusCode, 204);
  assert.ok((await getAuthSessionModel().findByPk(sidA)).last_seen_at);
  assert.equal((await getAuthSessionModel().findByPk(sidB)).last_seen_at, null);
  const unauth = res(); await protect({ headers: {} }, unauth, () => assert.fail('unauthenticated'));
  assert.equal(unauth.statusCode, 401);
}));

test('presence visibility follows users permission and never exposes credentials', async () => tenant('company_presence_a', async () => {
  const all = await status(admin);
  assert.equal(all.headers['Cache-Control'], 'no-store');
  assert.deepEqual(all.body.map(({ id, online }) => ({ id, online })), [{ id: 'a', online: true }, { id: 'b', online: false }]);
  assert.ok(all.body.every(item => item.last_access_at));
  assert.deepEqual(Object.keys(all.body[0]).sort(), ['id', 'last_access_at', 'online']);
  assert.deepEqual((await status({ id: 'b', role: 'funcionario' })).body.map(({ id, online }) => ({ id, online })), [{ id: 'b', online: false }]);
  assert.equal((await status({ id: 'b', perfil: { permissoes: { 'usuarios.visualizar': true } } })).body.length, 2);
}));

test('duplicate tabs do not rewrite timestamp, and silence expires presence after two minutes', async () => tenant('company_presence_a', async () => {
  const original = (await getAuthSessionModel().findByPk(sidA)).last_seen_at.getTime();
  await beat('a', sidA);
  assert.equal((await getAuthSessionModel().findByPk(sidA)).last_seen_at.getTime(), original);
  await getAuthSessionModel().update({ last_seen_at: new Date(Date.now() - 121000) }, { where: { id: sidA } });
  assert.equal((await status(admin)).body.find(u => u.id === 'a').online, false);
  await beat('a', sidA);
  assert.equal((await status(admin)).body.find(u => u.id === 'a').online, true);
}));

test('tenant isolation rejects foreign token and never lists another company presence', async () => tenant('company_presence_b', async () => {
  assert.ok((await status(admin)).body.every(u => !u.online));
  const r = res();
  const token = jwt.sign({ sub: 'a', sid: sidA, tenant: 'company_presence_a' }, process.env.JWT_SECRET);
  await protect({ cookies: { access_token: token }, headers: {} }, r, () => assert.fail('cross tenant'));
  assert.equal(r.statusCode, 401);
}));

test('revoked or expired sessions are offline; another active device keeps user online', async () => tenant('company_presence_a', async () => {
  await getAuthSessionModel().update({ revoked_at: new Date() }, { where: { id: sidA } });
  await beat('a', sidA);
  assert.equal((await status(admin)).body.find(u => u.id === 'a').online, false);
  const second = await createSession(await getUserModel().findByPk('a'));
  await beat('a', second.sid);
  assert.equal((await status(admin)).body.find(u => u.id === 'a').online, true);
  await getAuthSessionModel().update({ expires_at: new Date(Date.now() - 1) }, { where: { id: second.sid } });
  assert.equal((await status(admin)).body.find(u => u.id === 'a').online, false);
}));

test('password changes, deactivation and deletion cannot leave a green indicator', async () => tenant('company_presence_a', async () => {
  await beat('b', sidB);
  assert.equal((await status(admin)).body.find(u => u.id === 'b').online, true);
  await getUserModel().update({ password_hash: 'changed' }, { where: { id: 'b' } });
  assert.equal((await status(admin)).body.find(u => u.id === 'b').online, false);
  const second = await createSession(await getUserModel().findByPk('b'));
  await beat('b', second.sid);
  await getUserModel().update({ ativo: false }, { where: { id: 'b' } });
  assert.equal((await status(admin)).body.find(u => u.id === 'b').online, false);
  await getUserModel().update({ deletado: 'S' }, { where: { id: 'b' } });
  assert.equal((await status(admin)).body.some(u => u.id === 'b'), false);
}));

test('last access survives logout and session deletion; never accessed users remain null', async () => tenant('company_presence_a', async () => {
  const before = (await getUserModel().findByPk('a')).last_access_at;
  assert.ok(before);
  await getAuthSessionModel().destroy({ where: { user_id: 'a' } });
  const record = (await status(admin)).body.find(u => u.id === 'a');
  assert.equal(record.online, false);
  assert.equal(new Date(record.last_access_at).getTime(), before.getTime());
  await getUserModel().create({ id: 'never', email: 'never@example.invalid', password_hash: 'unused', ativo: true, deletado: 'N' });
  assert.equal((await status(admin)).body.find(u => u.id === 'never').last_access_at, null);
}));
