import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { generateReminders, cancelReminders, generateThankYouReminder } from '../modules/whatsapp/reminder.service.js';
import { getClienteModel } from '../models/Cliente.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getServicoModel } from '../models/Servico.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getPagamentoModel } from '../models/Pagamento.js';
import { getUserModel } from '../models/User.js';
import { getDescontoModel } from '../models/Desconto.js';
import { sequelize } from '../config/db.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';

export const adjustStock = async (ag, type, options = {}) => {
  const transaction = options.transaction;
  const user = options.user || null;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    
    // Carregar configuracao do sistema
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const permitirEstoqueNegativo = systemConfig ? !!systemConfig.permitir_estoque_negativo : false;

    for (const item of ag.itens || []) {
      const utilized = item.produtos_utilizados || [];
      for (const pu of utilized) {
        const prod = await getProdutoModel().findByPk(pu.produto_id, { transaction });
        if (prod) {
          const qty = Number(pu.quantidade || 0);
          const stockAdjustment = qty;

          const qtdAnterior = prod.quantidade_estoque || 0;

          if (type === 'deduct') {
            const newQty = Number((qtdAnterior - stockAdjustment).toFixed(3));
            if (newQty < 0 && !permitirEstoqueNegativo) {
              throw new Error(`Estoque insuficiente para o insumo "${prod.nome}" no agendamento. Disponível: ${Number(qtdAnterior.toFixed(3))}`);
            }
            prod.quantidade_estoque = newQty;
          } else if (type === 'restore') {
            prod.quantidade_estoque = Number((qtdAnterior + stockAdjustment).toFixed(3));
          }
          await prod.save({ transaction });

          const qtdAtual = prod.quantidade_estoque;
          const tipoMovimentacao = type === 'deduct' ? 'saida' : 'entrada';
          const motivo = type === 'deduct'
            ? `Consumo de insumos - Agendamento: ${ag.id}`
            : `Devolução de insumos por cancelamento`;

          await getMovimentacaoEstoqueModel().create({
            produto_id: prod.id,
            produto_nome: prod.nome,
            tipo: tipoMovimentacao,
            quantidade: stockAdjustment,
            quantidade_anterior: qtdAnterior,
            quantidade_atual: qtdAtual,
            valor_unitario: prod.custo_unitario || 0,
            motivo,
            referencia_id: ag.id,
            usuario_id: user ? user.id : null,
            usuario_nome: user ? user.name : null
          }, { transaction });
        }
      }
    }
  } catch (error) {
    console.error(`Failed to adjust stock (${type}) for appointment ${ag?.id}:`, error);
    throw error;
  }
};

