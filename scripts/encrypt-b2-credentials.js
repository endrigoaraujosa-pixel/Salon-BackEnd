import { sequelize } from '../src/config/db.js';
import { encryptB2Credentials } from '../src/services/encryptB2Credentials.js';

sequelize.options.logging = false;
try {
  const args = process.argv.slice(2);
  const all = args.length === 1 && args[0] === '--all';
  if (!all && (args.length !== 1 || !/^company_[a-z0-9_]+$/.test(args[0]))) {
    throw new Error('Uso: npm run security:encrypt-b2 -- company_nome (ou --all). Execute somente após atualizar o backend.');
  }
  const [rows] = await sequelize.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'company\\_%' ESCAPE '\\'");
  const schemas = all ? rows.map(row => row.schema_name) : args;
  for (const schema of schemas) {
    if (!rows.some(row => row.schema_name === schema)) throw new Error('Schema não encontrado.');
    const changed = await encryptB2Credentials(schema);
    console.log(`${schema}: ${changed} credencial(is) cifrada(s).`);
  }
} catch (error) {
  console.error(error.status === 503 ? error.message : 'Criptografia não concluída. Verifique o schema, a migration e a chave de criptografia do servidor.');
  process.exitCode = 1;
} finally { await sequelize.close(); }
