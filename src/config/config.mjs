import pg from 'pg';
export default {
  development: {
    username: "postgres",
    password: "teste",
    database: "postgres",
    host: "127.0.0.1",
    dialect: "postgres",
    timestamps: false,
  },
  test: {
    username: "root",
    password: null,
    database: "database_test",
    host: "127.0.0.1",
    dialect: "mysql"
  },
  production: {
    username: process.env.DB_USENAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB,
    host: process.env.DB_HOST,
    dialect: "postgres",
    port: process.env.DB_PORT,
    dialectModule: pg,
    timestamps: false,

  }
}