const buildAgendamentoDoc = async (body, excludeId = null) => {
  const cliente = await getClienteModel().findByPk(body.cliente_id);
  if (!cliente) throw new Error('Cliente inválido');

  let itens = [];
  let bloquearValorMenor = false;
  try {
    const systemConfig = await getConfiguracaoSistemaModel().findOne();
    if (systemConfig) {
      bloquearValorMenor = !!systemConfig.bloquear_valor_agendamento_menor;
    }
  } catch (err) {
    console.error("Erro ao carregar configuracoes do sistema:", err);
  }
  let valorTotal = 0;
  let duracaoTotal = 0;
  let profsMap = new Map();

  for (const item of body.itens_selecionados) {
    const s = await getServicoModel().findByPk(item.servico_id);
    if (s) {
      // Validação: colaborador principal e auxiliar não podem ser a mesma pessoa
      if (item.colaborador_id && item.auxiliar_id && item.colaborador_id === item.auxiliar_id) {
        throw new Error(`O colaborador principal e o auxiliar não podem ser a mesma pessoa. (Serviço: ${s.nome})`);
      }

      const resolvedProdutosUtilizados = [];
      if (Array.isArray(item.produtos_utilizados)) {
        for (const pu of item.produtos_utilizados) {
          const prod = await getProdutoModel().findByPk(pu.produto_id);
          if (prod && prod.ocultar_insumos) {
            throw new Error(`O produto "${prod.nome}" não pode ser utilizado no lançamento de insumos pois está configurado como Somente Venda.`);
          }

          let custoUnitario = Number(pu.custo_unitario || 0);
          let quantidadePorUnidade = Number(pu.quantidade_por_unidade || 0);
          let unidadeMedidaInsumo = pu.unidade_medida_insumo || "";
          let custoProporcional = Number(pu.custo_proporcional || 0);

          if (prod) {
            if (custoUnitario === 0) {
              custoUnitario = Number(prod.custo_unitario || 0);
            }
            if (quantidadePorUnidade === 0) {
              quantidadePorUnidade = Number(prod.quantidade_por_unidade || 0);
            }
            if (!unidadeMedidaInsumo) {
              unidadeMedidaInsumo = prod.unidade_medida_insumo || "un";
            }
          }

          let prodNome = pu.produto_nome || pu.produto_name || (prod ? prod.nome : "");
          // Calculate proportional cost: cost per unit of measure (e.g. per gram/ml)
          // Falls back to custo_unitario if quantidade_por_unidade is not set (backward-compatible)
          if (custoProporcional === 0) {
            custoProporcional = (quantidadePorUnidade > 0)
              ? custoUnitario / quantidadePorUnidade
              : custoUnitario;
          }
          resolvedProdutosUtilizados.push({
            produto_id: pu.produto_id,
            produto_nome: prodNome,
            quantidade: Number(pu.quantidade || 0),
            custo_unitario: custoUnitario,            // cost of the package (unchanged semantics)
            quantidade_por_unidade: quantidadePorUnidade, // package contents, stored for audit
            custo_proporcional: custoProporcional,        // cost per unit of measure (new)
            unidade_medida_insumo: unidadeMedidaInsumo || "un" // unit of measure for consumption (new)
          });
        }
      }

      const valorCobrado = item.valor !== undefined && item.valor !== null && item.valor !== '' ? Number(item.valor) : Number(s.valor || 0);
      const valorOriginal = item.valor_original !== undefined && item.valor_original !== null && item.valor_original !== '' ? Number(item.valor_original) : valorCobrado;

      if (bloquearValorMenor && valorCobrado < Number(s.valor || 0)) {
        throw new Error(`O valor cobrado para o serviço "${s.nome}" (R$ ${valorCobrado.toFixed(2)}) não pode ser inferior ao valor cadastrado (R$ ${Number(s.valor || 0).toFixed(2)}).`);
      }

      itens.push({
        servico_id: item.servico_id,
        nome: s.nome,
        valor: valorCobrado,
        valor_original: valorOriginal,
        duracao: s.duracao_minutos,
        colaborador_id: item.colaborador_id || null,
        auxiliar_id: item.auxiliar_id || null,
        produtos_utilizados: resolvedProdutosUtilizados
      });
      valorTotal += valorCobrado;
      duracaoTotal += s.duracao_minutos;

      if (item.colaborador_id) {
        const p = await getColaboradorModel().findByPk(item.colaborador_id);
        if (p) profsMap.set(p.id, { id: p.id, nome: p.nome, tipo: 'principal' });
      }
      if (item.auxiliar_id) {
        const p = await getColaboradorModel().findByPk(item.auxiliar_id);
        if (p) profsMap.set(p.id, { id: p.id, nome: p.nome, tipo: 'auxiliar' });
      }
    }
  }

  const novoInicio = new Date(body.data_hora);
  const novoFim = new Date(novoInicio.getTime() + duracaoTotal * 60000);
  const dataBusca = body.data_hora.split('T')[0];
  const dataInicioDia = `${dataBusca}T00:00:00`;
  const dataFimDia = `${dataBusca}T23:59:59`;

  const where = {
    data_hora: { [Op.between]: [dataInicioDia, dataFimDia] },
  };

  if (excludeId) {
    where.id = { [Op.ne]: excludeId };
  }

  const existentes = await getAgendamentoModel().findAll({ where });

  // Apenas validar conflito em NOVOS agendamentos (sem excludeId) e se ignorar_conflito nao for verdadeiro
  if (!excludeId && !body.ignorar_conflito) {
    for (const item of body.itens_selecionados) {
      const idsVerificar = [item.colaborador_id, item.auxiliar_id].filter(id => id);

      for (const ag of existentes) {
        const agInicio = new Date(ag.data_hora);
        const agFim = new Date(agInicio.getTime() + ag.duracao_minutos * 60000);

        const sobrepoe = agInicio < novoFim && agFim > novoInicio;

        if (sobrepoe) {
          const profsNoExistente = ag.profissionais.map(p => p.id);
          const conflito = idsVerificar.some(id => profsNoExistente.includes(id));

          if (conflito) {
            const profConflito = (await getColaboradorModel().findByPk(idsVerificar.find(id => profsNoExistente.includes(id))))?.nome;
            throw new Error(`Conflito de horário: O profissional ${profConflito} já possui um agendamento entre ${agInicio.toLocaleTimeString()} e ${agFim.toLocaleTimeString()}`);
          }
        }
      }
    }
  }

  return {
    cliente_id: body.cliente_id,
    cliente_nome: cliente.nome,
    data_hora: body.data_hora.length === 16 ? body.data_hora + ':00.000Z' : body.data_hora,
    itens,
    profissionais: Array.from(profsMap.values()),
    observacoes: body.observacoes || '',
    valor_total: valorTotal,
    duracao_minutos: duracaoTotal,
    status: 'agendado',
    valor_pago: 0
  };
};

