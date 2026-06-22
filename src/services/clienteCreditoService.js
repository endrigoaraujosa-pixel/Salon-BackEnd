import { v4 as uuidv4 } from 'uuid';
import { getClienteModel } from '../models/Cliente.js';
import { getClienteCreditoMovimentacaoModel } from '../models/ClienteCreditoMovimentacao.js';

/**
 * Adiciona crédito a um cliente.
 */
export const adicionarCredito = async (clienteId, { valor, tipo, motivo, observacao, usuarioId, usuarioNome, origem, dispositivo }, { transaction }) => {
  const Cliente = getClienteModel();
  const Movimentacao = getClienteCreditoMovimentacaoModel();

  const client = await Cliente.findByPk(clienteId, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined
  });

  if (!client) {
    throw new Error('Cliente não encontrado');
  }

  const valNum = Number(valor);
  if (isNaN(valNum) || valNum <= 0) {
    throw new Error('Valor inválido para crédito');
  }

  const saldoAnterior = Number(client.saldo_credito || 0);
  const saldoPosterior = Number((saldoAnterior + valNum).toFixed(2));

  client.saldo_credito = saldoPosterior;
  client.data_ultima_movimentacao_credito = new Date();
  await client.save({ transaction });

  const mov = await Movimentacao.create({
    id: uuidv4(),
    cliente_id: clienteId,
    tipo, // e.g. CREDITO_MANUAL, CREDITO_GERADO_VENDA
    tipo_operacao: 'C',
    valor: valNum,
    saldo_anterior: saldoAnterior,
    saldo_posterior: saldoPosterior,
    usuario_id: usuarioId,
    usuario_nome: usuarioNome,
    origem,
    observacao: observacao || motivo || '',
    dispositivo,
    estornado: false
  }, { transaction });

  return { cliente: client, movimentacao: mov };
};

/**
 * Remove crédito de um cliente.
 */
export const removerCredito = async (clienteId, { valor, tipo, motivo, observacao, usuarioId, usuarioNome, origem, dispositivo }, { transaction }) => {
  const Cliente = getClienteModel();
  const Movimentacao = getClienteCreditoMovimentacaoModel();

  const client = await Cliente.findByPk(clienteId, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined
  });

  if (!client) {
    throw new Error('Cliente não encontrado');
  }

  const valNum = Number(valor);
  if (isNaN(valNum) || valNum <= 0) {
    throw new Error('Valor inválido para débito');
  }

  const saldoAnterior = Number(client.saldo_credito || 0);
  if (saldoAnterior < valNum) {
    throw new Error('Saldo de crédito insuficiente');
  }

  const saldoPosterior = Number((saldoAnterior - valNum).toFixed(2));

  client.saldo_credito = saldoPosterior;
  client.data_ultima_movimentacao_credito = new Date();
  await client.save({ transaction });

  const mov = await Movimentacao.create({
    id: uuidv4(),
    cliente_id: clienteId,
    tipo, // e.g. DEBITO_MANUAL, CREDITO_UTILIZADO_VENDA
    tipo_operacao: 'D',
    valor: valNum,
    saldo_anterior: saldoAnterior,
    saldo_posterior: saldoPosterior,
    usuario_id: usuarioId,
    usuario_nome: usuarioNome,
    origem,
    observacao: observacao || motivo || '',
    dispositivo,
    estornado: false
  }, { transaction });

  return { cliente: client, movimentacao: mov };
};

/**
 * Reverte uma movimentação de crédito específica.
 */
export const estornarMovimentacao = async (movimentacaoId, { usuarioId, usuarioNome, dispositivo }, { transaction }) => {
  const Movimentacao = getClienteCreditoMovimentacaoModel();
  const Cliente = getClienteModel();

  const originalMov = await Movimentacao.findByPk(movimentacaoId, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined
  });

  if (!originalMov) {
    throw new Error('Movimentação original não encontrada');
  }

  if (originalMov.estornado) {
    throw new Error('Esta movimentação já foi estornada');
  }

  const client = await Cliente.findByPk(originalMov.cliente_id, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined
  });

  if (!client) {
    throw new Error('Cliente da movimentação não encontrado');
  }

  const valNum = Number(originalMov.valor);
  const saldoAnterior = Number(client.saldo_credito || 0);
  let saldoPosterior = 0;
  let tipoOperacaoReversa = '';

  if (originalMov.tipo_operacao === 'C') {
    // Reverter um crédito (C) = fazer um débito (D)
    if (saldoAnterior < valNum) {
      throw new Error('Não é possível estornar esta movimentação pois resultaria em saldo negativo para o cliente');
    }
    saldoPosterior = Number((saldoAnterior - valNum).toFixed(2));
    tipoOperacaoReversa = 'D';
  } else {
    // Reverter um débito (D) = fazer um crédito (C)
    saldoPosterior = Number((saldoAnterior + valNum).toFixed(2));
    tipoOperacaoReversa = 'C';
  }

  client.saldo_credito = saldoPosterior;
  client.data_ultima_movimentacao_credito = new Date();
  await client.save({ transaction });

  originalMov.estornado = true;
  await originalMov.save({ transaction });

  const estornoMov = await Movimentacao.create({
    id: uuidv4(),
    cliente_id: client.id,
    tipo: 'ESTORNO',
    tipo_operacao: tipoOperacaoReversa,
    valor: valNum,
    saldo_anterior: saldoAnterior,
    saldo_posterior: saldoPosterior,
    usuario_id: usuarioId,
    usuario_nome: usuarioNome,
    origem: originalMov.origem,
    movimentacao_original_id: originalMov.id,
    observacao: `Estorno da movimentação ID: ${originalMov.id}. Observação original: ${originalMov.observacao || ''}`,
    dispositivo,
    estornado: false
  }, { transaction });

  return { cliente: client, movimentacao: estornoMov };
};

/**
 * Recalcula o saldo total com base no histórico de movimentações.
 */
export const recalcularSaldo = async (clienteId, { transaction }) => {
  const Cliente = getClienteModel();
  const Movimentacao = getClienteCreditoMovimentacaoModel();

  const client = await Cliente.findByPk(clienteId, {
    transaction,
    lock: transaction ? transaction.LOCK.UPDATE : undefined
  });

  if (!client) {
    throw new Error('Cliente não encontrado');
  }

  const movimentacoes = await Movimentacao.findAll({
    where: { cliente_id: clienteId },
    order: [['criado_em', 'ASC'], ['createdAt', 'ASC']],
    transaction
  });

  let saldoCalculado = 0;
  for (const mov of movimentacoes) {
    const valorMov = Number(mov.valor || 0);
    if (mov.tipo_operacao === 'C') {
      saldoCalculado = Number((saldoCalculado + valorMov).toFixed(2));
    } else if (mov.tipo_operacao === 'D') {
      saldoCalculado = Number((saldoCalculado - valorMov).toFixed(2));
    }
  }

  if (Number(client.saldo_credito) !== saldoCalculado) {
    client.saldo_credito = Math.max(0, saldoCalculado);
    await client.save({ transaction });
  }

  return { cliente: client, saldoCalculado };
};
