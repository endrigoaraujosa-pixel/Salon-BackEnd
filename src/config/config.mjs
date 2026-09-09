import pg from 'pg';
import 'dotenv/config';

const databaseConfig = {
  username: process.env.DB_USERNAME || process.env.DB_USENAME || 'postgres',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || process.env.DB || 'salon_backend',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  dialect: 'postgres',
  dialectModule: pg,
  timestamps: false,
};

export default {
  development: databaseConfig,
  test: {
    username: "root",
    password: null,
    database: "database_test",
    host: "127.0.0.1",
    dialect: "mysql"
  },
  production: databaseConfig,
}

