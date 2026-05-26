import { Sequelize } from 'sequelize';
import 'dotenv/config';
import config from './config.mjs'

const sequelize = new Sequelize(config[process.env.NODE_ENV || 'development']);

const connectDB = async () => {
  try {
    await sequelize.authenticate();

    // Limpar tabelas _backup residuais do SQLite que podem ter ficado de um sync anterior interrompido
    try {
      const [backupTables] = await sequelize.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_backup';"
      );
      for (const row of backupTables) {
        await sequelize.query(`DROP TABLE IF EXISTS \`${row.name}\`;`);
        console.log(`Dropped residual backup table: ${row.name}`);
      }
    } catch (cleanupErr) {
      // Se não for SQLite (ex: Postgres), esse erro é esperado e ignorado
      console.log('Backup table cleanup skipped (non-SQLite or no residual tables).');
    }

    await sequelize.sync();
    console.log('PostgreSQL/SQLite connected and synced via Sequelize');
 
    // Backfill de numeração sequencial para vendas antigas
    try {
      const { default: VendaDireta } = await import('../models/VendaDireta.js');
      const salesWithoutNumber = await VendaDireta.findAll({
        where: { numero_venda: null },
        order: [['data_venda', 'ASC'], ['id', 'ASC']]
      });
      if (salesWithoutNumber.length > 0) {
        let currentMax = await VendaDireta.max('numero_venda') || 0;
        for (const sale of salesWithoutNumber) {
          currentMax += 1;
          sale.numero_venda = currentMax;
          await sale.save();
        }
        console.log(`Backfilled ${salesWithoutNumber.length} sales with sequential control numbers.`);
      }
    } catch (backfillError) {
      console.error('Error backfilling sales numbers:', backfillError);
    }
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
};

export { sequelize, connectDB };
