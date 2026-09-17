import { sequelize } from '../config/db.js';
import { encryptCredential, decryptCredential } from '../security/credentialEncryption.js';

export async function encryptB2Credentials(schema) {
  if (!/^company_[a-z0-9_]+$/.test(schema)) throw new Error('Schema inválido.');
  const q = sequelize.getQueryInterface();
  const table = q.queryGenerator.quoteTable({ schema, tableName: 'configuracao_sistema' });
  return sequelize.transaction(async transaction => {
    const [rows] = await sequelize.query(`SELECT id, b2_application_key FROM ${table} WHERE b2_application_key IS NOT NULL FOR UPDATE`, { transaction });
    let changed = 0;
    for (const row of rows) {
      const secret = row.b2_application_key;
      const encrypted = encryptCredential(secret, schema);
      if (decryptCredential(encrypted, schema) !== decryptCredential(secret, schema)) throw new Error('Falha na verificação da criptografia.');
      if (encrypted === secret) continue;
      await sequelize.query(`UPDATE ${table} SET b2_application_key = :encrypted WHERE id = :id`, {
        replacements: { encrypted, id: row.id }, transaction
      });
      changed++;
    }
    return changed;
  });
}
