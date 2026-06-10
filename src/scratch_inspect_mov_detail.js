import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getMovimentacaoEstoqueModel } from './models/MovimentacaoEstoque.js';

async function run() {
  await connectDB();
  const schema = 'company_salon';
  await tenantStorage.run(schema, async () => {
    const m = await getMovimentacaoEstoqueModel().findByPk('9583b7e2-16f7-45ee-a5f9-765f6f2ba3ce');
    if (m) {
      console.log(`ID: ${m.id}`);
      console.log(`quantidade: ${m.quantidade}`);
      console.log(`quantidade_anterior: ${m.quantidade_anterior}`);
      console.log(`quantidade_atual: ${m.quantidade_atual}`);
    } else {
      console.log("Movement not found");
    }
  });
  process.exit(0);
}

run();
