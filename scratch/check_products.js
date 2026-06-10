import { connectDB, sequelize } from '../src/config/db.js';
import { getProdutoModel } from '../src/models/Produto.js';
import { tenantStorage } from '../src/config/tenantContext.js';

async function check() {
  await connectDB();
  tenantStorage.run('company_salon', async () => {
    const products = await getProdutoModel().findAll();
    console.log(JSON.stringify(products.map(p => ({
      id: p.id,
      nome: p.nome,
      custo_unitario: p.custo_unitario,
      quantidade_por_unidade: p.quantidade_por_unidade,
      unidade_medida: p.unidade_medida,
      unidade_medida_insumo: p.unidade_medida_insumo
    })), null, 2));
    process.exit(0);
  });
}

check();
