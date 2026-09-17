// Opt-in integration test: only a newly generated schema is modified and removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import Sequelize from 'sequelize';
import jwt from 'jsonwebtoken';
import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getConfiguracaoSistemaModel } from '../src/models/ConfiguracaoSistema.js';
import { getAgendamentoOnlineAuthModel } from '../src/models/AgendamentoOnlineAuth.js';
import { getClienteModel } from '../src/models/Cliente.js';
import migration from '../src/migrations/20260917120000-security-sessions-and-b2-encryption.js';
import { encryptB2Credentials } from '../src/services/encryptB2Credentials.js';
import { decryptCredential } from '../src/security/credentialEncryption.js';
import { otpDigest } from '../src/security/onlineProof.js';
import { createSession, rotateSession, revokeSession, validateAccessSession } from '../src/security/sessions.js';
import { getAuthSessionModel } from '../src/models/AuthSession.js';
mock.module('../src/modules/whatsapp/provider/whatsapp.provider.js', { defaultExport: { sendMessage: () => { throw new Error('Real sending forbidden in test'); } } });
mock.module('../src/modules/whatsapp/whatsapp.service.js', { namedExports: { getConfig: async () => ({ ativo: 1 }) } });
const { validateCode } = await import('../src/controllers/onlineController.js');
if (process.env.SECURITY_TEST_ALLOW_TEMP_SCHEMA !== 'true') throw new Error('Defina SECURITY_TEST_ALLOW_TEMP_SCHEMA=true para autorizar o schema temporário.');
const schema = `company_qa_security_${randomUUID().replaceAll('-', '')}`;
process.env.JWT_SECRET = 'isolated-postgres-test-secret';
process.env.B2_CREDENTIAL_ENCRYPTION_KEY = 'b'.repeat(64);
sequelize.options.logging = false;
let created = false;
try {
  await sequelize.createSchema(schema); created = true;
  sequelize.options.schema = schema;
  await tenantStorage.run(schema, async () => {
    await getConfiguracaoSistemaModel().sync();
    const config = await getConfiguracaoSistemaModel().create({ agendamento_online_ativo: true, b2_application_key: 'fake-legacy-key' });
    await sequelize.getQueryInterface().changeColumn({ schema, tableName: 'configuracao_sistema' }, 'b2_application_key', { type: Sequelize.STRING(255), allowNull: true });
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    assert.equal((await getConfiguracaoSistemaModel().unscoped().findByPk(config.id)).b2_application_key, 'fake-legacy-key');
    assert.equal(await encryptB2Credentials(schema), 1);
    const encrypted = (await getConfiguracaoSistemaModel().unscoped().findByPk(config.id)).b2_application_key;
    assert.notEqual(encrypted, 'fake-legacy-key');
    assert.equal(decryptCredential(encrypted), 'fake-legacy-key');
    assert.equal(await encryptB2Credentials(schema), 0);
    console.log('PASS: migration aditiva, criptografia verificada e repetição idempotente em PostgreSQL.');
    const user = { id: randomUUID(), password_hash: 'fake-password-hash' };
    const session = await createSession(user);
    await getAuthSessionModel().update({ rotated_at: new Date(Date.now() - 2000) }, { where: { id: session.sid } });
    const results = await Promise.all(Array.from({ length: 5 }, () => rotateSession(jwt.decode(session.token), session.token, user, true)));
    assert.ok(results.every(result => result && result.token === results[0].token));
    await revokeSession(results[0].token);
    assert.equal(await validateAccessSession({ sid: session.sid }, user), false);
    console.log('PASS: cinco refreshes concorrentes e revogação persistente.');
    await getAgendamentoOnlineAuthModel().sync();
    await getClienteModel().sync();
    const id = randomUUID();
    await getAgendamentoOnlineAuthModel().create({ id, telefone: '85912345678', codigo_otp: otpDigest(id, '123456'), expira_em: new Date(Date.now() + 600000), validado: false, tentativas: 0 });
    const statuses = await Promise.all(Array.from({ length: 8 }, async () => {
      const res = { code: 200, status(value) { this.code = value; return this; }, json(body) { this.body = body; return this; } };
      await validateCode({ body: { telefone: '85912345678', codigo_otp: '123456' } }, res);
      return res.code;
    }));
    assert.equal(statuses.filter(code => code === 200).length, 1);
    assert.equal(statuses.filter(code => code === 400).length, 7);
    console.log('PASS: apenas uma de oito validações simultâneas consumiu o OTP. Nenhuma mensagem enviada.');
  });
} finally {
  if (created) {
    const quoted = sequelize.getQueryInterface().queryGenerator.quoteIdentifier(schema);
    await sequelize.query(`DROP SCHEMA ${quoted} CASCADE`);
  }
  await sequelize.close();
}
