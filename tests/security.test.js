import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { tenantStorage } from '../src/config/tenantContext.js';
import { canGrantPermissions, validateUserGrant } from '../src/security/accessPolicy.js';
import { issueOnlineProof, readOnlineProof, phoneProof, otpDigest } from '../src/security/onlineProof.js';
import { encryptCredential, decryptCredential } from '../src/security/credentialEncryption.js';
import { evolutionConnection, publicWhatsappConfig } from '../src/security/evolutionPolicy.js';
import { requestLimiter } from '../src/security/requestLimiter.js';

process.env.JWT_SECRET = 'isolated-security-test-secret-not-for-production';
process.env.B2_CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db, connectDB: async () => {} } });
let waActive = 1;
let sends = 0;
mock.module('../src/modules/whatsapp/whatsapp.service.js', { namedExports: { getConfig: async () => ({ ativo: waActive }) } });
mock.module('../src/modules/whatsapp/provider/whatsapp.provider.js', { defaultExport: { sendMessage: async () => { sends++; return { success: true }; } } });
const { getUserModel } = await import('../src/models/User.js');
const { getPerfilAcessoModel } = await import('../src/models/PerfilAcesso.js');
const { getAuthSessionModel } = await import('../src/models/AuthSession.js');
const { getAgendamentoOnlineAuthModel } = await import('../src/models/AgendamentoOnlineAuth.js');
const { getConfiguracaoSistemaModel } = await import('../src/models/ConfiguracaoSistema.js');
const { getClienteModel } = await import('../src/models/Cliente.js');
const { getAgendamentoOnlineSolicitacaoModel } = await import('../src/models/AgendamentoOnlineSolicitacao.js');
const { protect } = await import('../src/middleware/auth.js');
const auth = await import('../src/controllers/authController.js');
const users = await import('../src/controllers/userController.js');
const profiles = await import('../src/controllers/perfilAcessoController.js');
const online = await import('../src/controllers/onlineController.js');
const sessions = await import('../src/security/sessions.js');
const tenant = fn => tenantStorage.run('company_test', fn);
const response = () => ({ statusCode: 200, cookies: {}, headers: {}, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }, cookie(key, value) { this.cookies[key] = value; return this; },
  clearCookie(key) { delete this.cookies[key]; return this; }, set(key, value) { this.headers[key] = value; return this; } });
const call = async (fn, req) => { const res = response(); await tenant(() => fn(req, res)); return res; };
let user;
before(async () => tenant(async () => {
  for (const get of [getUserModel, getPerfilAcessoModel, getAuthSessionModel, getAgendamentoOnlineAuthModel, getConfiguracaoSistemaModel, getClienteModel, getAgendamentoOnlineSolicitacaoModel]) await get().sync();
  await getConfiguracaoSistemaModel().create({ agendamento_online_ativo: true });
  user = await getUserModel().create({ id: 'user', email: 'test@example.invalid', name: 'Teste', role: 'admin', ativo: true, password_hash: await bcrypt.hash('test-password', 4) });
}));
after(() => db.close());

test('login legítimo, acesso autenticado, logout revoga acesso e refresh', async () => {
  const login = await call(auth.login, { body: { email: user.email, password: 'test-password' }, headers: {} });
  assert.equal(login.statusCode, 200);
  const req = { cookies: { access_token: login.body.token }, headers: {} };
  let passed = false;
  await tenant(() => protect(req, response(), () => { passed = true; }));
  assert.equal(passed, true);
  const logout = await call(auth.logout, { cookies: login.cookies });
  assert.equal(logout.statusCode, 200);
  const denied = response();
  await tenant(() => protect(req, denied, () => assert.fail('Revoked session accepted')));
  assert.equal(denied.statusCode, 401);
  assert.equal((await call(auth.refreshToken, { cookies: login.cookies, headers: {} })).statusCode, 401);
});

test('desativação, exclusão, troca de senha e outra empresa invalidam acesso', async () => {
  const login = await call(auth.login, { body: { email: user.email, password: 'test-password' }, headers: {} });
  for (const changes of [{ ativo: false }, { ativo: true, deletado: 'S' }, { deletado: 'N', password_hash: 'changed' }]) {
    await user.update(changes);
    const res = await call(protect, { cookies: { access_token: login.body.token }, headers: {} });
    assert.equal(res.statusCode, 401);
    assert.equal((await call(auth.refreshToken, { cookies: login.cookies, headers: {} })).statusCode, 401);
  }
  await user.update({ password_hash: await bcrypt.hash('test-password', 4) });
  const res = response();
  await tenantStorage.run('company_other', () => protect({ cookies: { access_token: login.body.token }, headers: {} }, res, () => assert.fail()));
  assert.equal(res.statusCode, 401);
});

