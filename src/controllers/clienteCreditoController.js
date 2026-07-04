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
  const { cliente_id, data_inicio, data_fim, page, limit } = req.query;

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

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;
    const offset = (pageNum - 1) * limitNum;

    const MovimentacaoModel = getClienteCreditoMovimentacaoModel();
    const { getClienteModel } = await import('../models/Cliente.js');
    const ClienteModel = getClienteModel();

    if (!MovimentacaoModel.associations.Cliente) {
      MovimentacaoModel.belongsTo(ClienteModel, { foreignKey: 'cliente_id' });
    }

    // Get paginated results
    const { count, rows: Movimentacoes } = await MovimentacaoModel.findAndCountAll({
      where,
      include: [
        {
          model: ClienteModel,
          attributes: ['nome'],
          required: false
        }
      ],
      order: [['criado_em', 'DESC'], ['createdAt', 'DESC']],
      limit: limitNum,
      offset
    });

    // Calculate totalCreditos and totalDebitos on all matching records (without page pagination)
    const stats = await MovimentacaoModel.findAll({
      where,
      attributes: [
        'tipo_operacao',
        'estornado',
        [sequelize.fn('SUM', sequelize.col('valor')), 'total_valor']
      ],
      group: ['tipo_operacao', 'estornado'],
      raw: true
    });

    let totalCreditos = 0;
    let totalDebitos = 0;

    for (const stat of stats) {
      if (!stat.estornado) {
        const val = Number(stat.total_valor || 0);
        if (stat.tipo_operacao === 'C') {
          totalCreditos += val;
        } else if (stat.tipo_operacao === 'D') {
          totalDebitos += val;
        }
      }
    }

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
          } else {
            movJSON.origem_referencia = `${agId.slice(0, 6).toUpperCase()} | S`;
          }
        } catch (e) {
          movJSON.origem_referencia = `${agId.slice(0, 6).toUpperCase()} | S`;
        }
      } else if (origem.startsWith('venda:')) {
        movJSON.origem_pagamento = true;
        const vendaId = origem.replace('venda:', '');
        try {
          const venda = await getVendaDiretaModel().findByPk(vendaId, { attributes: ['numero_venda'] });
          if (venda && venda.numero_venda) {
            movJSON.origem_referencia = `${String(venda.numero_venda).padStart(6, '0')} | V`;
          } else {
            movJSON.origem_referencia = `${vendaId.slice(0, 6).toUpperCase()} | V`;
          }
        } catch (e) {
          movJSON.origem_referencia = `${vendaId.slice(0, 6).toUpperCase()} | V`;
        }
      } else {
        movJSON.origem_pagamento = false;
      }

      return movJSON;
    }));

    res.json({
      data: enrichedMovs,
      page: pageNum,
      pages: Math.ceil(count / limitNum),
      total: count,
      totalCreditos,
      totalDebitos
    });
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