const normalizeName = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const listAgend = async (req, res) => {
  const { data, mes, data_inicio, data_fim, numero } = req.query;
  const where = { deletado: 'N' };

  if (numero && String(numero).trim() !== '') {
    const rawNum = String(numero).trim();
    const cleanNum = rawNum.replace(/^0+/, '');
    const searchVal = cleanNum || '0';
    where.numero = sequelize.where(
      sequelize.cast(sequelize.col('numero'), 'varchar'),
      { [Op.like]: `%${searchVal}%` }
    );
  } else if (data) {
    where.data_hora = { [Op.between]: [`${data}T00:00:00`, `${data}T23:59:59`] };
  } else if (mes) {
    const [year, month] = mes.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    where.data_hora = { [Op.between]: [`${mes}-01T00:00:00`, `${mes}-${String(lastDay).padStart(2, '0')}T23:59:59`] };
  } else if (data_inicio && data_fim) {
    where.data_hora = { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] };
  }

  try {
    const agends = await getAgendamentoModel().findAll({
      where,
      order: [['data_hora', 'ASC']],
      limit: 2000
    });

    res.json(agends);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getAgend = async (req, res) => {
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (!ag || ag.deletado === 'S') return res.status(404).json({ detail: 'Não encontrado' });

    const email = req.body.auth_email || req.headers['x-auth-email'] || req.query.email;
    const password = req.body.auth_password || req.body.password || req.headers['x-auth-password'] || req.query.password;
    if (email && password) {
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' } });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      if (!authUser.pode_alterar_concluido) {
        return res.status(403).json({ detail: 'Este usuário não possui permissão para alterar agendamentos concluídos.' });
      }
    }

    const pagamentos = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
    const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);

    res.json({
      ...ag.toJSON(),
      pagamentos,
      total_pago: totalPago
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createAgend = async (req, res) => {
  try {
    const doc = await buildAgendamentoDoc(req.body);
    const maxNum = await getAgendamentoModel().max('numero') || 0;

    const ag = await getAgendamentoModel().create({
      ...doc,
      id: uuidv4(),
      numero: maxNum + 1,
      criado_por_id: req.user?.id || null,
      criado_por_nome: req.user?.name || null,
      criado_em: new Date()
    });

    // Generate automatic WhatsApp reminders
    await generateReminders(ag);

    res.status(201).json(ag);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

const updateAgend = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (!ag) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Não encontrado' });
    }

    const wasConcluido = ag.status === 'concluido';
    if (wasConcluido) {
      await adjustStock(ag, 'restore', { transaction, user: req.user });
    }

    let isOnlyInsumos = req.query.only_insumos === 'true' || req.body.only_insumos === true;
    if (isOnlyInsumos) {
      const tempDoc = await buildAgendamentoDoc(req.body, req.params.aid);

      const sameCliente = tempDoc.cliente_id === ag.cliente_id;
      const sameDataHora = Math.abs(new Date(tempDoc.data_hora).getTime() - new Date(ag.data_hora).getTime()) < 1000;
      const sameObservacoes = (tempDoc.observacoes || '') === (ag.observacoes || '');

      let agItensList = [];
      try {
        agItensList = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : (ag.itens || []);
      } catch (e) {
        agItensList = ag.itens || [];
      }

      let sameItens = Array.isArray(tempDoc.itens) && Array.isArray(agItensList) && tempDoc.itens.length === agItensList.length;
      if (sameItens) {
        for (let i = 0; i < tempDoc.itens.length; i++) {
          const itemDoc = tempDoc.itens[i];
          const itemAg = agItensList[i];

          const docColab = itemDoc.colaborador_id || null;
          const agColab = itemAg.colaborador_id || null;
          const docAux = itemDoc.auxiliar_id || null;
          const agAux = itemAg.auxiliar_id || null;

          if (
            itemDoc.servico_id !== itemAg.servico_id ||
            docColab !== agColab ||
            docAux !== agAux ||
            Math.abs(Number(itemDoc.valor || 0) - Number(itemAg.valor || 0)) > 0.01
          ) {
            sameItens = false;
            break;
          }
        }
      }

      if (!sameCliente || !sameDataHora || !sameObservacoes || !sameItens) {
        isOnlyInsumos = false;
      }
    }

    if (ag.status === 'concluido' && !isOnlyInsumos) {
      const email = req.body.auth_email || req.headers['x-auth-email'] || req.query.email;
      const password = req.body.auth_password || req.body.password || req.headers['x-auth-password'] || req.query.password;
      if (!email || !password) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Para alterar um agendamento concluído, é necessária a autorização de um administrador (usuário e senha).' });
      }
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' }, transaction });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        await transaction.rollback();
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      if (!authUser.pode_alterar_concluido) {
        await transaction.rollback();
        return res.status(403).json({ detail: 'Este usuário não possui permissão para alterar agendamentos concluídos.' });
      }
    }

    const doc = await buildAgendamentoDoc(req.body, req.params.aid);
    // Remove status and valor_pago from update to prevent manual overrides
    delete doc.status;
    delete doc.valor_pago;

    await ag.update(doc, { transaction });

    if (wasConcluido) {
      const updatedAg = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
      await adjustStock(updatedAg, 'deduct', { transaction, user: req.user });
    }

    await transaction.commit();

    // Update scheduled WhatsApp reminders (handles rescheduling)
    await generateReminders(ag);

    res.json(ag);
  } catch (error) {
    await transaction.rollback();
    res.status(400).json({ detail: error.message });
  }
};

