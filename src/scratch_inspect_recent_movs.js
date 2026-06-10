import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getMovimentacaoEstoqueModel } from './models/MovimentacaoEstoque.js';

async function run() {
  await connectDB();
  const schema = 'company_salon';
  await tenantStorage.run(schema, async () => {
    const movs = await getMovimentacaoEstoqueModel().findAll({
      order: [['createdAt', 'DESC']],
      limit: 20
    });
    console.log("=== LAST 20 MOVEMENTS ===");
    for (const m of movs) {
      console.log(`ID: ${m.id} | Produto: ${m.produto_nome} | Tipo: ${m.tipo} | Qtd: ${m.quantidade} | Motivo: ${m.motivo} | Criado Em: ${m.createdAt}`);
    }
  });
  process.exit(0);
}

run();
