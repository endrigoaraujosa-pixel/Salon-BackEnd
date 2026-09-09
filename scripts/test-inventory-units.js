import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getProdutoModel } from '../src/models/Produto.js';
import { getMovimentacaoEstoqueModel } from '../src/models/MovimentacaoEstoque.js';
import { getInventarioProtocoloModel } from '../src/models/InventarioProtocolo.js';
import { registrarAjusteInventario, registrarInventarioAssistido } from '../src/controllers/estoqueController.js';
const schema = `test_inventory_${randomUUID().replaceAll('-', '')}`;
const call = async (fn, body) => {
  let status = 200, result;
  await fn({ body }, { status(code) { status = code; return this; }, json(value) { result = value; } });
  assert.equal(status, 200, JSON.stringify(result));
  return result;
};
try {
  await sequelize.createSchema(schema);
  await tenantStorage.run(schema, async () => {
    const Produto = getProdutoModel();
    for (const model of [Produto, getMovimentacaoEstoqueModel(), getInventarioProtocoloModel()]) await model.sync();
    const bottle = await Produto.create({ nome: 'Teste 500ml', quantidade_por_unidade: 500, quantidade_estoque: 1000, custo_unitario: 20 });
    const single = await Produto.create({ nome: 'Teste UN', quantidade_por_unidade: 0, quantidade_estoque: 10, custo_unitario: 5 });
    const unit = await call(registrarAjusteInventario, { produto_id: bottle.id, quantidade_contada: 1500 });
    assert.equal((await bottle.reload()).quantidade_estoque, 1500);
    assert.equal(unit.diferenca, 500);
    assert.equal(unit.movimentacao.valor_unitario, 0.04);
    const batch = await call(registrarInventarioAssistido, { itens: [
      { produto_id: bottle.id, quantidade_contada: 1000 },
      { produto_id: single.id, quantidade_contada: 12 }
    ] });
    assert.equal(batch.protocolo.qtd_conferida, 2);
    assert.equal(batch.protocolo.valor_divergencia, 30);
    assert.equal((await bottle.reload()).quantidade_estoque, 1000);
    assert.equal((await single.reload()).quantidade_estoque, 12);
    await call(registrarAjusteInventario, { produto_id: bottle.id, quantidade_contada: 0 });
    assert.equal((await bottle.reload()).quantidade_estoque, 0);
    console.log('PASS: ajuste individual, lote, custo proporcional e zeragem.');
  });
} finally {
  if (/^test_inventory_[a-f0-9]{32}$/.test(schema)) await sequelize.dropSchema(schema, { cascade: true });
  await sequelize.close();
}