const deleteAgend = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    if (!req.user || !req.user.pode_excluir_agendamento) {
      await transaction.rollback();
      return res.status(403).json({ detail: 'Você não tem permissão para excluir agendamentos.' });
    }

    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (ag) {
      // Validar pagamentos vinculados
      const countPagamentos = await getPagamentoModel().count({
        where: {
          agendamento_id: req.params.aid,
          deletado: 'N'
        },
        transaction
      });

      if (countPagamentos > 0) {
        console.warn(`[AUDIT] Tentativa de exclusão de agendamento bloqueada: O agendamento ID ${req.params.aid} possui pagamentos ativos.`);
        await transaction.rollback();
        return res.status(400).json({ detail: "Não é permitido excluir registros que possuem pagamentos vinculados." });
      }

      if (ag.status === 'concluido') {
        await adjustStock(ag, 'restore', { transaction, user: req.user });
      }
      await ag.update({
        deletado: 'S',
        deletado_por: req.user ? req.user.name : 'Sistema',
        deletado_em: new Date()
      }, { transaction });
      await getPagamentoModel().update(
        {
          deletado: 'S',
          deletado_por: req.user ? req.user.name : 'Sistema',
          deletado_em: new Date()
        },
        {
          where: { agendamento_id: req.params.aid },
          transaction
        }
      );

      // Cancel any pending reminders
      await cancelReminders(req.params.aid);
    }
    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const setStatus = async (req, res) => {
  const { status } = req.body;
  const valid = ['agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado'];
  if (!valid.includes(status)) return res.status(400).json({ detail: 'Status inválido' });

  const transaction = await sequelize.transaction();
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (!ag) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Não encontrado' });
    }

    if (status === 'concluido') {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      const pagamentos = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
      const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
      if (totalPago < ag.valor_total - 0.01) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Registre o pagamento total antes de finalizar' });
      }
    }

    const oldStatus = ag.status;
    if (oldStatus !== status) {
      if (status === 'concluido') {
        await adjustStock(ag, 'deduct', { transaction, user: req.user });
      } else if (oldStatus === 'concluido') {
        await adjustStock(ag, 'restore', { transaction, user: req.user });
      }
    }

    ag.status = status;
    await ag.save({ transaction });

    await transaction.commit();

    // WhatsApp Reminders hooks
    if (status === 'cancelado') {
      await cancelReminders(ag.id);
    } else if (status === 'agendado' || status === 'confirmado') {
      await generateReminders(ag);
    } else if (status === 'concluido') {
      await generateThankYouReminder(ag);
    }

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
    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (!ag) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Agendamento não encontrado' });
    }

    const existingPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
    const pagoAtual = existingPags.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const novoValorBruto = pagamentos.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    let adjustedPagamentos = pagamentos.map(p => ({
      ...p,
      valor_recebido: Number(p.valor || 0),
      troco: 0,
      valor: Number(p.valor || 0)
    }));
    let novoTotal = pagoAtual + novoValorBruto;

    if (novoTotal > ag.valor_total + 0.01) {
      let excesso = novoTotal - ag.valor_total;
      let idxDinheiro = adjustedPagamentos.findIndex(p => p.forma_pagamento === 'dinheiro');
      if (idxDinheiro !== -1 && adjustedPagamentos[idxDinheiro].valor_recebido >= excesso) {
        adjustedPagamentos[idxDinheiro].valor = Number((adjustedPagamentos[idxDinheiro].valor_recebido - excesso).toFixed(2));
        adjustedPagamentos[idxDinheiro].troco = Number(excesso.toFixed(2));
        adjustedPagamentos[idxDinheiro].observacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (adjustedPagamentos[idxDinheiro].observacao ? ` - ${adjustedPagamentos[idxDinheiro].observacao}` : '');
        novoTotal = ag.valor_total;
      } else {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Valor excede o total devido' });
      }
    }

    for (const p of adjustedPagamentos) {
      await getPagamentoModel().create({
        id: uuidv4(),
        agendamento_id: req.params.aid,
        valor: p.valor,
        valor_recebido: p.valor_recebido,
        troco: p.troco,
        forma_pagamento: p.forma_pagamento,
        observacao: p.observacao || '',
        data_hora: new Date()
      }, { transaction });
    }

    const oldStatus = ag.status;
    ag.valor_pago = novoTotal;
    if (finalizar && novoTotal >= ag.valor_total - 0.01) {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      ag.status = 'concluido';
    }

    if (oldStatus !== ag.status) {
      if (ag.status === 'concluido') {
        await adjustStock(ag, 'deduct', { transaction, user: req.user });
      } else if (oldStatus === 'concluido') {
        await adjustStock(ag, 'restore', { transaction, user: req.user });
      }
    }
    await ag.save({ transaction });

    await transaction.commit();

    // Gerar lembrete de agradecimento se status mudou para concluído
    if (oldStatus !== 'concluido' && ag.status === 'concluido') {
      await generateThankYouReminder(ag);
    }

    res.json({ ok: true, total_pago: novoTotal, saldo: ag.valor_total - novoTotal });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const updatePagamento = async (req, res) => {
  const { valor, forma_pagamento, observacao } = req.body;
  const password = req.body.password || req.body.auth_password || req.headers['x-auth-password'] || req.query.password;

  const transaction = await sequelize.transaction();
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (!ag) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Agendamento não encontrado' });
    }

    if (ag.status === 'concluido') {
      if (!password) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Senha é obrigatória' });
      }
      const user = await getUserModel().findByPk(req.user.id, { transaction });
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        await transaction.rollback();
        return res.status(401).json({ detail: 'Senha incorreta' });
      }
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid, { transaction });
    if (!pagamento) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Pagamento não encontrado' });
    }

    const otherPags = await getPagamentoModel().findAll({
      where: {
        agendamento_id: req.params.aid,
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

    if (novoTotal > ag.valor_total + 0.01) {
      let excesso = novoTotal - ag.valor_total;
      if (forma_pagamento === 'dinheiro' && novoValorRecebido >= excesso) {
        novoTroco = Number(excesso.toFixed(2));
        novoValorNet = Number((novoValorRecebido - excesso).toFixed(2));
        novaObservacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (observacao ? ` - ${observacao}` : '');
      } else {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Valor excede o total devido' });
      }
    }

    pagamento.valor = novoValorNet;
    pagamento.valor_recebido = novoValorRecebido;
    pagamento.troco = novoTroco;
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = novaObservacao;
    await pagamento.save({ transaction });

    const oldStatus = ag.status;
    const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
    const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
    ag.valor_pago = totalPago;
    if (totalPago >= ag.valor_total - 0.01) {
      ag.status = 'concluido';
    } else {
      ag.status = 'agendado';
    }

    if (oldStatus !== ag.status) {
      if (ag.status === 'concluido') {
        await adjustStock(ag, 'deduct', { transaction, user: req.user });
      } else if (oldStatus === 'concluido') {
        await adjustStock(ag, 'restore', { transaction, user: req.user });
      }
    }
    await ag.save({ transaction });

    await transaction.commit();

    // Gerar lembrete de agradecimento se status mudou para concluído
    if (oldStatus !== 'concluido' && ag.status === 'concluido') {
      await generateThankYouReminder(ag);
    }

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
    const ag = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
    if (!ag) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Agendamento não encontrado' });
    }

    if (ag.status === 'concluido') {
      if (!email || !password) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Usuário e senha são obrigatórios' });
      }
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim() }, transaction });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        await transaction.rollback();
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      if (!authUser.pode_excluir_pagamento) {
        await transaction.rollback();
        return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
      }
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid, { transaction });
    if (!pagamento) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Pagamento não encontrado' });
    }

    await pagamento.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    }, { transaction });

    if (ag) {
      const oldStatus = ag.status;
      const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      ag.valor_pago = totalPago;
      if (totalPago >= ag.valor_total - 0.01) {
        ag.status = 'concluido';
      } else {
        ag.status = 'agendado';
      }

      if (oldStatus !== ag.status) {
        if (ag.status === 'concluido') {
          await adjustStock(ag, 'deduct', { transaction, user: req.user });
        } else if (oldStatus === 'concluido') {
          await adjustStock(ag, 'restore', { transaction, user: req.user });
        }
      }
      await ag.save({ transaction });
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const patchObservacoes = async (req, res) => {
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (!ag || ag.deletado === 'S') return res.status(404).json({ detail: 'Não encontrado' });

    const { observacoes } = req.body;
    ag.observacoes = observacoes || '';
    await ag.save();

    res.json({ ok: true, observacoes: ag.observacoes });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const aplicarDescontoAgendamento = async (req, res) => {
  const { aid } = req.params;
  const { descontoId } = req.body;

  try {
    const ag = await getAgendamentoModel().findByPk(aid);
    if (!ag || ag.deletado === 'S') {
      return res.status(404).json({ detail: 'Agendamento não encontrado' });
    }

    if (ag.status === 'concluido' || ag.valor_pago > 0) {
      return res.status(400).json({ detail: 'Não é possível aplicar desconto em um agendamento finalizado ou pago.' });
    }

    let itens = Array.isArray(ag.itens) ? [...ag.itens] : [];

    // Se descontoId for nulo/vazio, reverter o desconto
    if (!descontoId) {
      itens = itens.map(item => {
        if (item.valor_original !== undefined) {
          item.valor = item.valor_original;
          delete item.valor_original;
        }
        return item;
      });

      ag.itens = itens;
      ag.changed('itens', true);
      const valor_total = itens.reduce((acc, i) => acc + Number(i.valor || 0), 0);
      await ag.update({ itens, valor_total, desconto_aplicado: null });

      return res.json({ ok: true, agendamento: ag });
    }

    const desconto = await getDescontoModel().findOne({ where: { id: descontoId, deletado: 'N', ativo: true } });
    if (!desconto) {
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

    // Identificar itens elegíveis (serviços) e reverter quaisquer descontos anteriores primeiro
    let eligibleItens = [];
    itens = itens.map(item => {
      if (item.valor_original !== undefined) {
        item.valor = item.valor_original;
      } else {
        item.valor_original = item.valor;
      }

      const isEligible = !isRestrictedToItems || (vinculados.services && vinculados.services.includes(item.servico_id));
      if (isEligible) {
        eligibleItens.push(item);
      }
      return item;
    });

    if (eligibleItens.length === 0) {
      return res.status(400).json({ detail: 'Este desconto não é elegível para nenhum serviço deste agendamento.' });
    }

    const subtotalElegivel = eligibleItens.reduce((acc, i) => acc + Number(i.valor), 0);

    // Calcular desconto
    let totalDiscount = 0;
    if (desconto.tipo === 'porcentagem') {
      totalDiscount = subtotalElegivel * (desconto.valor / 100);
    } else { // valor_fixo
      totalDiscount = Math.min(desconto.valor, subtotalElegivel);
    }

    // Distribuir desconto
    if (subtotalElegivel > 0) {
      eligibleItens.forEach(item => {
        const proporcao = item.valor / subtotalElegivel;
        const itemDiscount = totalDiscount * proporcao;
        item.valor = Math.max(0, Number((item.valor - itemDiscount).toFixed(2)));
      });
    }

    let bloquearValorMenor = false;
    try {
      const systemConfig = await getConfiguracaoSistemaModel().findOne();
      if (systemConfig) {
        bloquearValorMenor = !!systemConfig.bloquear_valor_agendamento_menor;
      }
    } catch (err) {
      console.error("Erro ao carregar configuracoes do sistema:", err);
    }

    if (bloquearValorMenor) {
      for (const item of itens) {
        const s = await getServicoModel().findByPk(item.servico_id);
        if (s && item.valor < Number(s.valor || 0)) {
          return res.status(400).json({ detail: `Não é permitido aplicar este desconto pois o valor cobrado para o serviço "${s.nome}" (R$ ${Number(item.valor).toFixed(2)}) ficaria inferior ao valor cadastrado (R$ ${Number(s.valor || 0).toFixed(2)}).` });
        }
      }
    }

    ag.itens = itens;
    ag.changed('itens', true);
    const valor_total = itens.reduce((acc, i) => acc + Number(i.valor || 0), 0);
    await ag.update({
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
      }
    });

    res.json({ ok: true, agendamento: ag });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listAgend,
  getAgend,
  createAgend,
  updateAgend,
  deleteAgend,
  setStatus,
  addPagamentos,
  updatePagamento,
  deletePagamento,
  patchObservacoes,
  aplicarDescontoAgendamento
};
