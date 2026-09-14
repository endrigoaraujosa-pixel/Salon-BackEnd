/**
 * b2Storage.js — Integração com Backblaze B2 via API S3 compatível.
 *
 * Ordem de prioridade para as credenciais:
 *   1. Banco de dados (configuracao_sistema.b2_key_id / b2_application_key)
 *      → configurado via UI em /configuracoes/gerais
 *   2. Variáveis de ambiente (B2_KEY_ID / B2_APPLICATION_KEY)
 *      → útil para ambiente local sem acesso ao banco na inicialização
 *
 * Variáveis de ambiente fixas (não variam por tenant):
 *   B2_BUCKET_NAME  — ex: salon-fotos-api
 *   B2_ENDPOINT     — ex: https://s3.us-east-005.backblazeb2.com
 *   B2_REGION       — ex: us-east-005
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION } = process.env;

// Cache do cliente por par de credenciais (evita recriar a cada chamada)
const _clientCache = new Map();

function buildCliente(keyId, applicationKey) {
  if (!B2_BUCKET_NAME || !B2_ENDPOINT || !B2_REGION)
    throw new Error('Variáveis B2_BUCKET_NAME, B2_ENDPOINT e B2_REGION não configuradas.');
  if (!keyId || !applicationKey)
    throw new Error('Credenciais do Backblaze B2 não configuradas. Acesse Configurações → Gerais → Registro Fotográfico.');

  const cacheKey = `${keyId}:${applicationKey}`;
  if (_clientCache.has(cacheKey)) return _clientCache.get(cacheKey);

  const client = new S3Client({
    endpoint: B2_ENDPOINT,
    region: B2_REGION,
    credentials: { accessKeyId: keyId, secretAccessKey: applicationKey },
    forcePathStyle: true, // Obrigatório para B2
  });
  _clientCache.set(cacheKey, client);
  return client;
}

/**
 * Resolve as credenciais B2 com prioridade:
 *   banco (configuracao_sistema) > variáveis de ambiente
 */
async function resolverCredenciais() {
  try {
    // Importação dinâmica para evitar ciclo de dependência na inicialização
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    // unscoped() necessário para acessar b2_application_key (excluída no defaultScope)
    const config = await getConfiguracaoSistemaModel().unscoped().findOne({
      attributes: ['b2_key_id', 'b2_application_key']
    });
    if (config?.b2_key_id && config?.b2_application_key) {
      return { keyId: config.b2_key_id, applicationKey: config.b2_application_key };
    }
  } catch {
    // Banco ainda não disponível (ex: startup) — cai no .env
  }
  return { keyId: process.env.B2_KEY_ID, applicationKey: process.env.B2_APPLICATION_KEY };
}

async function getCliente() {
  const { keyId, applicationKey } = await resolverCredenciais();
  return buildCliente(keyId, applicationKey);
}

/**
 * Verifica se as credenciais B2 estão disponíveis (banco ou .env).
 * Não valida a conexão com o B2, apenas a presença dos valores.
 */
export async function b2Configurado() {
  try {
    const { keyId, applicationKey } = await resolverCredenciais();
    return !!(keyId && applicationKey && B2_BUCKET_NAME && B2_ENDPOINT && B2_REGION);
  } catch { return false; }
}

/**
 * Gera a chave do objeto no B2.
 * Padrão: fotos/<fotoId>/imagem.webp  ou  fotos/<fotoId>/miniatura.webp
 */
export const b2Key = (fotoId, tipo) => `fotos/${fotoId}/${tipo}.webp`;

/**
 * Faz upload de um buffer WebP para o B2.
 * @param {string} fotoId  UUID da foto
 * @param {Buffer} buffer  Conteúdo binário
 * @param {'imagem'|'miniatura'} tipo
 * @returns {Promise<string>} Chave do objeto no B2
 */
export async function uploadFoto(fotoId, buffer, tipo) {
  const key = b2Key(fotoId, tipo);
  const client = await getCliente();
  await client.send(new PutObjectCommand({
    Bucket: B2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
  }));
  return key;
}

/**
 * Remove um objeto do B2. Erros "not found" são silenciados (idempotente).
 * @param {string} key  Chave do objeto (b2_imagem_key ou b2_miniatura_key)
 */
export async function deletarFoto(key) {
  if (!key) return;
  try {
    const client = await getCliente();
    await client.send(new DeleteObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key }));
  } catch (e) {
    if (e?.name !== 'NoSuchKey') throw e;
  }
}

/**
 * Gera URL pré-assinada privada para acesso temporário à imagem.
 * O frontend redireciona para essa URL — as credenciais nunca chegam ao browser.
 * @param {string} key         Chave do objeto no B2
 * @param {number} ttlSegundos Validade em segundos (padrão: 3600 = 1h)
 * @returns {Promise<string>}  URL assinada
 */
export async function gerarUrlAssinada(key, ttlSegundos = 3600) {
  const client = await getCliente();
  const command = new GetObjectCommand({ Bucket: B2_BUCKET_NAME, Key: key });
  return getSignedUrl(client, command, { expiresIn: ttlSegundos });
}
