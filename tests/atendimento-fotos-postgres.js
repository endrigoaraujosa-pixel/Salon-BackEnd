// Integration check: creates and drops ONLY its randomly named temporary schema.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Sequelize from 'sequelize';
import sharp from 'sharp';
import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getAgendamentoModel } from '../src/models/Agendamento.js';
import { getConfiguracaoSistemaModel } from '../src/models/ConfiguracaoSistema.js';
import { getAtendimentoFotoModel } from '../src/models/AtendimentoFoto.js';
import { mock } from 'node:test';
const objects = new Map();
mock.module('../src/services/b2Storage.js', { namedExports: {
  resolverB2: async () => ({ bucket: 'test-bucket', endpoint: 'https://s3.us-east-005.backblazeb2.com', region: 'us-east-005' }),
  destinoPublicoB2: config => config,
  b2Configurado: async () => true,
  uploadFoto: async (id, bytes, tipo) => {
    const key = id + '/' + tipo; objects.set(key, bytes); return { key, version: 'v1', destino: { bucket: 'test-bucket', endpoint: 'https://s3.us-east-005.backblazeb2.com', region: 'us-east-005' } };
  },
  deletarFoto: async key => objects.delete(key),
  gerarUrlAssinada: async () => 'https://private.example/image'
} });
const { enviarFoto } = await import('../src/controllers/atendimentoFotoController.js');
import migration from '../src/migrations/20260914120000-create-atendimento-fotos.js';

if (process.env.FOTOS_TEST_ALLOW_TEMP_SCHEMA !== 'true') throw new Error('Defina FOTOS_TEST_ALLOW_TEMP_SCHEMA=true para autorizar o schema temporário.');
const schema = `qa_fotos_${randomUUID().replaceAll('-', '')}`;
sequelize.options.logging = false;
try {
  await sequelize.createSchema(schema);
  sequelize.options.schema = schema;
  await tenantStorage.run(schema, async () => {
    await getAgendamentoModel().sync();
    await getConfiguracaoSistemaModel().sync();
    for (const col of ['b2_bucket', 'b2_endpoint', 'b2_region']) await sequelize.getQueryInterface().removeColumn({schema, tableName:'configuracao_sistema'}, col);
    await sequelize.getQueryInterface().removeColumn({ schema, tableName: 'configuracao_sistema' }, 'permitir_fotos_atendimentos');
    await migration.up(sequelize.getQueryInterface(), Sequelize);
    await (await import('../src/migrations/20260914130000-add-b2-key-to-atendimento-fotos.js')).default.up(sequelize.getQueryInterface(), Sequelize);
    await (await import('../src/migrations/20260915120000-fotos-b2-references-only.js')).default.up(sequelize.getQueryInterface(), Sequelize);
    await (await import('../src/migrations/20260915140000-b2-destino-por-empresa.js')).default.up(sequelize.getQueryInterface(), Sequelize);
    await getConfiguracaoSistemaModel().create({ permitir_fotos_atendimentos: true });
    const aid = randomUUID(); const cid = randomUUID();
    await getAgendamentoModel().create({ id: aid, cliente_id: cid, data_hora: new Date() });
    const body = await sharp({ create: { width: 80, height: 40, channels: 3, background: 'green' } }).png().toBuffer();
    const statuses = await Promise.all(Array.from({ length: 8 }, async () => {
      const res = { code: 200, status(n) { this.code = n; return this; }, json(value) { this.body = value; } };
      await enviarFoto({ params: { aid, cid, fid: randomUUID() }, body, user: { id: randomUUID() } }, res);
      return res.code;
    }));
    assert.equal(statuses.filter(s => s === 200).length, 5);
    assert.equal(statuses.filter(s => s === 409).length, 3);
    assert.equal(await getAtendimentoFotoModel().count(), 5);
    console.log('PASS: PostgreSQL aceitou 5 de 8 envios simultâneos; 3 excedentes bloqueados.');
    const rows = await getAtendimentoFotoModel().findAll();
    assert.equal(rows[0].get('imagem'), undefined);
    assert.equal((await getAtendimentoFotoModel().findOne({ attributes: ['imagem'] })).get('imagem'), null);
    assert.equal(objects.size, 10);
    console.log('PASS: somente referências armazenadas, metadados sem binários e migração real verificados.');
  });
} finally {
  const quoted = sequelize.getQueryInterface().queryGenerator.quoteIdentifier(schema);
  await sequelize.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
  await sequelize.close();
}
