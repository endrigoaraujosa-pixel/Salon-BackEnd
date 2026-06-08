import { sequelize } from '../src/config/db.js';
import { Umzug, SequelizeStorage } from 'umzug';
import { QueryTypes } from 'sequelize';
import Sequelize from 'sequelize';

// 2. Lista de schemas que você deseja migrar
// (Pode vir de um array estático ou de uma consulta ao banco)
const schemasParaMigrar = await sequelize.query(`SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'company_%';`, { type: QueryTypes.SELECT });

async function runMigrations() {
  for (const { schema_name } of schemasParaMigrar) {
    console.log(`\n=========================================`);
    console.log(`🚀 Iniciando migrations no schema: [${schema_name}]`);
    console.log(`=========================================`);

    // Altera temporariamente o schema padrão da instância do Sequelize
    sequelize.options.schema = schema_name;

    // Configura o Umzug para o schema atual
    const umzug = new Umzug({
      migrations: {
        glob: 'src/migrations/*.js', // Caminho para os seus arquivos de migração
        resolve: ({ name, path, context }) => {
          return {
            name,
            up: async () => {
              const migration = await import(`file://${path}`)
              return migration.default.up(context, Sequelize)
            },
            down: async () => {
              const migration = await import(`file://${path}`)
              return migration.default.down(context, Sequelize)
            }
          };

        },
      },
      // Passa o queryInterface atualizado com o schema correto para a migration
      context: sequelize.getQueryInterface(),
      storage: new SequelizeStorage({
        sequelize: sequelize,
        modelName: 'SequelizeMeta', // Tabela que guarda o histórico de migrations
        schema: schema_name,            // Salva o histórico DENTRO do schema atual
      }),
      logger: console,
    });

    try {
      // Executa as migrations pendentes neste schema
      const executed = await umzug.up();
      if (executed.length === 0) {
        console.log(`✨ Nenhuma migration pendente para o schema: ${schema_name}`);
      } else {
        console.log(`✅ Migrations aplicadas com sucesso no schema: ${schema_name}`);
      }
    } catch (error) {
      console.error(`❌ Erro ao migrar o schema [${schema_name}]:`, error);
      // Opcional: break; se quiser interromper caso um dê erro
    }
  }

  // Fecha a conexão com o banco ao finalizar tudo
  await sequelize.close();
  console.log('\n🏁 Processo de migração concluído para todos os schemas.');
}

runMigrations();
