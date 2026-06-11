import { sequelize } from '../src/config/db.js';
import { Umzug, SequelizeStorage } from 'umzug';
import { QueryTypes } from 'sequelize';
import Sequelize from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsGlob = path.resolve(__dirname, '..', 'src', 'migrations', '*.js');

/**
 * Executa todas as migrations pendentes em todos os schemas company_*.
 * Pode ser chamada tanto pelo script CLI (npm run migrate) quanto
 * pelo servidor na inicialização (index.js).
 *
 * @param {object} options
 * @param {boolean} options.closeConnection - Se true, fecha a conexão ao final (padrão: false).
 *                                            Use true ao rodar como script standalone.
 * @returns {object} Resumo da execução: { totalSchemas, schemasOk, schemasFailed, details }
 */
export async function runAllMigrations({ closeConnection = false } = {}) {
  const summary = {
    totalSchemas: 0,
    schemasOk: 0,
    schemasFailed: 0,
    details: []
  };

  try {
    const schemasParaMigrar = await sequelize.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'company_%';`,
      { type: QueryTypes.SELECT }
    );

    summary.totalSchemas = schemasParaMigrar.length;

    if (schemasParaMigrar.length === 0) {
      console.log('[MIGRATIONS] Nenhum schema company_* encontrado.');
      return summary;
    }

    console.log(`[MIGRATIONS] ${schemasParaMigrar.length} schema(s) encontrado(s): ${schemasParaMigrar.map(s => s.schema_name).join(', ')}`);

    for (const { schema_name } of schemasParaMigrar) {
      console.log(`\n=========================================`);
      console.log(`🚀 Iniciando migrations no schema: [${schema_name}]`);
      console.log(`=========================================`);

      // Altera temporariamente o schema padrão da instância do Sequelize
      sequelize.options.schema = schema_name;

      // Configura o Umzug para o schema atual
      const umzug = new Umzug({
        migrations: {
          glob: migrationsGlob,
          resolve: ({ name, path: migrationPath, context }) => {
            return {
              name,
              up: async () => {
                const migration = await import(`file://${migrationPath}`);
                return migration.default.up(context, Sequelize);
              },
              down: async () => {
                const migration = await import(`file://${migrationPath}`);
                return migration.default.down(context, Sequelize);
              }
            };
          },
        },
        // Passa o queryInterface atualizado com o schema correto para a migration
        context: sequelize.getQueryInterface(),
        storage: new SequelizeStorage({
          sequelize: sequelize,
          modelName: `SequelizeMeta_${schema_name}`, // Nome único por schema para evitar cache do Sequelize
          tableName: 'SequelizeMeta',                // Tabela real no banco continua sendo SequelizeMeta
          schema: schema_name,                       // Salva o histórico DENTRO do schema atual
        }),
        logger: console,
      });

      try {
        // Executa as migrations pendentes neste schema
        const executed = await umzug.up();
        if (executed.length === 0) {
          console.log(`✨ Nenhuma migration pendente para o schema: ${schema_name}`);
          summary.details.push({ schema: schema_name, status: 'ok', applied: 0 });
        } else {
          console.log(`✅ ${executed.length} migration(s) aplicada(s) com sucesso no schema: ${schema_name}`);
          executed.forEach(m => console.log(`   ✔ ${m.name}`));
          summary.details.push({ schema: schema_name, status: 'ok', applied: executed.length, migrations: executed.map(m => m.name) });
        }
        summary.schemasOk++;
      } catch (error) {
        console.error(`❌ Erro ao migrar o schema [${schema_name}]:`, error.message);
        summary.schemasFailed++;
        summary.details.push({ schema: schema_name, status: 'error', error: error.message });
      }
    }
  } catch (error) {
    console.error('[MIGRATIONS] Erro fatal ao buscar schemas:', error.message);
    throw error;
  } finally {
    if (closeConnection) {
      await sequelize.close();
    }
  }

  console.log(`\n🏁 Migração concluída: ${summary.schemasOk}/${summary.totalSchemas} schemas OK` +
    (summary.schemasFailed > 0 ? ` | ${summary.schemasFailed} com erro` : ''));

  return summary;
}

// Quando executado diretamente via CLI (npm run migrate),
// roda as migrations e fecha a conexão ao final.
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('migrate-all.js') ||
  process.argv[1].includes('migrate-all')
);

if (isDirectExecution) {
  runAllMigrations({ closeConnection: true })
    .then(summary => {
      if (summary.schemasFailed > 0) {
        process.exit(1);
      }
    })
    .catch(() => {
      process.exit(1);
    });
}
