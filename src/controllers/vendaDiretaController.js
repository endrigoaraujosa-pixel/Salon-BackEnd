import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { getVendaDiretaModel } from '../models/VendaDireta.js';
import { getPagamentoModel } from '../models/Pagamento.js';
import { getClienteModel } from '../models/Cliente.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getDescontoModel } from '../models/Desconto.js';
import { getUserModel } from '../models/User.js';
import { sequelize } from '../config/db.js';
import * as clienteCreditoService from '../services/clienteCreditoService.js';

const _registrarMovimentacaoVenda = async (produto, tipo, quantidade, venda, transaction, user = null) => {
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const motivo = tipo === 'saida'
      ? `Saída Venda - Código: ${String(venda.numero_venda || '').padStart(6, '0')} | V`
      : `Devolução por alteração/cancelamento de venda`;

    const qtdAtual = produto.quantidade_estoque;
    const qtdAnterior = tipo === 'saida'
      ? Number((qtdAtual + quantidade).toFixed(3))
      : Number((qtdAtual - quantidade).toFixed(3));

    await getMovimentacaoEstoqueModel().create({
      produto_id: produto.id,
      produto_nome: produto.nome,
      tipo,
      quantidade,
      quantidade_anterior: qtdAnterior,
      quantidade_atual: qtdAtual,
      valor_unitario: produto.custo_unitario || 0,
      motivo,
      referencia_id: venda.id,
      usuario_id: user ? user.id : null,
      usuario_nome: user ? user.name : null
    }, { transaction });
  } catch (error) {
    console.error('Erro ao registrar movimentação de estoque para venda:', error);
  }
};

