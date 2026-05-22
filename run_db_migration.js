import { sequelize } from './src/config/db.js';
import addSoftDelete from './src/migrations/20260522120000-add-soft-delete-columns.js';
import addCommissions from './src/migrations/20260522132600-add-commission-percentages-to-colaboradores.js';
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

    console.log('Migrations execution finished.');
    process.exit(0);
  } catch (error) {
    console.error('Migration execution failed:', error);
    process.exit(1);
  }
}

run();
