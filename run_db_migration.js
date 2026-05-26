import { sequelize } from './src/config/db.js';
import addSoftDelete from './src/migrations/20260522120000-add-soft-delete-columns.js';
import addCommissions from './src/migrations/20260522132600-add-commission-percentages-to-colaboradores.js';
import createFornecedores from './src/migrations/20260525230000-create-fornecedores.js';
import addColumnsToDespesas from './src/migrations/20260525231000-add-columns-to-despesas.js';
import addColumnsToOutrasReceitas from './src/migrations/20260525232000-add-columns-to-outras-receitas.js';
import Sequelize from 'sequelize';

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    const queryInterface = sequelize.getQueryInterface();

    console.log('Running soft delete migration (up)...');
    try {
      await addSoftDelete.up(queryInterface, Sequelize);
      console.log('Soft delete migration completed.');
    } catch (e) {
      console.log('Soft delete migration skipped or already applied:', e.message);
    }

    console.log('Running commissions migration (up)...');
    try {
      await addCommissions.up(queryInterface, Sequelize);
      console.log('Commissions migration completed.');
    } catch (e) {
      console.log('Commissions migration skipped or already applied:', e.message);
    }

    console.log('Running create fornecedores migration (up)...');
    try {
      await createFornecedores.up(queryInterface, Sequelize);
      console.log('Fornecedores migration completed.');
    } catch (e) {
      console.log('Fornecedores migration skipped or already applied:', e.message);
    }

    console.log('Running add columns to despesas migration (up)...');
    try {
      await addColumnsToDespesas.up(queryInterface, Sequelize);
      console.log('Add columns to despesas migration completed.');
    } catch (e) {
      console.log('Add columns to despesas migration skipped or already applied:', e.message);
    }

    console.log('Running add columns to outras receitas migration (up)...');
    try {
      await addColumnsToOutrasReceitas.up(queryInterface, Sequelize);
      console.log('Add columns to outras receitas migration completed.');
    } catch (e) {
      console.log('Add columns to outras receitas migration skipped or already applied:', e.message);
    }

    console.log('Migrations execution finished.');
    process.exit(0);
  } catch (error) {
    console.error('Migration execution failed:', error);
    process.exit(1);
  }
}

run();
