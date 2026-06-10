import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getProdutoModel } from './models/Produto.js';

async function run() {
  await connectDB();
  const schema = 'company_salon';
  await tenantStorage.run(schema, async () => {
    const products = await getProdutoModel().findAll();
    console.log("=== PRODUCTS ===");
    for (const p of products) {
      console.log(`ID: ${p.id} | Nome: ${p.nome} | Qtd Estoque: ${p.quantidade_estoque} | Custo Unitario: ${p.custo_unitario} | Qtd por Unidade: ${p.quantidade_por_unidade} | Unidade Medida Insumo: ${p.unidade_medida_insumo} | Unidade Medida: ${p.unidade_medida}`);
    }
  });
  process.exit(0);
}

run();
