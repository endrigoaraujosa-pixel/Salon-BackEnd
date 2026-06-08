import { sequelize } from '../src/config/db.js';


const schemaName = process.argv[2];

await sequelize.createSchema(`company_${schemaName}`);

await sequelize.close();
