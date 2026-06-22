import { sequelize } from '../config/db.js';
import * as clienteCreditoService from '../services/clienteCreditoService.js';
import { getClienteCreditoMovimentacaoModel } from '../models/ClienteCreditoMovimentacao.js';
import { Op } from 'sequelize';

/**
 * Adiciona crédito manualmente a um cliente.
 */
export const adicionarCreditoManual = async (req, res) => {
  const { cid } = req.params;
  const { valor, motivo, observacao } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    if (!trabalharCredito) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
    }

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;
    const usuarioId = req.user.id;
    const usuarioNome = req.user.name;

    const { cliente, movimentacao } = await clienteCreditoService.adicionarCredito(cid, {
      valor,
      tipo: 'CREDITO_MANUAL',
      motivo,
      observacao,
      usuarioId,
      usuarioNome,
      origem: 'manual',
      dispositivo
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true, cliente, movimentacao });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ detail: error.message });
  }
};

/**
 * Remove crédito manualmente de um cliente.
 */
export const removerCreditoManual = async (req, res) => {
  const { cid } = req.params;
  const { valor, motivo, observacao } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    if (!trabalharCredito) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
    }

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;
    const usuarioId = req.user.id;
    const usuarioNome = req.user.name;

    const { cliente, movimentacao } = await clienteCreditoService.removerCredito(cid, {
      valor,
      tipo: 'DEBITO_MANUAL',
      motivo,
      observacao,
      usuarioId,
      usuarioNome,
      origem: 'manual',
      dispositivo
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true, cliente, movimentacao });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ detail: error.message });
  }
};

/**
 * Estorna uma movimentação de crédito.
 */
export const estornarMovimentacao = async (req, res) => {
  const { mid } = req.params;
  const transaction = await sequelize.transaction();

  try {
    // Check if the movement originated from a payment before proceeding
    const Movimentacao = getClienteCreditoMovimentacaoModel();
    const movCheck = await Movimentacao.findByPk(mid, { transaction });
    if (movCheck) {
      const origem = movCheck.origem || '';
      if (origem.startsWith('agendamento:') || origem.startsWith('venda:')) {
        await transaction.rollback();
        return res.status(400).json({ 
          detail: 'Não é permitido estornar movimentações originadas por pagamentos. Para corrigir, utilize a tela de Pagamento e exclua o pagamento correspondente. O crédito do cliente será estornado automaticamente.' 
        });
      }
    }

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;
    const usuarioId = req.user.id;
    const usuarioNome = req.user.name;

    const { cliente, movimentacao } = await clienteCreditoService.estornarMovimentacao(mid, {
      usuarioId,
      usuarioNome,
      dispositivo
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true, cliente, movimentacao });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ detail: error.message });
  }
};

/**
 * Consulta o extrato de movimentações de crédito.
 */
export const getExtrato = async (req, res) => {
  const { cid } = req.params;
  const { cliente_id, data_inicio, data_fim } = req.query;

  const targetClienteId = cid || cliente_id;

  try {
    const where = {};
    if (targetClienteId) {
      where.cliente_id = targetClienteId;
    }

    if (data_inicio || data_fim) {
      const dateRange = {};
      if (data_inicio) dateRange[Op.gte] = new Date(`${data_inicio}T00:00:00.000Z`);
      if (data_fim) dateRange[Op.lte] = new Date(`${data_fim}T23:59:59.999Z`);
      where.criado_em = dateRange;
    }

    const Movimentacoes = await getClienteCreditoMovimentacaoModel().findAll({
      where,
      order: [['criado_em', 'DESC'], ['createdAt', 'DESC']]
    });

    // Enrich movements with resolved origin references (service/sale numbers)
    const { getAgendamentoModel } = await import('../models/Agendamento.js');
    const { getVendaDiretaModel } = await import('../models/VendaDireta.js');

    const enrichedMovs = await Promise.all(Movimentacoes.map(async (mov) => {
      const movJSON = mov.toJSON();
      const origem = movJSON.origem || '';
      
      if (origem.startsWith('agendamento:')) {
        movJSON.origem_pagamento = true;
        const agId = origem.replace('agendamento:', '');
        try {
          const ag = await getAgendamentoModel().findByPk(agId, { attributes: ['numero'] });
          if (ag && ag.numero) {
            movJSON.origem_referencia = `${String(ag.numero).padStart(6, '0')} | S`;
          }
        } catch (e) { /* ignore lookup errors */ }
      } else if (origem.startsWith('venda:')) {
        movJSON.origem_pagamento = true;
        const vendaId = origem.replace('venda:', '');
        try {
          const venda = await getVendaDiretaModel().findByPk(vendaId, { attributes: ['numero_venda'] });
          if (venda && venda.numero_venda) {
            movJSON.origem_referencia = `${String(venda.numero_venda).padStart(6, '0')} | V`;
          }
        } catch (e) { /* ignore lookup errors */ }
      } else {
        movJSON.origem_pagamento = false;
      }

      return movJSON;
    }));

    res.json(enrichedMovs);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * Recalcula o saldo total com base no histórico.
 */
export const recalcularSaldoCliente = async (req, res) => {
  const { cid } = req.params;
  const transaction = await sequelize.transaction();

  try {
    const { cliente, saldoCalculado } = await clienteCreditoService.recalcularSaldo(cid, { transaction });
    await transaction.commit();
    res.json({ ok: true, cliente, saldoCalculado });
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ detail: error.message });
  }
};
