import { tenantStorage } from '../config/tenantContext.js';
import { sequelize } from '../config/db.js';
import { QueryTypes } from 'sequelize';

export const tenantMiddleware = async (req, res, next) => {
  const schemaHeader = req.headers['x-tenant-id'];  
  
  if (!schemaHeader) {
    return res.status(400).json({
      detail: 'inválido.'
    });
  }

  const schemaName = schemaHeader?.trim().toLowerCase();
  const schema = schemaHeader ? `company_${schemaName}` : undefined;
  // const isValidSchema = /^[a-z0-9_]+$/.test(schema);

  const tenantQuery = `SELECT EXISTS (
    SELECT 1 
    FROM pg_namespace 
    WHERE nspname = ?
    );`;

  const tenant = await sequelize.query(tenantQuery, { replacements: [schema], type: QueryTypes.SELECT })
  if (!tenant[0].exists) {
    return res.status(404).json({
      detail: 'Tenant não encontrado.'
    });
  }

  tenantStorage.run(schema, () => {
    next();
  });
};