const listVendas = async (req, res) => {
  const { data_inicio, data_fim, cliente_id, status, colaborador_id, produto_id, search, page, limit } = req.query;
  console.log('[DEBUG listVendas] Received query params:', { data_inicio, data_fim, cliente_id, status, colaborador_id, produto_id, search, page, limit });
  try {
    const where = { deletado: 'N' };
    if (data_inicio && data_fim) {
      where.data_venda = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }
    if (cliente_id && cliente_id !== 'all') {
      if (cliente_id === 'none') {
        where.cliente_id = null;
      } else {
        where.cliente_id = cliente_id;
      }
    }
    if (colaborador_id && colaborador_id !== 'all') {
      where.colaborador_id = colaborador_id;
    }
    if (produto_id && produto_id !== 'all') {
      where.produto_id = produto_id;
    }
    if (status) {
      where.status = status;
    }
    if (search) {
      const searchLike = `%${search}%`;
      const parsedNum = parseInt(search, 10);
      const orConditions = [
        { produto_nome: { [Op.like]: searchLike } },
        { cliente_nome: { [Op.like]: searchLike } },
        { colaborador_nome: { [Op.like]: searchLike } }
      ];
      if (!isNaN(parsedNum)) {
        orConditions.push({ numero_venda: parsedNum });
      }
      where[Op.or] = orConditions;
    }
    console.log('[DEBUG listVendas] sequelize where:', where);

    if (page) {
      const pageNum = parseInt(page, 10) || 1;
      const limitNum = parseInt(limit, 10) || 50;
      const offset = (pageNum - 1) * limitNum;

      const { count, rows: vendas } = await getVendaDiretaModel().findAndCountAll({
        where,
        order: [['data_venda', 'DESC']],
        limit: limitNum,
        offset
      });

      res.json({
        data: vendas,
        page: pageNum,
        pages: Math.ceil(count / limitNum),
        total: count
      });
    } else {
      const vendas = await getVendaDiretaModel().findAll({
        where,
        order: [['data_venda', 'DESC']]
      });
      res.json(vendas);
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getVenda = async (req, res) => {
  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S') return res.status(404).json({ detail: 'Venda não encontrada' });

    const pagamentos = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' } });
    const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);

    res.json({
      ...venda.toJSON(),
      pagamentos,
      total_pago: totalPago
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createVenda = async (req, res) => {
  const { itens, colaborador_id, cliente_id, data_venda } = req.body;

  if (!colaborador_id) {
    return res.status(400).json({ detail: 'Informe o profissional responsável pela venda.' });
  }

  // Suporte a formato legado (produto_id + quantidade) e novo formato (itens=[])
  let carrinho = [];
  if (Array.isArray(itens) && itens.length > 0) {
    carrinho = itens;
  } else if (req.body.produto_id && req.body.quantidade) {
    // Retrocompatibilidade com formato antigo (1 produto)
    carrinho = [{ produto_id: req.body.produto_id, quantidade: Number(req.body.quantidade) }];
  }

  if (carrinho.length === 0) {
    return res.status(400).json({ detail: 'Adicione ao menos um produto ao carrinho.' });
  }

  const transaction = await sequelize.transaction();
  try {
    // Buscar e validar todos os produtos do carrinho
    const itensProcessados = [];
    let valor_total = 0;

    for (const item of carrinho) {
      const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
      if (!produto) {
        await transaction.rollback();
        return res.status(400).json({ detail: `Produto não encontrado: ${item.produto_id}` });
      }
      if (produto.uso_exclusivo_servicos) {
        await transaction.rollback();
        return res.status(400).json({ detail: `O produto "${produto.nome}" é de uso exclusivo em serviços e não pode ser vendido diretamente.` });
      }
      const qtd = Number(item.quantidade);
      const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
      const neededStock = qtyPerUnit > 0 ? (qtd * qtyPerUnit) : qtd;

      const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
      const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
      const permitirEstoqueNegativo = systemConfig ? !!systemConfig.permitir_estoque_negativo : false;
      const permitirAlterarPreco = systemConfig ? !!systemConfig.permitir_alterar_preco_produto_venda : false;

      if (produto.quantidade_estoque < neededStock && !permitirEstoqueNegativo) {
        const dispQty = qtyPerUnit > 0 ? (produto.quantidade_estoque / qtyPerUnit) : produto.quantidade_estoque;
        await transaction.rollback();
        return res.status(400).json({
          code: 'ESTOQUE_INSUFICIENTE',
          detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${Number(dispQty.toFixed(3))}`
        });
      }

      let preco_unitario = Number(produto.preco_venda);
      if (permitirAlterarPreco && item.preco_unitario !== undefined && item.preco_unitario !== null && item.preco_unitario !== '' && !isNaN(Number(item.preco_unitario)) && Number(item.preco_unitario) >= 0) {
        preco_unitario = Number(item.preco_unitario);
      }
      const subtotal = qtd * preco_unitario;

      itensProcessados.push({
        produto_id: produto.id,
        produto_nome: produto.nome,
        quantidade: qtd,
        preco_unitario,
        subtotal,
        comissao_pct: Number(produto.comissao || 0),
        custo_unitario: Number(produto.custo_unitario || 0)
      });

      valor_total += subtotal;
    }

    // NÃO deduzir estoque na criação da venda.
    // O estoque só é deduzido quando o pagamento for registrado.

    let colaborador_nome = null;
    const colab = await getColaboradorModel().findByPk(colaborador_id, { transaction });
    if (colab) colaborador_nome = colab.nome;

    let cliente_nome = null;
    if (cliente_id) {
      const cli = await getClienteModel().findByPk(cliente_id, { transaction });
      if (cli) cliente_nome = cli.nome;
    }

    const maxNum = await getVendaDiretaModel().max('numero_venda', { transaction }) || 0;

    // Campos legados preenchidos com o primeiro item (retrocompatibilidade)
    const primeiroItem = itensProcessados[0];

    let data_venda_db = new Date();
    if (data_venda) {
      const [year, month, day] = data_venda.split('-').map(Number);

      // Validação: data informada não pode ser futura
      const hoje = new Date();
      const dataVendaDateOnly = new Date(year, month - 1, day);
      const hojeDateOnly = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
      if (dataVendaDateOnly > hojeDateOnly) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'A data da venda não pode ser uma data futura.' });
      }

      data_venda_db.setFullYear(year);
      data_venda_db.setMonth(month - 1);
      data_venda_db.setDate(day);
    }

    const created_by_id = req.user ? req.user.id : null;
    const created_by_name = req.user ? req.user.name : 'Sistema';

    const venda = await getVendaDiretaModel().create({
      id: uuidv4(),
      numero_venda: maxNum + 1,
      data_venda: data_venda_db,
      data_lancamento: new Date(),
      criado_por_id: created_by_id,
      criado_por_nome: created_by_name,
      // Campos legados (retrocompatibilidade com relatórios e comissões antigas)
      produto_id: primeiroItem.produto_id,
      produto_nome: itensProcessados.length === 1
        ? primeiroItem.produto_nome
        : `${primeiroItem.produto_nome} (+${itensProcessados.length - 1})`,
      quantidade: itensProcessados.reduce((acc, i) => acc + i.quantidade, 0),
      // Novo campo: carrinho completo
      itens: itensProcessados,
      colaborador_id,
      colaborador_nome,
      cliente_id,
      cliente_nome,
      valor_total,
      valor_pago: 0,
      status: 'pendente'
    }, { transaction });

    await transaction.commit();
    res.status(201).json(venda);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const deleteVenda = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    // Validar se existem pagamentos vinculados ativos
    const countPagamentos = await getPagamentoModel().count({
      where: {
        venda_direta_id: req.params.id,
        deletado: 'N'
      },
      transaction
    });

    const temPagamentos = countPagamentos > 0 || (venda.valor_pago && venda.valor_pago > 0) || venda.status === 'pago';

    if (temPagamentos) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Não é permitido excluir uma venda que possui pagamentos registrados.' });
    }

    // Soft delete sale (exclusão lógica)
    await venda.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const addPagamentos = async (req, res) => {
  const { pagamentos, finalizar } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

    const existingPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' }, transaction });
    const { getTaxaCartaoModel } = await import('../models/TaxaCartao.js');
    const cardRates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' }, transaction });
    const cardKeys = cardRates.map(r => r.forma_pagamento);
    const pagoAtual = existingPags.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const remainingSaldo = Number((venda.valor_total - pagoAtual).toFixed(2));

    const hasCreditoCliente = pagamentos.some(p => p.forma_pagamento === 'credito_cliente');
    const hasExistingCredito = existingPags.some(p => p.forma_pagamento === 'credito_cliente');

    if (hasCreditoCliente) {
      for (const p of pagamentos) {
        if (p.forma_pagamento === 'credito_cliente' && Number(p.valor) > remainingSaldo + 0.01) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'O valor pago em crédito do cliente não pode ser superior ao saldo devedor.' });
        }
      }
    }

    const novoValorBruto = pagamentos.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    let novoTotal = pagoAtual + novoValorBruto;

    if (hasCreditoCliente || hasExistingCredito) {
      if (novoTotal > venda.valor_total + 0.01) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Não é permitido valor superior ao total para uma venda/atendimento que utiliza crédito do cliente como forma de pagamento.' });
      }
    }

    for (const p of pagamentos) {
      if (p.forma_pagamento === 'credito_cliente') {
        if (!trabalharCredito) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
        }
        if (!venda.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para utilizar crédito é necessário identificar o cliente na venda.' });
        }
        try {
          await clienteCreditoService.removerCredito(venda.cliente_id, {
            valor: Number(p.valor),
            tipo: 'CREDITO_UTILIZADO_VENDA',
            motivo: 'Utilização de crédito em venda',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `venda:${venda.id}`,
            dispositivo
          }, { transaction });
        } catch (err) {
          await transaction.rollback();
          return res.status(400).json({ detail: err.message });
        }
      }
    }
    let adjustedPagamentos = pagamentos.map(p => ({
      ...p,
      valor_recebido: Number(p.valor || 0),
      troco: 0,
      valor: Number(p.valor || 0),
      credito_gerado: 0
    }));
    novoTotal = pagoAtual + novoValorBruto;

    const gerarCreditoExcedente = req.body.gerar_credito_excedente === true;

    if (novoTotal > venda.valor_total + 0.01) {
      let excesso = novoTotal - venda.valor_total;

      if (gerarCreditoExcedente) {
        if (!venda.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para gerar crédito é necessário identificar o cliente na venda.' });
        }
        if (!trabalharCredito) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
        }

        await clienteCreditoService.adicionarCredito(venda.cliente_id, {
          valor: excesso,
          tipo: 'CREDITO_GERADO_VENDA',
          motivo: 'Crédito gerado por excedente no recebimento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `venda:${venda.id}`,
          dispositivo
        }, { transaction });

        let remainingExcesso = excesso;
        for (let i = adjustedPagamentos.length - 1; i >= 0; i--) {
          const p = adjustedPagamentos[i];
          if (p.valor_recebido >= remainingExcesso) {
            p.valor = Number((p.valor_recebido - remainingExcesso).toFixed(2));
            p.credito_gerado = Number(remainingExcesso.toFixed(2));
            remainingExcesso = 0;
            break;
          } else {
            p.credito_gerado = p.valor_recebido;
            p.valor = 0;
            remainingExcesso = Number((remainingExcesso - p.valor_recebido).toFixed(2));
          }
        }
        novoTotal = venda.valor_total;
      } else {
        let idxDinheiro = adjustedPagamentos.findIndex(p => p.forma_pagamento === 'dinheiro');
        if (idxDinheiro !== -1 && adjustedPagamentos[idxDinheiro].valor_recebido >= excesso) {
          adjustedPagamentos[idxDinheiro].valor = Number((adjustedPagamentos[idxDinheiro].valor_recebido - excesso).toFixed(2));
          adjustedPagamentos[idxDinheiro].troco = Number(excesso.toFixed(2));
          adjustedPagamentos[idxDinheiro].observacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (adjustedPagamentos[idxDinheiro].observacao ? ` - ${adjustedPagamentos[idxDinheiro].observacao}` : '');
          novoTotal = venda.valor_total;
        } else {
          await transaction.rollback();
          const isElectronic = pagamentos.some(p => ['pix', 'cartao_credito', 'cartao_debito', 'vale'].includes(p.forma_pagamento) || cardKeys.includes(p.forma_pagamento));
          const msg = isElectronic
            ? 'Não é permitido informar valor superior ao total da venda para esta forma de pagamento. Utilize o valor exato ou gere crédito para o cliente.'
            : 'Valor excede o total devido';
          return res.status(400).json({ detail: msg });
        }
      }
    }

    for (const p of adjustedPagamentos) {
      let cartao_tipo = null;
      let adquirente_id = null;
      let cartao_parcelas = null;
      let cartao_taxa_percentual = null;
      let cartao_taxa_valor = null;
      let valor_liquido = p.valor;
      let data_recebimento_prevista = null;

      const baseRate = cardRates.find(r => r.forma_pagamento === p.forma_pagamento);
      const rate = baseRate || null;

      if (rate) {
        cartao_tipo = rate.tipo_cartao || (p.forma_pagamento === 'cartao_credito' ? 'credito' : p.forma_pagamento === 'cartao_debito' ? 'debito' : null);
        adquirente_id = rate.adquirente_id || null;

        if (cartao_tipo === 'credito') {
          const selectedParcela = Math.min(12, Math.max(1, parseInt(p.parcelas) || 1));
          cartao_parcelas = selectedParcela;
          const taxaField = `taxa_${selectedParcela}x`;
          cartao_taxa_percentual = rate[taxaField] !== undefined ? rate[taxaField] : (rate.percentual || 0);
        } else if (cartao_tipo === 'debito') {
          cartao_taxa_percentual = rate.percentual || 0;
        }

        if (cartao_taxa_percentual !== null) {
          cartao_taxa_valor = Number(((p.valor * cartao_taxa_percentual) / 100).toFixed(2));
          valor_liquido = Number((p.valor - cartao_taxa_valor).toFixed(2));
        }

        const dias = rate.dias_recebimento || 0;
        const prevDate = new Date();
        prevDate.setDate(prevDate.getDate() + dias);
        data_recebimento_prevista = prevDate;
      } else {
        if (p.forma_pagamento === 'cartao_credito') {
          cartao_tipo = 'credito';
          cartao_parcelas = Math.min(12, Math.max(1, parseInt(p.parcelas) || 1));
          cartao_taxa_percentual = 2.5;
          cartao_taxa_valor = Number(((p.valor * 2.5) / 100).toFixed(2));
          valor_liquido = Number((p.valor - cartao_taxa_valor).toFixed(2));
          const prevDate = new Date();
          data_recebimento_prevista = prevDate;
        } else if (p.forma_pagamento === 'cartao_debito') {
          cartao_tipo = 'debito';
          cartao_taxa_percentual = 1.5;
          cartao_taxa_valor = Number(((p.valor * 1.5) / 100).toFixed(2));
          valor_liquido = Number((p.valor - cartao_taxa_valor).toFixed(2));
          const prevDate = new Date();
          data_recebimento_prevista = prevDate;
        }
      }

      await getPagamentoModel().create({
        id: uuidv4(),
        venda_direta_id: req.params.id,
        valor: p.valor,
        valor_recebido: p.valor_recebido,
        troco: p.troco,
        credito_gerado: p.credito_gerado || 0,
        forma_pagamento: p.forma_pagamento,
        observacao: p.observacao || '',
        data_hora: new Date(),
        cartao_tipo,
        adquirente_id,
        cartao_parcelas,
        cartao_taxa_percentual,
        cartao_taxa_valor,
        valor_liquido,
        data_recebimento_prevista,
        cartao_bandeira: rate ? rate.bandeira : null
      }, { transaction });
    }

    const eraStatusAnteriorPago = venda.status === 'pago';
    venda.valor_pago = novoTotal;
    const ficouPago = finalizar || novoTotal >= venda.valor_total - 0.01;
    if (ficouPago) {
      venda.status = 'pago';
    }
    await venda.save({ transaction });

    // Deduzir estoque apenas na primeira vez que a venda fica paga
    if (ficouPago && !eraStatusAnteriorPago) {
      const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
      for (const item of itensVenda) {
        const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
        if (produto) {
          const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
          const stockAdjustment = qtyPerUnit > 0 ? (Number(item.quantidade) * qtyPerUnit) : Number(item.quantidade);
          produto.quantidade_estoque = Number((produto.quantidade_estoque - stockAdjustment).toFixed(3));
          await produto.save({ transaction });
          await _registrarMovimentacaoVenda(produto, 'saida', stockAdjustment, venda, transaction, req.user);
        }
      }
    }

    await transaction.commit();
    res.json({ ok: true, total_pago: novoTotal, saldo: venda.valor_total - novoTotal });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const updatePagamento = async (req, res) => {
  const { valor, forma_pagamento, observacao, bandeira } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const pagamento = await getPagamentoModel().findByPk(req.params.pid, { transaction });
    if (!pagamento) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Pagamento não encontrado' });
    }

    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

    if (trabalharCredito && venda.cliente_id) {
      // Revert old payment credit usage
      if (pagamento.forma_pagamento === 'credito_cliente') {
        await clienteCreditoService.adicionarCredito(venda.cliente_id, {
          valor: pagamento.valor,
          tipo: 'ESTORNO',
          motivo: 'Reversão para atualização de pagamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `venda:${venda.id}`,
          dispositivo
        }, { transaction });
      }

      // Revert old payment credit generation
      if (Number(pagamento.credito_gerado) > 0) {
        try {
          await clienteCreditoService.removerCredito(venda.cliente_id, {
            valor: pagamento.credito_gerado,
            tipo: 'ESTORNO',
            motivo: 'Reversão de crédito gerado para atualização',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `venda:${venda.id}`,
            dispositivo
          }, { transaction });
        } catch (err) {
          await transaction.rollback();
          return res.status(400).json({ detail: `Não é permitido alterar este pagamento pois o crédito de R$ ${Number(pagamento.credito_gerado).toFixed(2)} gerado por ele já foi utilizado pelo cliente.` });
        }
      }

      // Apply new payment credit usage if updated to credito_cliente
      if (forma_pagamento === 'credito_cliente') {
        try {
          await clienteCreditoService.removerCredito(venda.cliente_id, {
            valor: Number(valor),
            tipo: 'CREDITO_UTILIZADO_VENDA',
            motivo: 'Utilização de crédito em pagamento atualizado',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `venda:${venda.id}`,
            dispositivo
          }, { transaction });
        } catch (err) {
          await transaction.rollback();
          return res.status(400).json({ detail: err.message });
        }
      }
    }

    const otherPags = await getPagamentoModel().findAll({
      where: {
        venda_direta_id: req.params.id,
        deletado: 'N',
        id: { [Op.ne]: req.params.pid }
      },
      transaction
    });
    const pagoOutros = otherPags.reduce((acc, p) => acc + Number(p.valor || 0), 0);

    const novoValorRecebido = Number(valor || 0);
    const novoTotal = pagoOutros + novoValorRecebido;
    let novoTroco = 0;
    let novoValorNet = novoValorRecebido;
    let novaObservacao = observacao || '';
    let novoCreditoGerado = 0;

    const gerarCreditoExcedente = req.body.gerar_credito_excedente === true;

    if (novoTotal > venda.valor_total + 0.01) {
      let excesso = novoTotal - venda.valor_total;
      if (gerarCreditoExcedente) {
        if (!venda.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para gerar crédito é necessário identificar o cliente na venda.' });
        }
        if (!trabalharCredito) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
        }

        await clienteCreditoService.adicionarCredito(venda.cliente_id, {
          valor: excesso,
          tipo: 'CREDITO_GERADO_VENDA',
          motivo: 'Crédito gerado por atualização de pagamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `venda:${venda.id}`,
          dispositivo
        }, { transaction });

        novoValorNet = Number((novoValorRecebido - excesso).toFixed(2));
        novoCreditoGerado = excesso;
        novoTroco = 0;
      } else {
        if (forma_pagamento === 'dinheiro' && novoValorRecebido >= excesso) {
          novoTroco = Number(excesso.toFixed(2));
          novoValorNet = Number((novoValorRecebido - excesso).toFixed(2));
          novaObservacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (observacao ? ` - ${observacao}` : '');
        } else {
          await transaction.rollback();
          const { getTaxaCartaoModel } = await import('../models/TaxaCartao.js');
          const cardRates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' }, transaction });
          const cardKeys = cardRates.map(r => r.forma_pagamento);
          const isElectronic = ['pix', 'cartao_credito', 'cartao_debito', 'vale'].includes(forma_pagamento) || cardKeys.includes(forma_pagamento);
          const msg = isElectronic
            ? 'Não é permitido informar valor superior ao total da venda para esta forma de pagamento. Utilize o valor exato ou gere crédito para o cliente.'
            : 'Valor excede o total devido';
          return res.status(400).json({ detail: msg });
        }
      }
    }

    const { getTaxaCartaoModel } = await import('../models/TaxaCartao.js');
    const cardRates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' }, transaction });
    
    let cartao_tipo = null;
    let adquirente_id = null;
    let cartao_parcelas = null;
    let cartao_taxa_percentual = null;
    let cartao_taxa_valor = null;
    let valor_liquido = novoValorNet;
    let data_recebimento_prevista = null;

    const baseRate = cardRates.find(r => r.forma_pagamento === forma_pagamento);
    const rate = baseRate || null;

    if (rate) {
      cartao_tipo = rate.tipo_cartao || (forma_pagamento === 'cartao_credito' ? 'credito' : forma_pagamento === 'cartao_debito' ? 'debito' : null);
      adquirente_id = rate.adquirente_id || null;

      if (cartao_tipo === 'credito') {
        const selectedParcela = Math.min(12, Math.max(1, parseInt(req.body.parcelas) || 1));
        cartao_parcelas = selectedParcela;
        const taxaField = `taxa_${selectedParcela}x`;
        cartao_taxa_percentual = rate[taxaField] !== undefined ? rate[taxaField] : (rate.percentual || 0);
      } else if (cartao_tipo === 'debito') {
        cartao_taxa_percentual = rate.percentual || 0;
      }

      if (cartao_taxa_percentual !== null) {
        cartao_taxa_valor = Number(((novoValorNet * cartao_taxa_percentual) / 100).toFixed(2));
        valor_liquido = Number((novoValorNet - cartao_taxa_valor).toFixed(2));
      }

      const dias = rate.dias_recebimento || 0;
      const prevDate = new Date();
      prevDate.setDate(prevDate.getDate() + dias);
      data_recebimento_prevista = prevDate;
    } else {
      if (forma_pagamento === 'cartao_credito') {
        cartao_tipo = 'credito';
        cartao_parcelas = Math.min(12, Math.max(1, parseInt(req.body.parcelas) || 1));
        cartao_taxa_percentual = 2.5;
        cartao_taxa_valor = Number(((novoValorNet * 2.5) / 100).toFixed(2));
        valor_liquido = Number((novoValorNet - cartao_taxa_valor).toFixed(2));
        const prevDate = new Date();
        data_recebimento_prevista = prevDate;
      } else if (forma_pagamento === 'cartao_debito') {
        cartao_tipo = 'debito';
        cartao_taxa_percentual = 1.5;
        cartao_taxa_valor = Number(((novoValorNet * 1.5) / 100).toFixed(2));
        valor_liquido = Number((novoValorNet - cartao_taxa_valor).toFixed(2));
        const prevDate = new Date();
        data_recebimento_prevista = prevDate;
      }
    }

    pagamento.valor = novoValorNet;
    pagamento.valor_recebido = novoValorRecebido;
    pagamento.troco = novoTroco;
    pagamento.credito_gerado = novoCreditoGerado;
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = novaObservacao;
    pagamento.cartao_tipo = cartao_tipo;
    pagamento.adquirente_id = adquirente_id;
    pagamento.cartao_parcelas = cartao_parcelas;
    pagamento.cartao_taxa_percentual = cartao_taxa_percentual;
    pagamento.cartao_taxa_valor = cartao_taxa_valor;
    pagamento.valor_liquido = valor_liquido;
    pagamento.data_recebimento_prevista = data_recebimento_prevista;
    pagamento.cartao_bandeira = rate ? rate.bandeira : null;
    await pagamento.save({ transaction });

    const eraStatusAnteriorPago = venda.status === 'pago';
    const allPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' }, transaction });
    const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
    venda.valor_pago = totalPago;
    const ficouPago = totalPago >= venda.valor_total - 0.01;
    if (ficouPago) {
      venda.status = 'pago';
    } else {
      venda.status = 'pendente';
    }
    await venda.save({ transaction });

    // Devolver estoque se a venda deixou de ser paga (ficou pendente)
    if (eraStatusAnteriorPago && !ficouPago) {
      const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
      for (const item of itensVenda) {
        const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
        if (produto) {
          const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
          const stockAdjustment = qtyPerUnit > 0 ? (Number(item.quantidade) * qtyPerUnit) : Number(item.quantidade);
          produto.quantidade_estoque = Number((produto.quantidade_estoque + stockAdjustment).toFixed(3));
          await produto.save({ transaction });
          await _registrarMovimentacaoVenda(produto, 'entrada', stockAdjustment, venda, transaction, req.user);
        }
      }
    }
    // Deduzir estoque se a venda passou de pendente para paga
    else if (!eraStatusAnteriorPago && ficouPago) {
      const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
      for (const item of itensVenda) {
        const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
        if (produto) {
          const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
          const stockAdjustment = qtyPerUnit > 0 ? (Number(item.quantidade) * qtyPerUnit) : Number(item.quantidade);
          produto.quantidade_estoque = Number((produto.quantidade_estoque - stockAdjustment).toFixed(3));
          await produto.save({ transaction });
          await _registrarMovimentacaoVenda(produto, 'saida', stockAdjustment, venda, transaction, req.user);
        }
      }
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const deletePagamento = async (req, res) => {
  const email = req.body.auth_email || req.body.email || req.headers['x-auth-email'] || req.query.email;
  const password = req.body.auth_password || req.body.password || req.headers['x-auth-password'] || req.query.password;

  const transaction = await sequelize.transaction();
  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    const needsPassword = venda.status === 'pago';
    if (needsPassword) {
      if (!email || !password) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Usuário e senha são obrigatórios' });
      }
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim() }, transaction });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        await transaction.rollback();
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      const { getPerfilAcessoModel } = await import('../models/PerfilAcesso.js');
      const perfil = authUser.perfil_acesso_id
        ? await getPerfilAcessoModel().findByPk(authUser.perfil_acesso_id, { transaction })
        : null;
      const permissoes = perfil ? (typeof perfil.permissoes === 'string' ? JSON.parse(perfil.permissoes) : perfil.permissoes) : {};
      
      const hasPermission = authUser.role === 'admin' ||
                            authUser.pode_excluir_pagamento === true ||
                            permissoes['agenda.pagamento.excluir'] === true;
      if (!hasPermission) {
        await transaction.rollback();
        return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
      }
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid, { transaction });
    if (!pagamento) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Pagamento não encontrado' });
    }
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    if (trabalharCredito && venda.cliente_id) {
      const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

      // If the deleted payment used credit
      if (pagamento.forma_pagamento === 'credito_cliente') {
        await clienteCreditoService.adicionarCredito(venda.cliente_id, {
          valor: pagamento.valor,
          tipo: 'ESTORNO',
          motivo: 'Estorno de pagamento excluído',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `venda:${venda.id}`,
          dispositivo
        }, { transaction });
      }

      // If the deleted payment generated credit
      if (Number(pagamento.credito_gerado) > 0) {
        try {
          await clienteCreditoService.removerCredito(venda.cliente_id, {
            valor: pagamento.credito_gerado,
            tipo: 'ESTORNO',
            motivo: 'Estorno de crédito gerado por pagamento excluído',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `venda:${venda.id}`,
            dispositivo
          }, { transaction });
        } catch (err) {
          await transaction.rollback();
          return res.status(400).json({ detail: `Não é permitido remover este pagamento pois o crédito de R$ ${Number(pagamento.credito_gerado).toFixed(2)} gerado por ele já foi utilizado pelo cliente e resultaria em saldo negativo.` });
        }
      }
    }

    await pagamento.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    }, { transaction });

    // Recompute venda total paid and handle stock restoration if no longer paid
    const eraStatusAnteriorPago = venda.status === 'pago';
    const allPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' }, transaction });
    const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
    venda.valor_pago = totalPago;
    const ficouPago = totalPago >= venda.valor_total - 0.01;
    if (ficouPago) {
      venda.status = 'pago';
    } else {
      venda.status = 'pendente';
    }
    await venda.save({ transaction });

    // Devolver estoque se a venda deixou de ser paga (ficou pendente)
    if (eraStatusAnteriorPago && !ficouPago) {
      const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
      for (const item of itensVenda) {
        const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
        if (produto) {
          const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
          const stockAdjustment = qtyPerUnit > 0 ? (Number(item.quantidade) * qtyPerUnit) : Number(item.quantidade);
          produto.quantidade_estoque = Number((produto.quantidade_estoque + stockAdjustment).toFixed(3));
          await produto.save({ transaction });
          await _registrarMovimentacaoVenda(produto, 'entrada', stockAdjustment, venda, transaction, req.user);
        }
      }
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

// ─────────────────────────────────────────────
// GERENCIAMENTO DO CARRINHO DA VENDA
// ─────────────────────────────────────────────

/**
 * Verifica se a venda está bloqueada para edição (possui pagamento ativo).
 */
const _isVendaBloqueada = async (vendaId, options = {}) => {
  const transaction = options.transaction;
  const count = await getPagamentoModel().count({
    where: { venda_direta_id: vendaId, deletado: 'N' },
    transaction
  });
  return count > 0;
};

/**
 * Reconstrói os campos legados (produto_id, produto_nome, quantidade) e o valor_total
 * a partir do carrinho (itens[]) e salva a venda.
 */
const _recalcularVenda = async (venda, options = {}) => {
  const transaction = options.transaction;
  const itens = Array.isArray(venda.itens) ? venda.itens : [];

  for (const item of itens) {
    if (item.custo_unitario === undefined || item.custo_unitario === null) {
      const prod = await getProdutoModel().findByPk(item.produto_id, { transaction });
      item.custo_unitario = prod ? Number(prod.custo_unitario || 0) : 0;
    }
  }

  const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
  const primeiro = itens[0] || {};
  await venda.update({
    itens,
    valor_total,
    produto_id: primeiro.produto_id || venda.produto_id,
    produto_nome:
      itens.length === 1
        ? primeiro.produto_nome
        : itens.length > 1
          ? `${primeiro.produto_nome} (+${itens.length - 1})`
          : venda.produto_nome,
    quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
  }, { transaction });
};

/**
 * GET /api/vendas-diretas/:id/carrinho
 * Retorna os itens do carrinho e indica se está bloqueado.
 */
const getCarrinho = async (req, res) => {
  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    const bloqueado = await _isVendaBloqueada(req.params.id);
    const itens =
      Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{
          produto_id: venda.produto_id,
          produto_nome: venda.produto_nome,
          quantidade: venda.quantidade,
          preco_unitario:
            venda.quantidade > 0
              ? venda.valor_total / venda.quantidade
              : venda.valor_total,
          subtotal: venda.valor_total,
          comissao_pct: 0
        }];

    res.json({
      venda_id: venda.id,
      numero_venda: venda.numero_venda,
      status: venda.status,
      bloqueado,
      mensagem_bloqueio: bloqueado
        ? 'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
        : null,
      itens,
      valor_total: venda.valor_total,
      cliente_id: venda.cliente_id,
      cliente_nome: venda.cliente_nome
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * POST /api/vendas-diretas/:id/carrinho/itens
 * Adiciona um novo item ao carrinho (bloqueado se houver pagamento).
 */
const addItemCarrinho = async (req, res) => {
  const { produto_id, quantidade, preco_unitario } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (await _isVendaBloqueada(venda.id, { transaction })) {
      await transaction.rollback();
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });
    }

    const produto = await getProdutoModel().findByPk(produto_id, { transaction });
    if (!produto) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Produto não encontrado.' });
    }

    if (produto.uso_exclusivo_servicos) {
      await transaction.rollback();
      return res.status(400).json({ detail: `O produto "${produto.nome}" é de uso exclusivo em serviços e não pode ser vendido diretamente.` });
    }

    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Quantidade inválida.' });
    }

    // Verifica estoque disponível considerando já comprometido no carrinho
    const itensAtuais = Array.isArray(venda.itens) ? venda.itens : [];
    const qtdJaNoCarrinho = itensAtuais
      .filter(i => i.produto_id === produto_id)
      .reduce((acc, i) => acc + Number(i.quantidade), 0);

    const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
    const neededStock = qtyPerUnit > 0 ? (qtd * qtyPerUnit) : qtd;
    const stockJaNoCarrinho = qtyPerUnit > 0 ? (qtdJaNoCarrinho * qtyPerUnit) : qtdJaNoCarrinho;
    const estoqueDisponivel = produto.quantidade_estoque - stockJaNoCarrinho;

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const permitirEstoqueNegativo = systemConfig ? !!systemConfig.permitir_estoque_negativo : false;
    const permitirAlterarPreco = systemConfig ? !!systemConfig.permitir_alterar_preco_produto_venda : false;

    if (estoqueDisponivel < neededStock && !permitirEstoqueNegativo) {
      const dispQty = qtyPerUnit > 0 ? (estoqueDisponivel / qtyPerUnit) : estoqueDisponivel;
      await transaction.rollback();
      return res.status(400).json({
        code: 'ESTOQUE_INSUFICIENTE',
        detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${Number(dispQty.toFixed(3))}`
      });
    }

    let precoUnit = Number(produto.preco_venda);
    if (permitirAlterarPreco && preco_unitario !== undefined && preco_unitario !== null && preco_unitario !== '' && !isNaN(Number(preco_unitario)) && Number(preco_unitario) >= 0) {
      precoUnit = Number(preco_unitario);
    }
    const subtotal = qtd * precoUnit;

    const novoItem = {
      produto_id: produto.id,
      produto_nome: produto.nome,
      quantidade: qtd,
      preco_unitario: precoUnit,
      subtotal,
      comissao_pct: Number(produto.comissao || 0),
      custo_unitario: Number(produto.custo_unitario || 0)
    };

    const itensAtualizados = [...itensAtuais, novoItem];
    venda.itens = itensAtualizados;
    await _recalcularVenda(venda, { transaction });

    await transaction.commit();
    res.status(201).json({
      ok: true,
      item: novoItem,
      itens: itensAtualizados,
      valor_total: venda.valor_total
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

/**
 * PUT /api/vendas-diretas/:id/carrinho/itens/:itemIndex
 * Atualiza a quantidade de um item pelo índice (bloqueado se houver pagamento).
 */
const updateItemCarrinho = async (req, res) => {
  const { quantidade, preco_unitario } = req.body;
  const itemIndex = parseInt(req.params.itemIndex, 10);
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (await _isVendaBloqueada(venda.id, { transaction })) {
      await transaction.rollback();
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });
    }

    const itens = Array.isArray(venda.itens) ? [...venda.itens] : [];
    if (itemIndex < 0 || itemIndex >= itens.length) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Índice de item inválido.' });
    }

    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Quantidade inválida.' });
    }

    const item = itens[itemIndex];
    const produto = await getProdutoModel().findByPk(item.produto_id, { transaction });
    if (!produto) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Produto do item não encontrado.' });
    }

    if (produto.uso_exclusivo_servicos) {
      await transaction.rollback();
      return res.status(400).json({ detail: `O produto "${produto.nome}" é de uso exclusivo em serviços e não pode ser vendido diretamente.` });
    }

    // Estoque: considera a reserva dos outros itens do mesmo produto
    const qtdOutrosItens = itens
      .filter((_, i) => i !== itemIndex && itens[i].produto_id === item.produto_id)
      .reduce((acc, i) => acc + Number(i.quantidade), 0);

    const qtyPerUnit = Number(produto.quantidade_por_unidade || 0);
    const neededStock = qtyPerUnit > 0 ? (qtd * qtyPerUnit) : qtd;
    const stockOutrosItens = qtyPerUnit > 0 ? (qtdOutrosItens * qtyPerUnit) : qtdOutrosItens;
    const estoqueDisponivel = produto.quantidade_estoque - stockOutrosItens;

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const permitirEstoqueNegativo = systemConfig ? !!systemConfig.permitir_estoque_negativo : false;
    const permitirAlterarPreco = systemConfig ? !!systemConfig.permitir_alterar_preco_produto_venda : false;

    if (estoqueDisponivel < neededStock && !permitirEstoqueNegativo) {
      const dispQty = qtyPerUnit > 0 ? (estoqueDisponivel / qtyPerUnit) : estoqueDisponivel;
      await transaction.rollback();
      return res.status(400).json({
        code: 'ESTOQUE_INSUFICIENTE',
        detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${Number(dispQty.toFixed(3))}`
      });
    }

    let precoUnit = Number(item.preco_unitario || produto.preco_venda);
    if (permitirAlterarPreco && preco_unitario !== undefined && preco_unitario !== null && preco_unitario !== '' && !isNaN(Number(preco_unitario)) && Number(preco_unitario) >= 0) {
      precoUnit = Number(preco_unitario);
    } else if (!permitirAlterarPreco) {
      precoUnit = Number(produto.preco_venda);
    }

    itens[itemIndex] = {
      ...item,
      quantidade: qtd,
      preco_unitario: precoUnit,
      subtotal: qtd * precoUnit
    };

    venda.itens = itens;
    await _recalcularVenda(venda, { transaction });

    await transaction.commit();
    res.json({
      ok: true,
      itens: venda.itens,
      valor_total: venda.valor_total
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

/**
 * DELETE /api/vendas-diretas/:id/carrinho/itens/:itemIndex
 * Remove um item do carrinho pelo índice (bloqueado se houver pagamento).
 * O carrinho deve ter ao menos 1 item.
 */
const removeItemCarrinho = async (req, res) => {
  const itemIndex = parseInt(req.params.itemIndex, 10);
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (await _isVendaBloqueada(venda.id, { transaction })) {
      await transaction.rollback();
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });
    }

    const itens = Array.isArray(venda.itens) ? [...venda.itens] : [];
    if (itens.length <= 1) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'O carrinho deve ter ao menos um produto.'
      });
    }

    if (itemIndex < 0 || itemIndex >= itens.length) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Índice de item inválido.' });
    }

    const itensAtualizados = itens.filter((_, i) => i !== itemIndex);
    venda.itens = itensAtualizados;
    await _recalcularVenda(venda, { transaction });

    await transaction.commit();
    res.json({
      ok: true,
      itens: venda.itens,
      valor_total: venda.valor_total
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const updateCliente = async (req, res) => {
  const { cliente_id } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (await _isVendaBloqueada(venda.id, { transaction })) {
      await transaction.rollback();
      return res.status(403).json({
        detail:
          'Não é permitido alterar a venda que já possui pagamento vinculado.'
      });
    }

    let cliente_nome = null;
    if (cliente_id) {
      const cli = await getClienteModel().findByPk(cliente_id, { transaction });
      if (!cli) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Cliente não encontrado' });
      }
      cliente_nome = cli.nome;
    }

    await venda.update({
      cliente_id: cliente_id || null,
      cliente_nome
    }, { transaction });

    await transaction.commit();
    res.json({
      ok: true,
      cliente_id,
      cliente_nome
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const aplicarDescontoVenda = async (req, res) => {
  const { id } = req.params;
  const { descontoId } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const venda = await getVendaDiretaModel().findByPk(id, { transaction });
    if (!venda || venda.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (venda.status === 'pago' || venda.valor_pago > 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Não é possível aplicar desconto em uma venda que já possui pagamentos.' });
    }

    // Normalizar itens
    let itens = Array.isArray(venda.itens) && venda.itens.length > 0
      ? [...venda.itens]
      : [{
        produto_id: venda.produto_id,
        produto_nome: venda.produto_nome,
        quantidade: venda.quantidade,
        preco_unitario: venda.quantidade > 0 ? venda.valor_total / venda.quantidade : venda.valor_total,
        subtotal: venda.valor_total,
        comissao_pct: 0
      }];

    // Se descontoId for nulo/vazio, estamos limpando o desconto (reverter para original)
    if (!descontoId) {
      // Reverter preços para original
      itens = itens.map(item => {
        if (item.preco_unitario_original !== undefined) {
          item.preco_unitario = item.preco_unitario_original;
          item.subtotal = item.quantidade * item.preco_unitario;
          delete item.preco_unitario_original;
        }
        return item;
      });

      venda.itens = itens;
      venda.changed('itens', true);
      const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
      const primeiro = itens[0] || {};

      await venda.update({
        itens,
        valor_total,
        desconto_aplicado: null,
        produto_id: primeiro.produto_id || venda.produto_id,
        produto_nome: itens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${itens.length - 1})`,
        quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
      }, { transaction });

      await transaction.commit();
      return res.json({ ok: true, venda });
    }

    const desconto = await getDescontoModel().findOne({ where: { id: descontoId, deletado: 'N', ativo: true }, transaction });
    if (!desconto) {
      await transaction.rollback();
      return res.status(444).json({ detail: 'Desconto não encontrado ou inativo.' });
    }

    // Verificar itens vinculados
    let vinculados = { services: [], products: [] };
    if (desconto.itens_vinculados) {
      try {
        vinculados = typeof desconto.itens_vinculados === "string"
          ? JSON.parse(desconto.itens_vinculados)
          : desconto.itens_vinculados;
      } catch (e) { }
    }

    const isRestrictedToItems = (vinculados.products && vinculados.products.length > 0) || (vinculados.services && vinculados.services.length > 0);

    // Identificar itens elegíveis e reverter quaisquer descontos anteriores primeiro
    let eligibleItens = [];
    itens = itens.map(item => {
      // Restore first if already discounted previously
      if (item.preco_unitario_original !== undefined) {
        item.preco_unitario = item.preco_unitario_original;
        item.subtotal = item.quantidade * item.preco_unitario;
      } else {
        // Save original price
        item.preco_unitario_original = item.preco_unitario;
      }

      const isEligible = !isRestrictedToItems || (vinculados.products && vinculados.products.includes(item.produto_id));
      if (isEligible) {
        eligibleItens.push(item);
      }
      return item;
    });

    if (eligibleItens.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Este desconto não é elegível para nenhum produto desta venda.' });
    }

    const subtotalElegivel = eligibleItens.reduce((acc, i) => acc + Number(i.subtotal), 0);

    // Calcular o desconto total a ser aplicado
    let totalDiscount = 0;
    if (desconto.tipo === 'porcentagem') {
      totalDiscount = subtotalElegivel * (desconto.valor / 100);
    } else { // valor_fixo
      totalDiscount = Math.min(desconto.valor, subtotalElegivel);
    }

    // Distribuir o desconto proporcionalmente aos subtotais dos itens elegíveis
    if (subtotalElegivel > 0) {
      eligibleItens.forEach(item => {
        const proporcao = item.subtotal / subtotalElegivel;
        const itemDiscount = totalDiscount * proporcao;
        item.subtotal = Math.max(0, Number((item.subtotal - itemDiscount).toFixed(2)));
        item.preco_unitario = Number((item.subtotal / item.quantidade).toFixed(2));
      });
    }

    venda.itens = itens;
    venda.changed('itens', true);
    const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
    const primeiro = itens[0] || {};

    await venda.update({
      itens,
      valor_total,
      desconto_aplicado: {
        desconto_id: desconto.id,
        codigo: desconto.codigo,
        descricao: desconto.descricao,
        tipo: desconto.tipo,
        valor_desconto: desconto.valor,
        total_descontado: Number(totalDiscount.toFixed(2)),
        incide_comissao: desconto.incide_comissao !== false && desconto.incide_comissao !== 0,
        aplicado_em: new Date().toISOString()
      },
      produto_id: primeiro.produto_id || venda.produto_id,
      produto_nome: itens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${itens.length - 1})`,
      quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true, venda });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

export {
  addItemCarrinho, addPagamentos, aplicarDescontoVenda, createVenda, deletePagamento, deleteVenda, getCarrinho, getVenda, listVendas, removeItemCarrinho,
  updateCliente, updateItemCarrinho, updatePagamento
};