test('refresh concorrente usa janela curta e rejeita replay antigo', async () => tenant(async () => {
  const original = await sessions.createSession(user);
  const decoded = jwt.decode(original.token);
  const row = await getAuthSessionModel().findByPk(original.sid);
  await row.update({ rotated_at: new Date(Date.now() - 2000) });
  const rotated = await sessions.rotateSession(decoded, original.token, user, false);
  assert.ok(rotated);
  assert.notEqual(rotated.token, original.token);
  assert.deepEqual(await sessions.rotateSession(decoded, original.token, user, false), rotated);
  await row.update({ rotated_at: new Date(Date.now() - 11000) });
  assert.equal(await sessions.rotateSession(decoded, original.token, user, false), null);
}));

test('funcionário não promove a si mesmo nem altera administrador; gestão comum preservada', async () => {
  const actor = { id: 'employee', role: 'funcionario', perfil: { permissoes: { 'usuarios.editar': true, 'usuarios.criar': true } } };
  assert.equal(canGrantPermissions(actor, { 'perfis.editar': true }), false);
  assert.equal(await validateUserGrant(actor, { role: 'admin' }, {}, async () => null), false);
  const adminProfile = { id: 'admin-profile-uuid-00000000000000000', nome: 'Administrador', permissoes: {} };
  assert.equal(await validateUserGrant(actor, { perfil_acesso_id: adminProfile.id }, {}, async () => adminProfile), false);
  const created = await call(users.createUser, { user: actor, body: { name: 'Comum', email: 'ordinary@example.invalid', senha: '12345678', role: 'funcionario' } });
  assert.equal(created.statusCode, 201);
  const escalation = await call(users.updateUser, { user: actor, params: { id: created.body.id }, body: { role: 'admin' } });
  assert.equal(escalation.statusCode, 403);
  assert.equal((await call(users.updateUser, { user: actor, params: { id: user.id }, body: { senha: 'attacker' } })).statusCode, 403);
  assert.equal((await call(users.updateUser, { user: actor, params: { id: created.body.id }, body: { name: 'Nome atualizado' } })).statusCode, 200);
  assert.equal((await call(profiles.criarPerfil, { user: actor, body: { nome: 'Administrador', permissoes: {} } })).statusCode, 403);
  assert.equal((await call(profiles.criarPerfil, { user: actor, body: { nome: 'Elevado', permissoes: { 'perfis.editar': true } } })).statusCode, 403);
});

test('provas de telefone e reserva são vinculadas à finalidade e à empresa', () => tenant(() => {
  const token = issueOnlineProof('phone', { phone: '85999999999', verified: true });
  assert.ok(phoneProof({ body: { online_token: token } }, '(85) 99999-9999'));
  assert.equal(phoneProof({ body: { online_token: token } }, '85988888888'), null);
  assert.equal(readOnlineProof(token, 'reservation'), null);
  assert.equal(tenantStorage.run('company_other', () => readOnlineProof(token, 'phone')), null);
  assert.equal(readOnlineProof(token + 'tamper', 'phone'), null);
}));

test('cadastro público bloqueia alteração sem prova e não expõe dados sem verificação', async () => tenant(async () => {
  const client = await getClienteModel().create({ id: 'client', nome: 'Original', telefone: '85999999999', email: 'private@example.invalid', deletado: 'N' });
  const body = { nome: 'Attacker', telefone: client.telefone, email: 'attacker@example.invalid' };
  assert.equal((await call(online.registrarCliente, { body })).statusCode, 403);
  const result = await call(online.registrarCliente, { body: { ...body, online_token: issueOnlineProof('phone', { phone: client.telefone, verified: false }) } });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.stringify(result.body).includes('private@example.invalid'), false);
  assert.equal((await client.reload()).nome, 'Original');
  assert.equal((await call(online.solicitarAgendamento, { body: { cliente_nome: 'X', telefone: client.telefone, data_hora: '2027-01-01T10:00:00', servicos: ['x'] } })).statusCode, 403);
}));

