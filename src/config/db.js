import { Sequelize } from 'sequelize';
import 'dotenv/config';
import config from './config.mjs'

const sequelize = new Sequelize(config[process.env.NODE_ENV || 'development']);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL connected via Sequelize');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
};

export { sequelize, connectDB };
