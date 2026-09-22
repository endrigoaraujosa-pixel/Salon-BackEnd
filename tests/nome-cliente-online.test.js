import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeClienteCompleto, normalizarNomeCliente } from '../src/utils/nomeClienteOnline.js';

test('exige nome e sobrenome, sem aceitar números ou espaços como sobrenome', () => {
  for (const nome of ['', 'Maria', 'Maria   ', 'Maria 123', 'Maria -', null, 123, {}, 'A'.repeat(256) + ' Silva']) {
    assert.equal(nomeClienteCompleto(nome), false, String(nome));
  }
});

test('aceita nomes compostos, acentos, hífens e apóstrofos', () => {
  for (const nome of ['Maria Silva', 'João da Silva', 'Ana-Maria Souza', "José D'Ávila", 'Ana D’Ávila', 'Li Wu', '  Maria   Silva  ']) {
    assert.equal(nomeClienteCompleto(nome), true, nome);
  }
  assert.equal(normalizarNomeCliente('  Maria\t da   Silva  '), 'Maria da Silva');
});
