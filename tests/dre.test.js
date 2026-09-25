import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDre, validDrePeriod } from '../src/services/dre.js';

const defaults = { data_inicio: '2026-09-01', data_fim: '2026-09-30', hoje: '2026-09-25' };
const run = overrides => buildDre({ ...defaults, ...overrides });
const sale = overrides => ({ id: 'v', status: 'pago', data_venda: '2026-09-10', valor_total: 200, ...overrides });
const service = overrides => ({ id: 'a', status: 'concluido', data_hora: '2026-09-10', valor_total: 100, ...overrides });
const expense = overrides => ({ id: 'd', valor: 20, data_documento: '2026-09-10', status: 'Aberto', tipo: 'fixo', ...overrides });
const total = rows => Math.round(rows.reduce((acc, row) => acc + row.valor, 0) * 100) / 100;

test('DRE inclui CMV, insumos, duas comissões, taxas e despesas; todos os detalhes fecham', () => {
  const report = run({
    agendamentos: [service({ itens: [{ nome: 'Corte', valor: 100, colaborador_id: 'c', auxiliar_id: 'aux',
      comissao_valor_calculado: 30, comissao_valor_calculado_auxiliar: 10,
      produtos_utilizados: [{ produto_id: 'shampoo', quantidade: 20, custo_proporcional: 0.5 }] }] })],
    vendas: [sale({ colaborador_id: 'c', itens: [{ produto_id: 'p', quantidade: 2, subtotal: 200, custo_unitario: 30, comissao_pct: 5 }] })],
    pagamentos: [{ id: 'card', venda_direta_id: 'v', valor: 200, cartao_tipo: 'credito', cartao_taxa_valor: '5.00', data_hora: '2026-10-01' }],
    despesas: [expense({ valor: 20 }), expense({ id: 'unclassified', tipo: 'outro', valor: 7 }), expense({ id: 'cancel', status: 'Cancelado', valor: 999 })]
  });
  assert.equal(report.receita_bruta, 300);
  assert.equal(report.custo_produtos, 60);
  assert.equal(report.custo_insumos, 10);
  assert.equal(report.comissoes, 50);
  assert.equal(report.taxas_cartao.credito, 5);
  assert.equal(report.despesas.nao_classificadas, 7);
  assert.equal(report.lucro_liquido, 148);
  for (const [key, detail] of [['custo_produtos', 'cmv'], ['custo_insumos', 'insumos'], ['comissoes', 'comissoes'], ['total_custos_despesas', 'custos_despesas'], ['despesas_operacionais', 'despesas_operacionais']]) {
    assert.equal(report[key], total(report.detalhes[detail]));
  }
  assert.equal(total(Object.values(report.despesas_por_categoria).map(valor => ({ valor }))), report.despesas_operacionais);
});

test('carrinho e serviços mistos filtram somente os itens da categoria, incluindo taxas proporcionais', () => {
  const report = run({ categoria: 'A', categorias: [{ id: 'A', nome: 'Cabelo' }, { id: 'B', nome: 'Outros' }],
    produtos: [{ id: 'p1', categoria_id: 'A', custo_unitario: 10 }, { id: 'p2', categoria_id: 'B', custo_unitario: 40 }],
    vendas: [sale({ itens: [{ produto_id: 'p1', quantidade: 1, subtotal: 50 }, { produto_id: 'p2', quantidade: 1, subtotal: 150 }] })],
    agendamentos: [service({ itens: [{ valor: 25, categoria_id: 'A' }, { valor: 75, categoria_id: 'B' }] })],
    pagamentos: [{ id: 'p', venda_direta_id: 'v', valor: 200, cartao_tipo: 'debito', cartao_taxa_valor: 8 }]
  });
  assert.equal(report.receita_bruta, 75);
  assert.equal(report.custo_produtos, 10);
  assert.equal(report.taxas_cartao.debito, 2);
  assert.equal(report.total_vendas_diretas, 1);
});

