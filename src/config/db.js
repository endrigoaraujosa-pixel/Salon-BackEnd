import { Sequelize } from 'sequelize';
import 'dotenv/config';
import config from './config.mjs'
import { getTenantSchema } from './tenantContext.js';

const sequelize = new Sequelize(config[process.env.NODE_ENV || 'development']);

const isPostgres = sequelize.options.dialect === 'postgres';
export const db = new Proxy({}, {
  get(_, modelName) {
    const tenantId = getTenantSchema();
    if (!tenantId) throw new Error('No tenant context');
    const models = sequelize.models;
    if (!models[modelName]) {
      throw new Error(`Model "${modelName}" not found for tenant "${tenantId}"`);
    }

    return models[modelName].schema(tenantId);
  }
});



if (isPostgres) {

  const hooksToInjectSchema = [
    'beforeFind',
    'beforeCount',
    'beforeCreate',
    'beforeUpdate',
    'beforeDestroy',
    'beforeBulkCreate',
    'beforeBulkUpdate',
    'beforeBulkDestroy',
    'beforeUpsert'
  ];

  hooksToInjectSchema.forEach((hookName) => {
    sequelize.addHook(hookName, (arg1, arg2) => {
      const schema = getTenantSchema();
      if (schema) {
        const isBulkOrFind = hookName.startsWith('beforeBulk') ||
          hookName === 'beforeFind' ||
          hookName === 'beforeCount' ||
          hookName === 'beforeUpsert';
        const options = isBulkOrFind ? arg1 : arg2;


        if (options && !options.schema) {
          options.schema = schema;
        }
      }
    });
  });
}

const connectDB = async () => {
  try {
    await sequelize.authenticate();
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
};

export { sequelize, connectDB };