test('OTP permite cinco tentativas, consome código e emite prova sem enviar mensagens reais', async () => tenant(async () => {
  const model = getAgendamentoOnlineAuthModel();
  const phone = '85988888888';
  const row = await model.create({ id: 'otp1', telefone: phone, codigo_otp: otpDigest('otp1', '123456'), expira_em: new Date(Date.now() + 600000), tentativas: 0, validado: false });
  for (let i = 0; i < 5; i++) assert.equal((await call(online.validateCode, { body: { telefone: phone, codigo_otp: '000000' } })).statusCode, 400);
  assert.equal((await call(online.validateCode, { body: { telefone: phone, codigo_otp: '123456' } })).statusCode, 400);
  assert.equal((await row.reload()).tentativas, 5);
  await row.destroy();
  await model.create({ id: 'otp2', telefone: phone, codigo_otp: otpDigest('otp2', '123456'), expira_em: new Date(Date.now() + 600000), tentativas: 0, validado: false });
  const valid = await call(online.validateCode, { body: { telefone: phone, codigo_otp: '123456' } });
  assert.equal(valid.statusCode, 200);
  assert.equal(readOnlineProof(valid.body.online_token, 'phone').verified, true);
  assert.equal((await call(online.validateCode, { body: { telefone: phone, codigo_otp: '123456' } })).statusCode, 400);
  assert.equal(sends, 0);
}));

test('B2 cifrado preserva segredo e rejeita adulteração e troca de empresa', () => {
  const encrypted = encryptCredential('test-private-key', 'company_a');
  assert.ok(!encrypted.includes('test-private-key'));
  assert.equal(decryptCredential(encrypted, 'company_a'), 'test-private-key');
  assert.throws(() => decryptCredential(encrypted, 'company_b'));
  assert.throws(() => decryptCredential(encrypted.slice(0, -5) + 'AAAAA', 'company_a'));
  assert.equal(decryptCredential('legacy'), 'legacy');
});

test('sem WhatsApp mantém agendamento, reserva não pode ser sequestrada nem reutilizada', async () => tenant(async () => {
  waActive = 0;
  const requested = await call(online.requestCode, { body: { telefone: '85977777777' } });
  assert.equal(requested.statusCode, 200);
  assert.equal(requested.body.requiresVerification, false);
  const id = 'reservation-test';
  const reservation = await getAgendamentoOnlineSolicitacaoModel().create({ id, nome_cliente: 'Reserva Temporária', telefone: '00000000000', status: 'reservado', data_hora_desejada: new Date(), servicos: [] });
  const body = { telefone: '85977777777', cliente_nome: 'Nome informado', data_hora: '2027-01-01T10:00:00', servicos: [{ servico_id: 'service' }], solicitacaoId: id, online_token: requested.body.online_token };
  assert.equal((await call(online.solicitarAgendamento, { body })).statusCode, 403);
  body.reservation_token = issueOnlineProof('reservation', { id: 'someone-else' });
  assert.equal((await call(online.solicitarAgendamento, { body })).statusCode, 403);
  body.reservation_token = issueOnlineProof('reservation', { id });
  assert.equal((await call(online.solicitarAgendamento, { body })).statusCode, 200);
  assert.equal((await reservation.reload()).status, 'pendente');
  assert.equal((await call(online.solicitarAgendamento, { body })).statusCode, 409);
  assert.equal(sends, 0);
  waActive = 1;
}));

test('WhatsApp impede URL arbitrária e instância alheia com segredo global', () => tenant(() => {
  process.env.EVOLUTION_API_URL = 'https://integration.example.invalid';
  process.env.EVOLUTION_API_TOKEN = 'test-global-token';
  assert.equal(evolutionConnection({ api_url: 'external', instancia: 'test' }).apiKey, 'test-global-token');
  assert.throws(() => evolutionConnection({ api_url: 'http://127.0.0.1', instancia: 'test' }));
  assert.throws(() => evolutionConnection({ api_url: 'external', instancia: 'other' }));
  assert.throws(() => evolutionConnection({ api_url: 'external', instancia: '../test' }));
  assert.equal(publicWhatsappConfig({ token: 'secret', ativo: 1 }).token, undefined);
}));

test('limite de tentativas expira sem afetar outra identidade', () => {
  let time = 0;
  const limit = requestLimiter({ limit: 2, windowMs: 1000, now: () => time });
  let passed = 0;
  for (let i = 0; i < 2; i++) limit({ ip: 'a' }, response(), () => passed++);
  const denied = response(); limit({ ip: 'a' }, denied, () => assert.fail());
  assert.equal(denied.statusCode, 429);
  limit({ ip: 'b' }, response(), () => passed++);
  time = 1001; limit({ ip: 'a' }, response(), () => passed++);
  assert.equal(passed, 4);
});