test('históricos zero são preservados mesmo com cadastro alterado/excluído', () => {
  const report = run({ produtos: [{ id: 'p', custo_unitario: 999, quantidade_por_unidade: 1, deletado: 'S' }],
    colaboradores: [{ id: 'c', comissao_sozinho: 90 }],
    agendamentos: [service({ itens: [{ valor: 100, colaborador_id: 'c', comissao_valor_calculado: 0,
      produtos_utilizados: [{ produto_id: 'p', custo_proporcional: 0, quantidade: 5 }] }] })],
    vendas: [sale({ itens: [{ produto_id: 'p', quantidade: 1, subtotal: 200, custo_unitario: 0 }] })],
    pagamentos: [{ agendamento_id: 'a', valor: 100, cartao_tipo: 'credito', cartao_taxa_valor: 0 }]
  });
  assert.equal(report.custo_produtos, 0);
  assert.equal(report.custo_insumos, 0);
  assert.equal(report.comissoes, 0);
  assert.equal(report.taxas_cartao.total, 0);
});

test('insumos convertem unidade fracionada e comissão preserva base final histórica', () => {
  const report = run({ agendamentos: [service({ itens: [{ valor: 100, colaborador_id: 'c',
    base_comissao_final: 80, comissao_percentual: 25,
    produtos_utilizados: JSON.stringify([{ quantidade: 50, custo_unitario: 40, quantidade_por_unidade: 200 }]) }] })] });
  assert.equal(report.custo_insumos, 10);
  assert.equal(report.comissoes, 20);
});

test('compras de estoque são excluídas, contas usam documento e não reaparecem no pagamento', () => {
  const despesas = [expense({ id: 'stock', valor: 500, entrada_estoque_id: 'e' }),
    expense({ id: 'payable', valor: 75, data_pagamento: '2026-10-10', pago: true }),
    expense({ id: 'old', valor: 90, data_documento: '2026-08-01', data_pagamento: '2026-09-10' })];
  const report = run({ despesas });
  assert.equal(report.compras_estoque_excluidas, 500);
  assert.equal(report.despesas_operacionais, 75);
  assert.equal(run({ despesas, data_inicio: '2026-10-01', data_fim: '2026-10-31' }).despesas_operacionais, 0);
});

test('não inventa taxa padrão nem cria comissão de produto sem vendedor', () => {
  const report = run({ vendas: [sale({ itens: [{ produto_id: 'p', quantidade: 1, subtotal: 200, custo_unitario: 10, comissao_pct: 50 }] })],
    pagamentos: [{ venda_direta_id: 'v', forma_pagamento: 'cartao_credito', valor: 200 }] });
  assert.equal(report.comissoes, 0);
  assert.equal(report.taxas_cartao.total, 0);
  assert.ok(report.alertas.some(text => text.includes('sem taxa')));
});

test('taxa histórica por percentual e parcelamento configurado são respeitados', () => {
  const report = run({ vendas: [sale({ itens: [{ quantidade: 1, subtotal: 200, custo_unitario: 10 }] })],
    taxas: [{ forma_pagamento: 'visa', tipo_cartao: 'credito', taxa_3x: 4 }],
    pagamentos: [{ id: '1', venda_direta_id: 'v', forma_pagamento: 'visa', valor: 100, cartao_parcelas: 3 },
      { id: '2', venda_direta_id: 'v', cartao_tipo: 'debito', valor: 100, cartao_taxa_percentual: 1.5 }] });
  assert.equal(report.taxas_cartao.total, 5.5);
});

test('período/status impedem entrada de futuros, cancelados, deletados e pagamentos órfãos', () => {
  const report = run({ agendamentos: [service({ status: 'agendado' }), service({ deletado: 'S' }), service({ data_hora: '2026-10-01' })],
    vendas: [sale({ status: 'cancelado' })], receitas: [expense({ status: 'Cancelado', valor: 999 })],
    pagamentos: [{ venda_direta_id: 'missing', cartao_tipo: 'credito', cartao_taxa_valor: 100 }] });
  assert.equal(report.receita_bruta, 0);
  assert.equal(report.total_custos_despesas, 0);
});

