import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';
import { tenantStorage } from '../src/config/tenantContext.js';

// The real controller and Sequelize queries run against an isolated database.
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db, connectDB: async () => {} } });
const models = {};
for (const name of ['Agendamento', 'VendaDireta', 'Despesa', 'OutrasReceitas', 'Produto', 'Servico',
  'Colaborador', 'Categoria', 'TaxaCartao', 'ColaboradorComissaoServico', 'ConfiguracaoSistema', 'Pagamento']) {
  models[name] = (await import(`../src/models/${name}.js`))[`get${name}Model`];
}
const { relatorioDre, relatorioResultadoOperacional } = await import('../src/controllers/reportController.js');
const tenant = callback => tenantStorage.run('dre_test', callback);
const query = { data_inicio: '2026-09-01', data_fim: '2026-09-30' };
const call = async overrides => tenant(async () => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await relatorioDre({ query: { ...query, ...overrides } }, res);
  return res;
});
before(async () => tenant(async () => {
  for (const getModel of Object.values(models)) await getModel().sync();
  await models.Despesa().bulkCreate([
    { descricao: 'Documento setembro', valor: 30, tipo: 'fixo', data_documento: '2026-09-12', data_vencimento: '2026-10-01', data_pagamento: '2026-10-01' },
    { descricao: 'Sem documento', valor: 20, tipo: 'outro', data_documento: '', data_vencimento: '2026-09-30' },
    { descricao: 'Documento agosto pago setembro', valor: 900, data_documento: '2026-08-12', data_pagamento: '2026-09-01' },
    { descricao: 'Cancelada', valor: 900, data_documento: '2026-09-12', status: 'Cancelado' },
    { descricao: 'Excluída', valor: 900, data_documento: '2026-09-12', deletado: 'S' },
    { descricao: 'Estoque', valor: 200, data_documento: '2026-09-12', entrada_estoque_id: 'entrada' }
  ]);
  await models.VendaDireta().create({ id: 'v1', produto_id: 'p', produto_nome: 'Produto', quantidade: 1,
    data_venda: '2026-09-30T23:59:59.999Z', valor_total: 100, status: 'pago',
    itens: [{ produto_id: 'p', quantidade: 1, subtotal: 100, custo_unitario: 10 }] });
  await models.Pagamento().create({ id: 'payment', venda_direta_id: 'v1', valor: 100, forma_pagamento: 'cartao_credito',
    cartao_taxa_valor: 3, data_hora: '2026-10-01T12:00:00Z' });
}));
after(() => db.close());

test('consulta real mantém competência, último milissegundo e taxa vinculada fora do mês', async () => {
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.receita_bruta, 100);
  assert.equal(res.body.custo_produtos, 10);
  assert.equal(res.body.despesas_operacionais, 53);
  assert.equal(res.body.lucro_liquido, 37);
  assert.equal(res.body.compras_estoque_excluidas, 200);
  await tenant(async () => assert.equal(await models.TaxaCartao().count(), 0, 'GET não cria taxas'));
});

test('API rejeita datas e situação inválidas', async () => {
  assert.equal((await call({ data_inicio: '2026-02-30' })).statusCode, 400);
  assert.equal((await call({ status: 'cancelado' })).statusCode, 400);
});

test('consulta usa apenas o schema da empresa ativa', async () => {
  await tenantStorage.run('dre_other', async () => {
    for (const getModel of Object.values(models)) await getModel().sync();
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await relatorioDre({ query }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.receita_bruta, 0);
    assert.equal(res.body.despesas_operacionais, 0);
  });
});

test('DRE, rentabilidade de serviços/produtos e consolidado conciliam taxas pela data da operação', async () => {
  await tenantStorage.run('dre_allocation', async () => {
    for (const getModel of Object.values(models)) await getModel().sync();
    await models.Agendamento().create({ id: 'a', cliente_id: 'c', status: 'concluido',
      data_hora: '2026-09-30T23:59:59.999Z', valor_total: 240,
      itens: [1, 2, 3].map(index => ({ nome: `Serviço ${index}`, valor: 80, produtos_utilizados: [] })) });
    await models.VendaDireta().create({ id: 'v', produto_id: 'p1', produto_nome: 'Carrinho', quantidade: 2,
      data_venda: '2026-09-10T12:00:00Z', status: 'pago', valor_total: 100,
      itens: [1, 2].map(index => ({ produto_id: `p${index}`, produto_nome: `Produto ${index}`, quantidade: 1, subtotal: 50, custo_unitario: 10, comissao_pct: 0 })) });
    await models.Pagamento().bulkCreate([
      { agendamento_id: 'a', valor: 240, forma_pagamento: 'cartao_credito', cartao_taxa_valor: 12.94, data_hora: '2026-10-02T12:00:00Z' },
      { venda_direta_id: 'v', valor: 100, forma_pagamento: 'cartao_credito', cartao_taxa_valor: 5.39, data_hora: '2026-10-02T12:00:00Z' }
    ]);
    const invoke = async handler => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ query }, res);
      assert.equal(res.code, 200);
      return res.body;
    };
    const dre = await invoke(relatorioDre);
    const profitability = await invoke(relatorioResultadoOperacional);
    const cents = rows => rows.reduce((sum, row) => sum + Math.round(row.taxas * 100), 0);
    assert.equal(cents(profitability.servicos), 1294);
    assert.equal(cents(profitability.produtos), 539);
    assert.equal(cents(profitability.detalhes_servicos), 1294);
    assert.equal(cents(profitability.detalhes_produtos), 539);
    assert.equal(profitability.consolidado.taxas, 18.33);
    assert.equal(dre.taxas_cartao.total, profitability.consolidado.taxas);
    assert.equal(await models.TaxaCartao().count(), 0);
  });
});
