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
import * as clienteCreditoService from '../services/clienteCreditoService.js';
import { buildAgendaDayRange, formatAgendaDate, formatAgendaTime, normalizeAgendaDateTime } from '../utils/agendaDateTime.js';

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

export const recalculateAndFreezeCommissions = async (ag, transaction) => {
  const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: ag.id, deletado: 'N' }, transaction });
  
  const totalTaxaCartao = allPags.reduce((acc, p) => acc + Number(p.cartao_taxa_valor || 0), 0);
  const totalServicos = (ag.itens || []).reduce((acc, item) => acc + Number(item.valor || 0), 0);
  
  const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
  const colaboradores = await getColaboradorModel().findAll({ transaction });
  const produtos = await getProdutoModel().findAll({ transaction });

  const updatedItens = [];
  for (const item of (ag.itens || [])) {
    const val_serv = Number(item.valor || 0);
    
    let val_serv_comissao = val_serv;
    if (item.valor_original !== undefined && item.valor_original !== item.valor) {
      let descontoMeta = ag.desconto_aplicado;
      if (typeof descontoMeta === 'string') {
        try {
          descontoMeta = JSON.parse(descontoMeta);
        } catch (e) {}
      }
      if (descontoMeta && descontoMeta.incide_comissao === false) {
        val_serv_comissao = Number(item.valor_original || item.valor);
      }
    }

    let custo_produtos = 0;
    const produtos_utilizados = item.produtos_utilizados || [];
    for (const pu of produtos_utilizados) {
      let c_prop = pu.custo_proporcional;
      if (c_prop === undefined || c_prop === null) {
        const prodModel = produtos.find(p => p.id === pu.produto_id);
        if (prodModel) {
          c_prop = (prodModel.quantidade_por_unidade > 0)
            ? (Number(prodModel.custo_unitario || 0) / prodModel.quantidade_por_unidade)
            : Number(prodModel.custo_unitario || 0);
        } else {
          c_prop = Number(pu.custo_unitario || 0);
        }
      }
      custo_produtos += Number(pu.quantidade || 0) * Number(c_prop);
    }

    const base_comissao_original = Math.max(0, val_serv_comissao - custo_produtos);
    let taxa_cartao_descontada = 0;
    const descontou = !!systemConfig?.descontar_taxa_cartao_comissao;

    if (descontou && totalTaxaCartao > 0 && totalServicos > 0) {
      const fracao = val_serv / totalServicos;
      taxa_cartao_descontada = Number((fracao * totalTaxaCartao).toFixed(4));
    }

    const base_comissao_final = descontou 
      ? Math.max(0, base_comissao_original - taxa_cartao_descontada) 
      : base_comissao_original;
    
    updatedItens.push({
      ...item,
      base_comissao_original: Number(base_comissao_original.toFixed(2)),
      taxa_cartao_descontada: Number(taxa_cartao_descontada.toFixed(2)),
      base_comissao_final: Number(base_comissao_final.toFixed(2)),
      descontou_taxa_cartao: descontou
    });
  }

  ag.itens = updatedItens;
  ag.changed('itens', true);
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

  const dataHoraNormalizada = normalizeAgendaDateTime(body.data_hora);
  const novoInicio = dataHoraNormalizada;
  const novoFim = new Date(novoInicio.getTime() + duracaoTotal * 60000);
  const dataBusca = formatAgendaDate(dataHoraNormalizada);
  const { start: dataInicioDia, end: dataFimDia } = buildAgendaDayRange(dataBusca);

  const where = {
    data_hora: { [Op.between]: [dataInicioDia, dataFimDia] },
    deletado: 'N',
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
            throw new Error(`Conflito de horário: O profissional ${profConflito} já possui um agendamento entre ${formatAgendaTime(agInicio)} e ${formatAgendaTime(agFim)}`);
          }
        }
      }
    }
  }

  // Validação de indisponibilidade de colaboradores (principal ou auxiliar)
  if (!body.ignorar_conflito) {
    const idsVerificar = Array.from(profsMap.keys());
    if (idsVerificar.length > 0) {
      const { getColaboradorIndisponibilidadeModel } = await import('../models/ColaboradorIndisponibilidade.js');
      const indispList = await getColaboradorIndisponibilidadeModel().findAll({
        where: {
          colaborador_id: { [Op.in]: idsVerificar },
          deletado: 'N',
          data_hora_inicio: { [Op.lt]: novoFim },
          data_hora_fim: { [Op.gt]: novoInicio }
        }
      });

      if (indispList.length > 0) {
        const { TZDate } = await import('@date-fns/tz');
        const { format } = await import('date-fns');
        const { AGENDA_TIME_ZONE } = await import('../utils/agendaDateTime.js');

        const conflitos = [];
        for (const indisp of indispList) {
          const colab = await getColaboradorModel().findByPk(indisp.colaborador_id);
          const colabNome = colab ? colab.nome : 'Colaborador';
          
          const dateStr = format(new TZDate(indisp.data_hora_inicio, AGENDA_TIME_ZONE), 'dd/MM/yyyy');
          const startStr = format(new TZDate(indisp.data_hora_inicio, AGENDA_TIME_ZONE), 'HH:mm');
          const endStr = format(new TZDate(indisp.data_hora_fim, AGENDA_TIME_ZONE), 'HH:mm');
          
          const motivoStr = indisp.motivo ? indisp.motivo : 'indisponibilidade registrada sem motivo específico';
          conflitos.push(`O colaborador ${colabNome} possui uma indisponibilidade cadastrada para o período selecionado (${dateStr} ${startStr} - ${endStr}). Motivo: ${motivoStr}`);
        }
        throw new Error(`Conflito de indisponibilidade: ${conflitos.join('; ')}`);
      }
    }
  }

  return {
    cliente_id: body.cliente_id,
    cliente_nome: cliente.nome,
    data_hora: dataHoraNormalizada,
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
    const { start, end } = buildAgendaDayRange(data);
    where.data_hora = { [Op.between]: [start, end] };
  } else if (mes) {
    const [year, month] = mes.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const start = normalizeAgendaDateTime(`${mes}-01T00:00:00`);
    const end = normalizeAgendaDateTime(`${mes}-${String(lastDay).padStart(2, '0')}T23:59:59`);
    where.data_hora = { [Op.between]: [start, end] };
  } else if (data_inicio && data_fim) {
    const start = normalizeAgendaDateTime(`${data_inicio}T00:00:00`);
    const end = normalizeAgendaDateTime(`${data_fim}T23:59:59`);
    where.data_hora = { [Op.between]: [start, end] };
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
      await recalculateAndFreezeCommissions(updatedAg, transaction);
      await updatedAg.save({ transaction });
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
        await recalculateAndFreezeCommissions(ag, transaction);
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

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

    const existingPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
    const { getTaxaCartaoModel } = await import('../models/TaxaCartao.js');
    const cardRates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' }, transaction });
    const cardKeys = cardRates.map(r => r.forma_pagamento);
    const pagoAtual = existingPags.reduce((acc, p) => acc + Number(p.valor || 0), 0);
    const remainingSaldo = Number((ag.valor_total - pagoAtual).toFixed(2));

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
      if (novoTotal > ag.valor_total + 0.01) {
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
        if (!ag.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para utilizar crédito é necessário identificar o cliente no agendamento.' });
        }
        try {
          await clienteCreditoService.removerCredito(ag.cliente_id, {
            valor: Number(p.valor),
            tipo: 'CREDITO_UTILIZADO_VENDA',
            motivo: 'Utilização de crédito em agendamento',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `agendamento:${ag.id}`,
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

    if (novoTotal > ag.valor_total + 0.01) {
      let excesso = novoTotal - ag.valor_total;

      if (gerarCreditoExcedente) {
        if (!ag.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para gerar crédito é necessário identificar o cliente no agendamento.' });
        }
        if (!trabalharCredito) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
        }

        await clienteCreditoService.adicionarCredito(ag.cliente_id, {
          valor: excesso,
          tipo: 'CREDITO_GERADO_VENDA',
          motivo: 'Crédito gerado por excedente no recebimento de agendamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `agendamento:${ag.id}`,
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
        novoTotal = ag.valor_total;
      } else {
        let idxDinheiro = adjustedPagamentos.findIndex(p => p.forma_pagamento === 'dinheiro');
        if (idxDinheiro !== -1 && adjustedPagamentos[idxDinheiro].valor_recebido >= excesso) {
          adjustedPagamentos[idxDinheiro].valor = Number((adjustedPagamentos[idxDinheiro].valor_recebido - excesso).toFixed(2));
          adjustedPagamentos[idxDinheiro].troco = Number(excesso.toFixed(2));
          adjustedPagamentos[idxDinheiro].observacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (adjustedPagamentos[idxDinheiro].observacao ? ` - ${adjustedPagamentos[idxDinheiro].observacao}` : '');
          novoTotal = ag.valor_total;
        } else {
          await transaction.rollback();
          const isElectronic = pagamentos.some(p => ['pix', 'cartao_credito', 'cartao_debito', 'vale'].includes(p.forma_pagamento) || cardKeys.includes(p.forma_pagamento));
          const msg = isElectronic
            ? 'Não é permitido informar valor superior ao total do agendamento para esta forma de pagamento. Utilize o valor exato ou gere crédito para o cliente.'
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
        agendamento_id: req.params.aid,
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

    const oldStatus = ag.status;
    ag.valor_pago = novoTotal;

    let shouldConclude = false;
    if (Number(ag.valor_total) === 0) {
      shouldConclude = true;
    } else if (finalizar && novoTotal >= ag.valor_total - 0.01) {
      shouldConclude = true;
    }

    if (shouldConclude) {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      ag.status = 'concluido';
    }

    if (ag.status === 'concluido') {
      await recalculateAndFreezeCommissions(ag, transaction);
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
  const { valor, forma_pagamento, observacao, bandeira } = req.body;
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

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

    const otherPags = await getPagamentoModel().findAll({
      where: {
        agendamento_id: req.params.aid,
        deletado: 'N',
        id: { [Op.ne]: req.params.pid }
      },
      transaction
    });
    const pagoOutros = otherPags.reduce((acc, p) => acc + Number(p.valor || 0), 0);

    const hasCreditoCliente = forma_pagamento === 'credito_cliente';
    const hasExistingCredito = otherPags.some(p => p.forma_pagamento === 'credito_cliente');

    if (hasCreditoCliente) {
      const remainingSaldo = Number((ag.valor_total - pagoOutros).toFixed(2));
      if (Number(valor) > remainingSaldo + 0.01) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'O valor pago em crédito do cliente não pode ser superior ao saldo devedor.' });
      }
    }

    const novoValorRecebido = Number(valor || 0);
    const novoTotal = pagoOutros + novoValorRecebido;

    if (hasCreditoCliente || hasExistingCredito) {
      if (novoTotal > ag.valor_total + 0.01) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Não é permitido valor superior ao total para uma venda/atendimento que utiliza crédito do cliente como forma de pagamento.' });
      }
    }

    if (trabalharCredito && ag.cliente_id) {
      // Revert old payment credit usage
      if (pagamento.forma_pagamento === 'credito_cliente') {
        await clienteCreditoService.adicionarCredito(ag.cliente_id, {
          valor: pagamento.valor,
          tipo: 'ESTORNO',
          motivo: 'Reversão para atualização de pagamento em agendamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `agendamento:${ag.id}`,
          dispositivo
        }, { transaction });
      }

      // Revert old payment credit generation
      if (Number(pagamento.credito_gerado) > 0) {
        try {
          await clienteCreditoService.removerCredito(ag.cliente_id, {
            valor: pagamento.credito_gerado,
            tipo: 'ESTORNO',
            motivo: 'Reversão de crédito gerado para atualização em agendamento',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `agendamento:${ag.id}`,
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
          await clienteCreditoService.removerCredito(ag.cliente_id, {
            valor: Number(valor),
            tipo: 'CREDITO_UTILIZADO_VENDA',
            motivo: 'Utilização de crédito em pagamento de agendamento atualizado',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `agendamento:${ag.id}`,
            dispositivo
          }, { transaction });
        } catch (err) {
          await transaction.rollback();
          return res.status(400).json({ detail: err.message });
        }
      }
    }

    let novoTroco = 0;
    let novoValorNet = novoValorRecebido;
    let novaObservacao = observacao || '';
    let novoCreditoGerado = 0;

    const gerarCreditoExcedente = req.body.gerar_credito_excedente === true;

    if (novoTotal > ag.valor_total + 0.01) {
      let excesso = novoTotal - ag.valor_total;
      if (gerarCreditoExcedente) {
        if (!ag.cliente_id) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Para gerar crédito é necessário identificar o cliente no agendamento.' });
        }
        if (!trabalharCredito) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'A funcionalidade de Crédito de Clientes está desabilitada.' });
        }

        await clienteCreditoService.adicionarCredito(ag.cliente_id, {
          valor: excesso,
          tipo: 'CREDITO_GERADO_VENDA',
          motivo: 'Crédito gerado por atualização de pagamento em agendamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `agendamento:${ag.id}`,
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
            ? 'Não é permitido informar valor superior ao total do agendamento para esta forma de pagamento. Utilize o valor exato ou gere crédito para o cliente.'
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

    const oldStatus = ag.status;
    const allPagsInTransaction = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' }, transaction });
    const totalPago = allPagsInTransaction.reduce((acc, p) => acc + p.valor, 0);
    ag.valor_pago = totalPago;
    if (totalPago >= ag.valor_total - 0.01) {
      ag.status = 'concluido';
    } else {
      ag.status = 'agendado';
    }

    if (ag.status === 'concluido') {
      await recalculateAndFreezeCommissions(ag, transaction);
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

    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const trabalharCredito = systemConfig ? !!systemConfig.trabalhar_credito_cliente : false;

    if (trabalharCredito && ag.cliente_id) {
      const dispositivo = `${req.ip || ''} - ${req.headers['user-agent'] || ''}`;

      // If the deleted payment used credit
      if (pagamento.forma_pagamento === 'credito_cliente') {
        await clienteCreditoService.adicionarCredito(ag.cliente_id, {
          valor: pagamento.valor,
          tipo: 'ESTORNO',
          motivo: 'Estorno de pagamento excluído em agendamento',
          usuarioId: req.user.id,
          usuarioNome: req.user.name,
          origem: `agendamento:${ag.id}`,
          dispositivo
        }, { transaction });
      }

      // If the deleted payment generated credit
      if (Number(pagamento.credito_gerado) > 0) {
        try {
          await clienteCreditoService.removerCredito(ag.cliente_id, {
            valor: pagamento.credito_gerado,
            tipo: 'ESTORNO',
            motivo: 'Estorno de crédito gerado por pagamento excluído em agendamento',
            usuarioId: req.user.id,
            usuarioNome: req.user.name,
            origem: `agendamento:${ag.id}`,
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
      if (ag.status === 'concluido') {
        await recalculateAndFreezeCommissions(ag, transaction);
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
