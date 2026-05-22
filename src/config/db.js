import { Sequelize } from 'sequelize';
import 'dotenv/config';
import config from './config.mjs'

const sequelize = new Sequelize(config[process.env.NODE_ENV || 'development']);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: false });
    console.log('PostgreSQL connected via Sequelize');

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
