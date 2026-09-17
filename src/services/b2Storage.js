import { decryptCredential } from '../security/credentialEncryption.js';
/** Armazenamento B2 por empresa. Credenciais permanecem no servidor; fotos guardam apenas destino e referências. */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID, createHash } from 'node:crypto';
import { getTenantSchema } from '../config/tenantContext.js';

import { validarDestinoB2, destinoConfigurado } from './b2Config.js';
const cache = new Map();

export async function resolverB2(destino) {
  const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
  const config = await getConfiguracaoSistemaModel().unscoped().findOne({
    attributes: ['b2_key_id', 'b2_application_key', 'b2_bucket', 'b2_endpoint', 'b2_region']
  });
  const useDatabase = !!config?.b2_key_id;
  const keyId = useDatabase ? config.b2_key_id : process.env.B2_KEY_ID;
  const applicationKey = useDatabase ? decryptCredential(config.b2_application_key) : process.env.B2_APPLICATION_KEY;
  if (!keyId || !applicationKey) throw Object.assign(new Error('Configure as credenciais B2 em Configurações → Gerais.'), { status: 503 });
  const resolved = validarDestinoB2(destino || destinoConfigurado(config));
  return { ...resolved, keyId, applicationKey };
}

function getCliente(config) {
  // Destino e credenciais fazem parte do cache; contas de empresas não se misturam.
  const cacheKey = JSON.stringify(config);
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const client = new S3Client({ endpoint: config.endpoint, region: config.region,
    credentials: { accessKeyId: config.keyId, secretAccessKey: config.applicationKey },
    forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 30000 }
  });
  if (cache.size >= 20) cache.clear();
  cache.set(cacheKey, client);
  return client;
}

export async function b2Configurado() {
  try { await resolverB2(); return true; } catch { return false; }
}

export const destinoPublicoB2 = config => ({ bucket: config.bucket, endpoint: config.endpoint, region: config.region });

/**
 * Gera a chave do objeto no B2.
 * Padrão: fotos/<fotoId>/imagem.webp  ou  fotos/<fotoId>/miniatura.webp
 */
export const b2Key = (fotoId, tipo) => `fotos/${encodeURIComponent(getTenantSchema() || 'public')}/${fotoId}/${randomUUID()}/${tipo}.webp`;

/**
 * Faz upload de um buffer WebP para o B2.
 * @param {string} fotoId  UUID da foto
 * @param {Buffer} buffer  Conteúdo binário
 * @param {'imagem'|'miniatura'} tipo
 * @returns {Promise<{key: string, version: string|null}>} Referência estável do objeto
 */
export async function uploadFoto(fotoId, buffer, tipo, contexto) {
  const key = b2Key(fotoId, tipo);
  const config = contexto || await resolverB2();
  const client = getCliente(config);
  const result = await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: 'image/webp',
  }));
  return { key, version: result.VersionId || null, destino: destinoPublicoB2(config) };
}

/**
 * Remove um objeto do B2. Erros "not found" são silenciados (idempotente).
 * @param {string} key  Chave do objeto (b2_imagem_key ou b2_miniatura_key)
 */
export async function deletarFoto(key, version, destino) {
  if (!key) return;
  try {
    const config = await resolverB2(destino);
    const client = getCliente(config);
    if (!version) {
      const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      version = head.VersionId;
      if (!version) throw new Error('B2 não retornou a versão do arquivo para exclusão.');
    }
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key, ...(version ? { VersionId: version } : {}) }));
  } catch (e) {
    if (!['NoSuchKey', 'NotFound', 'NoSuchVersion'].includes(e?.name)) throw e;
  }
}

/**
 * Gera URL pré-assinada privada para acesso temporário à imagem.
 * O frontend redireciona para essa URL — as credenciais nunca chegam ao browser.
 * @param {string} key         Chave do objeto no B2
 * @param {number} ttlSegundos Validade em segundos (padrão: 900 = 15 minutos)
 * @returns {Promise<string>}  URL assinada
 */
export async function gerarUrlAssinada(key, ttlSegundos = 900, version, destino) {
  const config = await resolverB2(destino);
  const client = getCliente(config);
  const command = new GetObjectCommand({ Bucket: config.bucket, Key: key, ...(version ? { VersionId: version } : {}) });
  return getSignedUrl(client, command, { expiresIn: ttlSegundos });
}

// A migração só libera o BLOB depois de comparar os bytes baixados do B2.
export async function verificarFoto(key, buffer, version, destino) {
  const config = await resolverB2(destino);
  const client = getCliente(config);
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key,
    ...(version ? { VersionId: version } : {}) }));
  const remote = await result.Body.transformToByteArray();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (hash(remote) !== hash(buffer)) throw new Error('A cópia no B2 não corresponde à foto original.');
  return result.VersionId || version || null;
}
