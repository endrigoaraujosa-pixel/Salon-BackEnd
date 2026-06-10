import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getMovimentacaoEstoqueModel } from './models/MovimentacaoEstoque.js';

async function run() {
  await connectDB();
  const schema = 'company_salon';
  await tenantStorage.run(schema, async () => {
    const movs = await getMovimentacaoEstoqueModel().findAll({
      where: { produto_id: '8a11e5bb-b4f7-4469-af48-a27c256f5ca4' },
      order: [['createdAt', 'ASC']]
    });
    console.log("=== MOVEMENTS FOR SHAMPOO NOVO RENDE ===");
    for (const m of movs) {
      console.log(`ID: ${m.id} | Tipo: ${m.tipo} | Quantidade: ${m.quantidade} | Origem: ${m.origem} | Criado Em: ${m.createdAt}`);
    }
  });
  process.exit(0);
}

run();
