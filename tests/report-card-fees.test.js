import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateMoney, allocateCardFees, reportCardFee, calculateCardFee } from '../src/services/reportCardFees.js';
import { buildDre } from '../src/services/dre.js';

test('rateio conserva os centavos, inclusive restos, valores zero e estornos', () => {
  assert.deepEqual(allocateMoney(12.94, [80, 80, 80]), [4.32, 4.31, 4.31]);
  assert.deepEqual(allocateMoney(5.39, [50, 50]), [2.70, 2.69]);
  assert.deepEqual(allocateMoney(0.01, [0, 0, 0]), [0.01, 0, 0]);
  assert.deepEqual(allocateMoney(0.03, [0, 50]), [0, 0.03]);
  assert.deepEqual(allocateMoney(-5.39, [50, 50]), [-2.70, -2.69]);
  assert.deepEqual(allocateMoney(10, []), []);
});

test('soma do rateio permanece igual à taxa para diferentes valores e quantidades de itens', () => {
  for (let cents = 1; cents < 1500; cents += 17) {
    for (let count = 1; count <= 20; count++) {
      const weights = Array.from({ length: count }, (_, index) => (index * 73 + cents) % 151);
      const allocated = allocateMoney(cents / 100, weights);
      assert.equal(allocated.reduce((sum, value) => sum + Math.round(value * 100), 0), cents);
      assert.ok(allocated.every(value => value >= 0));
    }
  }
});

test('taxa registrada prevalece, inclusive zero e forma de pagamento removida', () => {
  assert.equal(reportCardFee({ forma_pagamento: 'antiga', cartao_tipo: 'credito', cartao_taxa_valor: '13.47', valor: 250 }, []).taxa_valor, 13.47);
  assert.equal(reportCardFee({ cartao_tipo: 'credito', cartao_taxa_valor: 0, valor: 250 }, []).taxa_valor, 0);
  assert.equal(reportCardFee({ forma_pagamento: 'pix', valor: 250 }, []), null);
  assert.ok(reportCardFee({ forma_pagamento: 'cartao_credito', valor: 250 }, []).incompleta);
});

test('filtrar categorias preserva o mesmo rateio dos relatórios de rentabilidade', () => {
  const pagamentos = [{ id: 'p1', agendamento_id: 'a', cartao_tipo: 'credito', cartao_taxa_valor: 0.01, valor: 50 },
    { id: 'p2', agendamento_id: 'a', cartao_tipo: 'credito', cartao_taxa_valor: 0.01, valor: 50 }];
  const data = { data_inicio: '2026-09-01', data_fim: '2026-09-25', pagamentos,
    categorias: [{ id: 'c1', nome: 'A' }, { id: 'c2', nome: 'B' }],
    agendamentos: [{ id: 'a', status: 'concluido', data_hora: '2026-09-10', valor_total: 100,
      itens: [{ valor: 50, categoria_id: 'c1' }, { valor: 50, categoria_id: 'c2' }] }] };
  const allocated = allocateCardFees(pagamentos, [], [50, 50]);
  assert.equal(buildDre({ ...data, categoria: 'c1' }).taxas_cartao.total, allocated[0]);
  assert.equal(buildDre({ ...data, categoria: 'c2' }).taxas_cartao.total, allocated[1]);
  assert.equal(buildDre(data).taxas_cartao.total, 0.02);
});

test('percentuais cadastrados usam arredondamento decimal correto nos seis casos identificados', () => {
  for (const [base, percent, expected] of [[250, 5.39, 13.48], [50, 5.39, 2.70], [110, 3.15, 3.47],
    [130, 6.85, 8.91], [450, 6.85, 30.83], [550, 6.85, 37.68], [350, 2.58, 9.03], [420, 1.37, 5.75],
    ['100.50', '1.2345', 1.24], [0, 5.39, 0], [100, 0, 0], [-250, 5.39, -13.48], [1e-7, 1, 0]]) {
    assert.equal(calculateCardFee(base, percent), expected, `${base} × ${percent}%`);
  }
});

test('cada parcelamento usa sua taxa de cadastro e débito usa percentual geral', () => {
  const credit = { forma_pagamento: 'credito_visa', tipo_cartao: 'credito', percentual: 0, taxa_1x: 3.15,
    taxa_2x: 5.39, taxa_3x: 6.12, taxa_4x: 6.85 };
  for (const [parcelas, expected] of [[1, 7.88], [2, 13.48], [3, 15.30], [4, 17.13]]) {
    assert.equal(reportCardFee({ forma_pagamento: 'credito_visa', valor: 250, cartao_parcelas: parcelas }, [credit]).taxa_valor, expected);
  }
  assert.equal(reportCardFee({ forma_pagamento: 'debito_visa', valor: 420 },
    [{ forma_pagamento: 'debito_visa', tipo_cartao: 'debito', percentual: 1.37, taxa_1x: 0 }]).taxa_valor, 5.75);
});
