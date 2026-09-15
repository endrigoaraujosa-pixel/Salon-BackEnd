import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { tenantStorage, getTenantSchema } from '../src/config/tenantContext.js';
import { validarDestinoB2 } from '../src/services/b2Config.js';

const configs = {
  empresa_a: { b2_bucket: 'bucket-empresa-a', b2_endpoint: 'https://s3.us-east-005.backblazeb2.com', b2_region: 'us-east-005', b2_key_id: 'id-a', b2_application_key: 'fake-a' },
  empresa_b: { b2_bucket: 'bucket-empresa-b', b2_endpoint: 'https://s3.eu-central-003.backblazeb2.com', b2_region: 'eu-central-003', b2_key_id: 'id-b', b2_application_key: 'fake-b' }
};
const calls = [];
class Command { constructor(input) { this.input = input; } }
mock.module('@aws-sdk/client-s3', { namedExports: {
  S3Client: class { constructor(config) { this.config = config; } async send(command) {
    calls.push({ config: this.config, input: command.input }); return { VersionId: 'test-version' };
  } }, PutObjectCommand: Command, DeleteObjectCommand: Command, GetObjectCommand: Command, HeadObjectCommand: Command
} });
mock.module('@aws-sdk/s3-request-presigner', { namedExports: {
  getSignedUrl: async (client, command) => {
    calls.push({ config: client.config, input: command.input }); return 'https://example.test/private';
  }
} });
mock.module('../src/models/ConfiguracaoSistema.js', { namedExports: {
  getConfiguracaoSistemaModel: () => ({ unscoped: () => ({ findOne: async () => configs[getTenantSchema()] }) })
} });
const { uploadFoto, gerarUrlAssinada, deletarFoto } = await import('../src/services/b2Storage.js');

test('valida endpoint B2 antes de enviar credenciais e deriva região', () => {
  assert.equal(validarDestinoB2({ bucket: 'bucket-teste', endpoint: 's3.eu-central-003.backblazeb2.com' }).region, 'eu-central-003');
  for (const endpoint of ['http://localhost', 'https://example.org', 'https://s3.us-east-005.backblazeb2.com.evil.test', 'https://user:secret@s3.us-east-005.backblazeb2.com'])
    assert.throws(() => validarDestinoB2({ bucket: 'bucket-teste', endpoint }));
  assert.throws(() => validarDestinoB2({ bucket: 'bucket-teste', endpoint: 's3.us-east-005.backblazeb2.com', region: 'eu-central-003' }));
});

test('empresas usam destinos e credenciais separados, foto preserva bucket antigo', async () => {
  const [a, b] = await Promise.all(['empresa_a', 'empresa_b'].map(tenant => tenantStorage.run(tenant,
    () => uploadFoto('foto-id', Buffer.from('test'), 'imagem'))));
  assert.equal(a.destino.bucket, 'bucket-empresa-a'); assert.equal(b.destino.bucket, 'bucket-empresa-b');
  for (const call of calls) {
    const suffix = call.input.Bucket.endsWith('-a') ? 'a' : 'b';
    assert.equal(call.config.credentials.accessKeyId, `id-${suffix}`);
    assert.equal(call.input.ContentLength, 4);
  }
  assert.equal(JSON.stringify(a).includes('fake-a'), false);
  configs.empresa_a.b2_bucket = 'bucket-novo-a';
  await tenantStorage.run('empresa_a', async () => {
    await gerarUrlAssinada(a.key, 900, a.version, a.destino);
    await deletarFoto(a.key, a.version, a.destino);
  });
  assert.equal(calls.at(-1).input.Bucket, 'bucket-empresa-a');
  assert.equal(calls.at(-2).input.Bucket, 'bucket-empresa-a');
});
