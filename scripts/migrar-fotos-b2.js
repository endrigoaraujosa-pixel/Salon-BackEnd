/**
 * migrar-fotos-b2.js — Migra fotos existentes (BLOB) do PostgreSQL para o Backblaze B2.
 *
 * Uso:
 *   node scripts/migrar-fotos-b2.js [--schema nome_schema] [--dry-run]
 *
 * Opções:
 *   --schema   Schema do tenant a migrar (padrão: public)
 *   --dry-run  Exibe o que seria migrado sem fazer upload nem atualizar o banco
 *
 * Pré-requisitos:
 *   - Variáveis B2_* configuradas no .env
 *   - Migration 20260914130000-add-b2-key-to-atendimento-fotos já executada
 *
 * O script é idempotente: fotos que já têm b2_imagem_key são ignoradas.
 */

import 'dotenv/config';
import { Sequelize, DataTypes, Op } from 'sequelize';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ── Argumentos ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const schema = args.includes('--schema') ? args[args.indexOf('--schema') + 1] : 'public';
const dryRun = args.includes('--dry-run');

console.log(`\n🪣  Migração de fotos → Backblaze B2`);
console.log(`   Schema : ${schema}`);
console.log(`   Modo   : ${dryRun ? 'DRY-RUN (nenhuma alteração será feita)' : 'PRODUÇÃO'}\n`);

// ── Validação das variáveis de ambiente ───────────────────────────────────────
const { B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION,
        DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE } = process.env;

for (const [k, v] of Object.entries({ B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_ENDPOINT, B2_REGION })) {
  if (!v) { console.error(`❌  Variável ${k} não configurada no .env`); process.exit(1); }
}

// ── Clientes ─────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  endpoint: B2_ENDPOINT,
  region: B2_REGION,
  credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APPLICATION_KEY },
  forcePathStyle: true,
});

const sequelize = new Sequelize(DB_DATABASE, DB_USERNAME, DB_PASSWORD, {
  host: DB_HOST, port: Number(DB_PORT) || 5432, dialect: 'postgres',
  schema, logging: false,
});

// Modelo inline — inclui os BLOBs pois precisamos deles aqui
const Foto = sequelize.define('AtendimentoFoto', {
  id:               { type: DataTypes.STRING(36), primaryKey: true },
  agendamento_id:   DataTypes.STRING(36),
  cliente_id:       DataTypes.STRING(36),
  largura:          DataTypes.INTEGER,
  altura:           DataTypes.INTEGER,
  bytes:            DataTypes.INTEGER,
  b2_imagem_key:    { type: DataTypes.STRING(255), allowNull: true },
  b2_miniatura_key: { type: DataTypes.STRING(255), allowNull: true },
  imagem:           DataTypes.BLOB,
  miniatura:        DataTypes.BLOB,
  criado_em:        DataTypes.DATE,
}, { tableName: 'atendimento_fotos', timestamps: false, schema });

// ── Helpers ───────────────────────────────────────────────────────────────────
const b2Key = (fotoId, tipo) => `fotos/${fotoId}/${tipo}.webp`;

async function uploadBuffer(key, buffer) {
  await s3.send(new PutObjectCommand({
    Bucket: B2_BUCKET_NAME, Key: key, Body: buffer, ContentType: 'image/webp',
  }));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Migração ──────────────────────────────────────────────────────────────────
async function main() {
  await sequelize.authenticate();
  console.log('✅  Conexão com o banco estabelecida.\n');

  // Busca fotos que ainda têm BLOB e não têm chave B2
  const pendentes = await Foto.findAll({
    attributes: ['id', 'imagem', 'miniatura', 'bytes'],
    where: { b2_imagem_key: null, imagem: { [Op.ne]: null } },
    order: [['criado_em', 'ASC']],
  });

  if (!pendentes.length) {
    console.log('✅  Nenhuma foto pendente de migração.\n');
    await sequelize.close();
    return;
  }

  console.log(`📸  ${pendentes.length} foto(s) para migrar.\n`);

  let ok = 0, erros = 0;
  let bytesTotal = 0;

  for (const [i, foto] of pendentes.entries()) {
    const progresso = `[${String(i + 1).padStart(String(pendentes.length).length)}/${pendentes.length}]`;
    const keyImagem = b2Key(foto.id, 'imagem');
    const keyMiniatura = b2Key(foto.id, 'miniatura');

    try {
      if (dryRun) {
        console.log(`${progresso} DRY-RUN  ${foto.id}  (${formatBytes(foto.bytes)})`);
        ok++;
        continue;
      }

      await Promise.all([
        uploadBuffer(keyImagem, foto.imagem),
        uploadBuffer(keyMiniatura, foto.miniatura),
      ]);

      await Foto.update(
        { b2_imagem_key: keyImagem, b2_miniatura_key: keyMiniatura },
        { where: { id: foto.id } }
      );

      bytesTotal += foto.bytes;
      ok++;
      console.log(`${progresso} ✅  ${foto.id}  (${formatBytes(foto.bytes)})`);
    } catch (e) {
      erros++;
      console.error(`${progresso} ❌  ${foto.id}  — ${e.message}`);
    }
  }

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  Migradas : ${ok}`);
  console.log(`  Erros    : ${erros}`);
  if (!dryRun) console.log(`  Enviado  : ${formatBytes(bytesTotal)}`);
  console.log(`──────────────────────────────────────────\n`);

  if (erros > 0) {
    console.log('⚠️   Execute o script novamente para tentar os erros. O script é idempotente.\n');
    process.exit(1);
  }

  await sequelize.close();
  console.log('✅  Migração concluída.\n');
}

main().catch(e => { console.error('Erro fatal:', e.message); process.exit(1); });