test('competência inclui despesa aberta, normaliza números e recorte mantém período', () => {
  const despesas = [expense({ valor: '10.25', data_documento: '', data_vencimento: '2026-09-15', tipo: 'FIXO' }),
    expense({ valor: '20.50', data_vencimento: '2026-09-28' }), expense({ valor: 999, data_documento: '2026-08-10', data_vencimento: '2026-08-15' })];
  assert.equal(run({ despesas }).despesas_operacionais, 30.75);
  assert.equal(run({ despesas, status: 'vencido' }).despesas_operacionais, 10.25);
  assert.equal(run({ despesas, status: 'pendente' }).despesas_operacionais, 20.5);
});

test('JSON serializado em itens e descontos que não incidem sobre comissão', () => {
  const report = run({ vendas: [sale({ colaborador_id: 'c', desconto_aplicado: '{"incide_comissao":false}',
    itens: JSON.stringify([{ quantidade: 2, subtotal: 160, preco_unitario_original: 100, custo_unitario: 20, comissao_pct: 10 }]) })] });
  assert.equal(report.receita_bruta, 160);
  assert.equal(report.comissoes, 20);
  assert.equal(report.custo_produtos, 40);
});

test('valida datas reais, ordem e formato', () => {
  assert.ok(validDrePeriod('2024-02-29', '2024-03-01'));
  for (const [start, end] of [['2026-02-29', '2026-03-01'], ['2026-09-30', '2026-09-01'], ['', '2026-09-01'], ['25/09/2026', '2026-09-30']])
    assert.equal(validDrePeriod(start, end), false);
});

test('detalhes de crédito e débito separados conciliam valor e preservam metadados do pagamento', () => {
  const report = run({ vendas: [sale({ numero_venda: 42, itens: [{ quantidade: 1, subtotal: 200, custo_unitario: 10 }] })],
    pagamentos: [
      { id: 'credit', venda_direta_id: 'v', forma_pagamento: 'cartao_credito', cartao_tipo: 'credito',
        valor: 120, cartao_taxa_valor: '3.60', cartao_taxa_percentual: 3, cartao_bandeira: 'Visa', cartao_parcelas: 2,
        data_hora: '2026-09-11', data_recebimento_prevista: '2026-10-11' },
      { id: 'debit', venda_direta_id: 'v', forma_pagamento: 'cartao_debito', cartao_tipo: 'debito',
        valor: 80, cartao_taxa_valor: '0.80', cartao_taxa_percentual: 1, cartao_bandeira: 'Mastercard', cartao_parcelas: 1 },
      { id: 'deleted', venda_direta_id: 'v', cartao_tipo: 'credito', valor: 999, cartao_taxa_valor: 99, deletado: 'S' }
    ] });
  const credits = report.detalhes.taxas_cartao.filter(row => row.tipo === 'credito');
  const debits = report.detalhes.taxas_cartao.filter(row => row.tipo === 'debito');
  assert.equal(credits.length, 1);
  assert.equal(debits.length, 1);
  assert.equal(total(credits), report.taxas_cartao.credito);
  assert.equal(total(debits), report.taxas_cartao.debito);
  assert.equal(credits[0].pagamento_id, 'credit');
  assert.equal(credits[0].bandeira, 'Visa');
  assert.equal(credits[0].parcelas, 2);
  assert.equal(credits[0].base_calculo, 120);
  assert.equal(credits[0].valor_liquido, 116.4);
  assert.equal(credits[0].data_recebimento_prevista, '2026-10-11');
  assert.match(credits[0].descricao, /Venda #42/);
  assert.equal(debits[0].valor_liquido, 79.2);
});
