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

    await sequelize.sync({ alter: true });
    console.log('PostgreSQL connected via Sequelize');
 
    // Check and add missing columns to 'despesas' table in SQLite/Postgres
    try {
      const columnsToAdd = [
        { name: 'data_documento', type: 'VARCHAR(50) DEFAULT \'\'' },
        { name: 'status', type: 'VARCHAR(50) DEFAULT \'Aberto\'' },
        { name: 'numero_documento', type: 'VARCHAR(100) DEFAULT \'\'' },
        { name: 'fornecedor', type: 'VARCHAR(255) DEFAULT \'\'' },
        { name: 'baixado_por', type: 'VARCHAR(255) DEFAULT NULL' },
        { name: 'baixado_em', type: 'TIMESTAMP DEFAULT NULL' }
      ];

      for (const col of columnsToAdd) {
        try {
          await sequelize.query(`ALTER TABLE despesas ADD COLUMN ${col.name} ${col.type};`);
          console.log(`Added column ${col.name} to despesas table successfully.`);
        } catch (colError) {
          // If column already exists, Sequelize throws an error which we safely ignore
          console.log(`Column ${col.name} check in despesas: ${colError.message.includes('duplicate column') || colError.message.includes('already exists') ? 'Already exists' : colError.message}`);
        }
      }
    } catch (dbAlterError) {
      console.error('Error manual altering despesas table:', dbAlterError);
    }

    // Check and add missing columns to 'outras_receitas' table in SQLite/Postgres
    try {
      const columnsToAddReceitas = [
        { name: 'status', type: 'VARCHAR(50) DEFAULT \'Aberto\'' },
        { name: 'numero_documento', type: 'VARCHAR(100) DEFAULT \'\'' },
        { name: 'cliente', type: 'VARCHAR(255) DEFAULT \'\'' },
        { name: 'data_documento', type: 'VARCHAR(50) DEFAULT \'\'' },
        { name: 'data_vencimento', type: 'VARCHAR(50) DEFAULT \'\'' },
        { name: 'recebido', type: 'BOOLEAN DEFAULT 0' },
        { name: 'forma_pagamento', type: 'VARCHAR(100) DEFAULT \'\'' },
        { name: 'baixado_por', type: 'VARCHAR(255) DEFAULT NULL' },
        { name: 'baixado_em', type: 'TIMESTAMP DEFAULT NULL' }
      ];

      for (const col of columnsToAddReceitas) {
        try {
          await sequelize.query(`ALTER TABLE outras_receitas ADD COLUMN ${col.name} ${col.type};`);
          console.log(`Added column ${col.name} to outras_receitas table successfully.`);
        } catch (colError) {
          console.log(`Column ${col.name} check in outras_receitas: ${colError.message.includes('duplicate column') || colError.message.includes('already exists') ? 'Already exists' : colError.message}`);
        }
      }
    } catch (dbAlterError) {
      console.error('Error manual altering outras_receitas table:', dbAlterError);
    }

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
