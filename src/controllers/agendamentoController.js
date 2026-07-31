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
import { getVendaDiretaModel } from '../models/VendaDireta.js';
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

    let rawItens = ag.itens;
    if (typeof rawItens === 'string') {
      try { rawItens = JSON.parse(rawItens); } catch (e) { rawItens = []; }
    }
    if (!Array.isArray(rawItens)) rawItens = [];

    for (const item of rawItens) {
      let utilized = item.produtos_utilizados;
      if (typeof utilized === 'string') {
        try { utilized = JSON.parse(utilized); } catch (e) { utilized = []; }
      }
      if (!Array.isArray(utilized)) utilized = [];

      for (const pu of utilized) {
        if (!pu || !pu.produto_id) continue;
        const prod = await getProdutoModel().findByPk(pu.produto_id, { transaction });
        if (prod) {
          const qty = Number(pu.quantidade || 0);
          const stockAdjustment = qty;

          const qtdAnterior = Number(prod.quantidade_estoque || 0);

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

export const limparComissoesAgendamento = (ag) => {
  if (ag.itens && Array.isArray(ag.itens)) {
    ag.itens = ag.itens.map(item => {
      const newItem = { ...item };
      delete newItem.comissao_percentual;
      delete newItem.comissao_valor_calculado;
      delete newItem.comissao_percentual_auxiliar;
      delete newItem.comissao_valor_calculado_auxiliar;
      // comissao_paga e comissao_paga_auxiliar são preservados intencionalmente.
      // O agendamento pode ser reaberto apenas para trocar forma de pagamento ou
      // ajuste pontual — a comissão já paga deve continuar marcada como paga
      // para evitar que seja paga em duplicidade.
      return newItem;
    });
    ag.changed('itens', true);
  }
};

export const recalculateAndFreezeCommissions = async (ag, transaction) => {
  const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: ag.id, deletado: 'N' }, transaction });
  
  let rawItens = ag.itens;
  if (typeof rawItens === 'string') {
    try { rawItens = JSON.parse(rawItens); } catch (e) { rawItens = []; }
  }
  if (!Array.isArray(rawItens)) rawItens = [];

  const totalTaxaCartao = allPags.reduce((acc, p) => acc + Number(p.cartao_taxa_valor || 0), 0);
  const totalServicos = rawItens.reduce((acc, item) => acc + Number(item.valor || 0), 0);
  
  const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
  const colaboradores = await getColaboradorModel().findAll({ transaction });
  const produtos = await getProdutoModel().findAll({ transaction });
  
  const { getColaboradorComissaoServicoModel } = await import('../models/ColaboradorComissaoServico.js');
  const ColaboradorComissaoServico = getColaboradorComissaoServicoModel();
  const comissoesAvancadas = await ColaboradorComissaoServico.findAll({ transaction });
  const comissoesAvancadasMap = new Map(
    comissoesAvancadas.map(c => [`${c.colaborador_id}_${c.servico_id}`, c])
  );

  const updatedItens = [];
  for (const item of rawItens) {
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
    let produtos_utilizados = item.produtos_utilizados;
    if (typeof produtos_utilizados === 'string') {
      try { produtos_utilizados = JSON.parse(produtos_utilizados); } catch (e) { produtos_utilizados = []; }
    }
    if (!Array.isArray(produtos_utilizados)) produtos_utilizados = [];

    for (const pu of produtos_utilizados) {
      if (!pu) continue;
      let c_prop = pu.custo_proporcional;
      if (c_prop === undefined || c_prop === null || isNaN(c_prop)) {
        const prodModel = produtos.find(p => p.id === pu.produto_id);
        if (prodModel) {
          c_prop = (prodModel.quantidade_por_unidade > 0)
            ? (Number(prodModel.custo_unitario || 0) / prodModel.quantidade_por_unidade)
            : Number(prodModel.custo_unitario || 0);
        } else {
          c_prop = Number(pu.custo_unitario || 0);
        }
      }
      const qty = Number(pu.quantidade || 0);
      const cost = Number(c_prop || 0);
      custo_produtos += (isNaN(qty) ? 0 : qty) * (isNaN(cost) ? 0 : cost);
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
    
    // Obter alíquotas e calcular comissão para o profissional principal
    const colab = colaboradores.find(c => c.id === item.colaborador_id);
    const temAuxiliar = !!(item.auxiliar_id && String(item.auxiliar_id).trim() !== "" && String(item.auxiliar_id).trim() !== "null" && String(item.auxiliar_id).trim() !== "undefined");
    const colabAux = temAuxiliar ? colaboradores.find(c => c.id === item.auxiliar_id) : null;

    let comissao_percentual = null;
    let comissao_valor_calculado = null;
    if (colab) {
      const jaTemCalculado = item.comissao_percentual !== undefined && item.comissao_percentual !== null && item.comissao_valor_calculado !== undefined && item.comissao_valor_calculado !== null;
      if (jaTemCalculado) {
        comissao_percentual = Number(item.comissao_percentual);
        comissao_valor_calculado = Number(item.comissao_valor_calculado);
      } else {
        if (colab.usar_comissao_avancada) {
          const key = `${colab.id}_${item.servico_id}`;
          const comAvancada = comissoesAvancadasMap.get(key);
          if (comAvancada) {
            comissao_percentual = temAuxiliar
              ? Number(comAvancada.comissao_ajuda !== null && comAvancada.comissao_ajuda !== undefined ? comAvancada.comissao_ajuda : 30)
              : Number(comAvancada.comissao_sozinho !== null && comAvancada.comissao_sozinho !== undefined ? comAvancada.comissao_sozinho : (comAvancada.comissao_principal || 40));
          } else {
            comissao_percentual = temAuxiliar
              ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
              : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 40));
          }
        } else {
          comissao_percentual = temAuxiliar
            ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
            : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 40));
        }
        comissao_valor_calculado = Number((base_comissao_final * (comissao_percentual / 100)).toFixed(2));
      }
    }

    let comissao_percentual_auxiliar = null;
    let comissao_valor_calculado_auxiliar = null;
    if (colabAux) {
      const jaTemCalculadoAux = item.comissao_percentual_auxiliar !== undefined && item.comissao_percentual_auxiliar !== null && item.comissao_valor_calculado_auxiliar !== undefined && item.comissao_valor_calculado_auxiliar !== null;
      if (jaTemCalculadoAux) {
        comissao_percentual_auxiliar = Number(item.comissao_percentual_auxiliar);
        comissao_valor_calculado_auxiliar = Number(item.comissao_valor_calculado_auxiliar);
      } else {
        if (colabAux.usar_comissao_avancada) {
          const key = `${colabAux.id}_${item.servico_id}`;
          const comAvancada = comissoesAvancadasMap.get(key);
          if (comAvancada) {
            comissao_percentual_auxiliar = Number(comAvancada.comissao_auxiliar !== null && comAvancada.comissao_auxiliar !== undefined ? comAvancada.comissao_auxiliar : 20);
          } else {
            comissao_percentual_auxiliar = Number(colabAux.comissao_auxiliar != null ? colabAux.comissao_auxiliar : 20);
          }
        } else {
          comissao_percentual_auxiliar = Number(colabAux.comissao_auxiliar != null ? colabAux.comissao_auxiliar : 20);
        }
        comissao_valor_calculado_auxiliar = Number((base_comissao_final * (comissao_percentual_auxiliar / 100)).toFixed(2));
      }
    }
    
    updatedItens.push({
      ...item,
      base_comissao_original: Number(base_comissao_original.toFixed(2)),
      taxa_cartao_descontada: Number(taxa_cartao_descontada.toFixed(2)),
      base_comissao_final: Number(base_comissao_final.toFixed(2)),
      descontou_taxa_cartao: descontou,
      comissao_percentual,
      comissao_valor_calculado,
      comissao_percentual_auxiliar,
      comissao_valor_calculado_auxiliar
    });
  }

  ag.itens = updatedItens;
  ag.changed('itens', true);
};


const buildAgendamentoDoc = async (body, excludeId = null, options = {}) => {
  const cliente = await getClienteModel().findByPk(body.cliente_id);
  if (!cliente) throw new Error('Cliente inválido');

  const isOnlyInsumos = options.isOnlyInsumos || body.only_insumos === true || options.skipConflictCheck === true;

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
  // Validação de disponibilidade de horário e indisponibilidade de colaboradores (principal ou auxiliar)
  if (!isOnlyInsumos && !body.ignorar_conflito) {
    const { verificarDisponibilidade } = await import('../utils/agendaRules.js');
    const idsVerificar = Array.from(profsMap.keys());
    await verificarDisponibilidade({
      dataHoraNormalizada,
      duracaoTotalMinutos: duracaoTotal,
      profissionaisIds: idsVerificar,
      excludeAgendamentoId: excludeId
    });
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

    const initialIsOnlyInsumos = req.query.only_insumos === 'true' || req.body.only_insumos === true;
    let isOnlyInsumos = initialIsOnlyInsumos;
    if (isOnlyInsumos) {
      const tempDoc = await buildAgendamentoDoc(req.body, req.params.aid, { isOnlyInsumos: true });

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

    if (ag.status === 'concluido' && !isOnlyInsumos && !req.user.pode_alterar_concluido) {
      await transaction.rollback();
      return res.status(400).json({
        detail: 'Não é permitido editar um agendamento concluído. Reabra o agendamento (removendo ou estornando o pagamento) antes de realizar alterações.'
      });
    }

    const doc = await buildAgendamentoDoc(req.body, req.params.aid, { isOnlyInsumos: initialIsOnlyInsumos });
    // Remove status and valor_pago from update to prevent manual overrides
    delete doc.status;
    delete doc.valor_pago;

    await ag.update(doc, { transaction });

    if (wasConcluido) {
      const updatedAg = await getAgendamentoModel().findByPk(req.params.aid, { transaction });
      await recalculateAndFreezeCommissions(updatedAg, transaction);
      await updatedAg.save({ transaction });
      if (updatedAg.status === 'concluido') {
        await adjustStock(updatedAg, 'deduct', { transaction, user: req.user });
      }
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
    const canDelete = req.user && (
      req.user.pode_excluir_agendamento === true ||
      (req.user.perfil && req.user.perfil.permissoes && req.user.perfil.permissoes["agenda.excluir"] === true)
    );
    if (!canDelete) {
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
      const hasConcludePerm = req.user.role === 'admin' || req.user.perfil?.permissoes?.['agenda.concluir'] === true;
      if (!hasConcludePerm) {
        await transaction.rollback();
        return res.status(403).json({ detail: 'Você não tem permissão para concluir agendamentos.' });
      }

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
        limparComissoesAgendamento(ag);
      }
    }

    if (status === 'cancelado') {
      const { motivo } = req.body;
      if (!motivo || typeof motivo !== 'string' || motivo.trim() === '') {
        await transaction.rollback();
        return res.status(400).json({ detail: 'O motivo do cancelamento é obrigatório.' });
      }
      if (motivo.length > 100) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'O motivo do cancelamento deve ter no máximo 100 caracteres.' });
      }

      ag.cancelado_motivo = motivo.trim();
      ag.cancelado_por_id = req.user ? req.user.id : null;
      ag.cancelado_por_nome = req.user ? req.user.name : 'Sistema';
      ag.cancelado_em = new Date();
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

    if (ag.status === 'concluido' && Math.abs(novoTotal - ag.valor_total) > 0.01 && !req.user.pode_alterar_concluido) {
      await transaction.rollback();
      return res.status(400).json({
        detail: `Não é possível adicionar pagamentos a um agendamento concluído porque o novo total pago (R$ ${novoTotal.toFixed(2)}) seria diferente do valor total do agendamento (R$ ${ag.valor_total.toFixed(2)}).`
      });
    }

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
      let rawItens = ag.itens;
      if (typeof rawItens === 'string') {
        try { rawItens = JSON.parse(rawItens); } catch (e) { rawItens = []; }
      }
      if (!Array.isArray(rawItens)) rawItens = [];

      for (const item of rawItens) {
        if (!item || !item.colaborador_id || item.colaborador_id === "none") {
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
    console.error('Erro ao adicionar pagamentos no agendamento:', error);
    res.status(400).json({ detail: error.message || 'Erro ao processar pagamento do agendamento.' });
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

    if (ag.status === 'concluido' && novoTotal > ag.valor_total + 0.01) {
      await transaction.rollback();
      return res.status(400).json({
        detail: `Não é possível alterar o valor do pagamento de um agendamento concluído para um valor superior ao total do agendamento.`
      });
    }

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
        limparComissoesAgendamento(ag);
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
        return res.status(400).json({ detail: 'Usuário e senha são obrigatórios para alterar pagamentos de agendamento concluído.' });
      }
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' }, transaction });
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
          limparComissoesAgendamento(ag);
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
  const { descontoId, vendasDiretasIds } = req.body;
  const transaction = await sequelize.transaction();

  try {
    const ag = await getAgendamentoModel().findByPk(aid, { transaction });
    if (!ag || ag.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Agendamento não encontrado' });
    }

    if (ag.status === 'concluido' || ag.valor_pago > 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Não é possível aplicar desconto em um agendamento finalizado ou pago.' });
    }

    let itens = Array.isArray(ag.itens) ? [...ag.itens] : [];
    let agDescontoMeta = ag.desconto_aplicado;
    if (typeof agDescontoMeta === 'string') {
      try {
        agDescontoMeta = JSON.parse(agDescontoMeta);
      } catch (e) {}
    }
    const currentAppliedDescontoId = agDescontoMeta?.desconto_id;

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
      await ag.update({ itens, valor_total, desconto_aplicado: null }, { transaction });

      const pendingSales = await getVendaDiretaModel().findAll({
        where: { cliente_id: ag.cliente_id, status: 'pendente', deletado: 'N' },
        transaction
      });

      for (const sale of pendingSales) {
        const isSelected = Array.isArray(vendasDiretasIds) && vendasDiretasIds.includes(sale.id);
        let saleDescontoMeta = sale.desconto_aplicado;
        if (typeof saleDescontoMeta === 'string') {
          try {
            saleDescontoMeta = JSON.parse(saleDescontoMeta);
          } catch (e) {}
        }
        const hasSameDesconto = currentAppliedDescontoId && saleDescontoMeta?.desconto_id === currentAppliedDescontoId;
        
        if (isSelected || hasSameDesconto) {
          let saleItens = Array.isArray(sale.itens) ? [...sale.itens] : [];
          let changed = false;
          saleItens = saleItens.map(item => {
            if (item.preco_unitario_original !== undefined) {
              item.preco_unitario = item.preco_unitario_original;
              item.subtotal = item.quantidade * item.preco_unitario;
              delete item.preco_unitario_original;
              changed = true;
            }
            return item;
          });
          if (changed || sale.desconto_aplicado !== null) {
            const v_total = saleItens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
            const primeiro = saleItens[0] || {};
            sale.itens = saleItens;
            sale.changed('itens', true);
            await sale.update({
              itens: saleItens,
              valor_total: v_total,
              desconto_aplicado: null,
              produto_id: primeiro.produto_id || sale.produto_id,
              produto_nome: saleItens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${saleItens.length - 1})`,
              quantidade: saleItens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
            }, { transaction });
          }
        }
      }

      await transaction.commit();
      return res.json({ ok: true, agendamento: ag });
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

    const hasLinkedServices = Array.isArray(vinculados?.services) && vinculados.services.length > 0;
    const hasLinkedProducts = Array.isArray(vinculados?.products) && vinculados.products.length > 0;
    const isGeneral = !hasLinkedServices && !hasLinkedProducts;

    // Primeiro, reverter descontos anteriores em todos os itens do agendamento
    itens = itens.map(item => {
      if (item.valor_original !== undefined) {
        item.valor = item.valor_original;
      } else {
        item.valor_original = item.valor;
      }
      return item;
    });

    // E reverter apenas as vendas diretas pendentes associadas que estão selecionadas ou possuem o mesmo desconto
    const pendingSales = await getVendaDiretaModel().findAll({
      where: { cliente_id: ag.cliente_id, status: 'pendente', deletado: 'N' },
      transaction
    });
    for (const sale of pendingSales) {
      const isSelected = Array.isArray(vendasDiretasIds) && vendasDiretasIds.includes(sale.id);
      let saleDescontoMeta = sale.desconto_aplicado;
      if (typeof saleDescontoMeta === 'string') {
        try {
          saleDescontoMeta = JSON.parse(saleDescontoMeta);
        } catch (e) {}
      }
      const hasSameDesconto = currentAppliedDescontoId && saleDescontoMeta?.desconto_id === currentAppliedDescontoId;

      if (isSelected || hasSameDesconto) {
        let saleItens = Array.isArray(sale.itens) ? [...sale.itens] : [];
        let changed = false;
        saleItens = saleItens.map(item => {
          if (item.preco_unitario_original !== undefined) {
            item.preco_unitario = item.preco_unitario_original;
            item.subtotal = item.quantidade * item.preco_unitario;
            delete item.preco_unitario_original;
            changed = true;
          }
          return item;
        });
        if (changed || sale.desconto_aplicado !== null) {
          const v_total = saleItens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
          const primeiro = saleItens[0] || {};
          sale.itens = saleItens;
          sale.changed('itens', true);
          await sale.update({
            itens: saleItens,
            valor_total: v_total,
            desconto_aplicado: null,
            produto_id: primeiro.produto_id || sale.produto_id,
            produto_nome: saleItens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${saleItens.length - 1})`,
            quantidade: saleItens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
          }, { transaction });
        }
      }
    }

    // Carregar as vendas selecionadas atualizadas (após reversão)
    const selectedSales = await getVendaDiretaModel().findAll({
      where: { id: vendasDiretasIds || [], status: 'pendente', deletado: 'N' },
      transaction
    });

    // Identificar itens elegíveis (Serviços e Produtos)
    let eligibleServices = [];
    if (isGeneral) {
      eligibleServices = itens;
    } else if (hasLinkedServices) {
      eligibleServices = itens.filter(item => vinculados.services.includes(item.servico_id));
    }

    let eligibleProducts = [];
    selectedSales.forEach(sale => {
      // Normalizar itens se necessário
      if (!Array.isArray(sale.itens) || sale.itens.length === 0) {
        sale.itens = [{
          produto_id: sale.produto_id,
          produto_nome: sale.produto_nome,
          quantidade: sale.quantidade || 1,
          preco_unitario: sale.quantidade > 0 ? sale.valor_total / sale.quantidade : sale.valor_total,
          subtotal: sale.valor_total,
          comissao_pct: 0
        }];
      }

      sale.itens.forEach((item, index) => {
        // Restaurar preco_unitario_original se não existir
        if (item.preco_unitario_original === undefined) {
          item.preco_unitario_original = item.preco_unitario;
        }
        
        const isEligible = isGeneral || (hasLinkedProducts && vinculados.products.includes(item.produto_id));
        if (isEligible) {
          eligibleProducts.push({
            saleId: sale.id,
            itemIndex: index,
            item: item,
            sale: sale
          });
        }
      });
    });

    const subtotalServices = eligibleServices.reduce((acc, item) => acc + Number(item.valor), 0);
    const subtotalProducts = eligibleProducts.reduce((acc, ep) => acc + Number(ep.item.subtotal || (ep.item.quantidade * ep.item.preco_unitario)), 0);
    const totalElegivel = subtotalServices + subtotalProducts;

    if (totalElegivel === 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Este desconto não é elegível para nenhum serviço deste agendamento ou produto das vendas selecionadas.' });
    }

    // Calcular desconto total
    let totalDiscount = 0;
    if (desconto.tipo === 'porcentagem') {
      if (hasLinkedProducts && !hasLinkedServices) {
        // Rule 1: Vinculado apenas a Produtos
        totalDiscount = subtotalProducts * (desconto.valor / 100);
      } else if (hasLinkedServices && !hasLinkedProducts) {
        // Rule 3: Vinculado apenas a Serviços
        totalDiscount = subtotalServices * (desconto.valor / 100);
      } else {
        // Rule 2: Serviços e Produtos (ou Geral)
        totalDiscount = totalElegivel * (desconto.valor / 100);
      }
    } else { // valor_fixo
      if (hasLinkedProducts && !hasLinkedServices) {
        // Rule 1: Vinculado apenas a Produtos
        totalDiscount = Math.min(desconto.valor, subtotalProducts);
      } else if (hasLinkedServices && !hasLinkedProducts) {
        // Rule 3: Vinculado apenas a Serviços
        totalDiscount = Math.min(desconto.valor, subtotalServices);
      } else {
        // Rule 2: Serviços e Produtos (ou Geral)
        totalDiscount = Math.min(desconto.valor, totalElegivel);
      }
    }

    // Rateio do desconto
    let discountServices = 0;
    let discountProducts = 0;

    if (hasLinkedProducts && !hasLinkedServices) {
      discountProducts = totalDiscount;
    } else if (hasLinkedServices && !hasLinkedProducts) {
      discountServices = totalDiscount;
    } else {
      if (totalElegivel > 0) {
        discountServices = totalDiscount * (subtotalServices / totalElegivel);
        discountProducts = totalDiscount * (subtotalProducts / totalElegivel);
      }
    }

    // Distribuir desconto nos serviços com ajuste de arredondamento
    if (subtotalServices > 0 && discountServices > 0) {
      let distributedServicesDiscount = 0;
      eligibleServices.forEach((item, idx) => {
        const proporcao = item.valor / subtotalServices;
        let itemDiscount = Number((discountServices * proporcao).toFixed(2));
        if (idx === eligibleServices.length - 1) {
          itemDiscount = Number((discountServices - distributedServicesDiscount).toFixed(2));
        }
        distributedServicesDiscount += itemDiscount;
        item.valor = Math.max(0, Number((item.valor - itemDiscount).toFixed(2)));
      });
    }

    // Preparar objetos de atualização para vendas diretas
    const salesUpdates = {};
    selectedSales.forEach(sale => {
      salesUpdates[sale.id] = {
        sale,
        itens: [...sale.itens],
        totalDiscounted: 0
      };
    });

    // Distribuir desconto nos produtos com ajuste de arredondamento
    if (subtotalProducts > 0 && discountProducts > 0) {
      let distributedProductsDiscount = 0;
      eligibleProducts.forEach((ep, idx) => {
        const currentSubtotal = ep.item.subtotal || (ep.item.quantidade * ep.item.preco_unitario);
        const proporcao = currentSubtotal / subtotalProducts;
        let itemDiscount = Number((discountProducts * proporcao).toFixed(2));
        if (idx === eligibleProducts.length - 1) {
          itemDiscount = Number((discountProducts - distributedProductsDiscount).toFixed(2));
        }
        distributedProductsDiscount += itemDiscount;

        const updateObj = salesUpdates[ep.saleId];
        const targetItem = updateObj.itens[ep.itemIndex];

        targetItem.subtotal = Math.max(0, Number((currentSubtotal - itemDiscount).toFixed(2)));
        targetItem.preco_unitario = targetItem.quantidade > 0 ? Number((targetItem.subtotal / targetItem.quantidade).toFixed(2)) : 0;
        updateObj.totalDiscounted += itemDiscount;
      });
    }

    // Validar configuração bloquearValorMenor
    let bloquearValorMenor = false;
    try {
      const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
      if (systemConfig) {
        bloquearValorMenor = !!systemConfig.bloquear_valor_agendamento_menor;
      }
    } catch (err) {
      console.error("Erro ao carregar configuracoes do sistema:", err);
    }

    if (bloquearValorMenor) {
      for (const item of itens) {
        const s = await getServicoModel().findByPk(item.servico_id, { transaction });
        if (s && item.valor < Number(s.valor || 0)) {
          await transaction.rollback();
          return res.status(400).json({ detail: `Não é permitido aplicar este desconto pois o valor cobrado para o serviço "${s.nome}" (R$ ${Number(item.valor).toFixed(2)}) ficaria inferior ao valor cadastrado (R$ ${Number(s.valor || 0).toFixed(2)}).` });
        }
      }
    }

    // Salvar atualizações das vendas diretas
    for (const saleId of Object.keys(salesUpdates)) {
      const { sale, itens: saleItens, totalDiscounted } = salesUpdates[saleId];
      const v_total = saleItens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
      const primeiro = saleItens[0] || {};

      const discountAppliedData = totalDiscounted > 0 ? {
        desconto_id: desconto.id,
        codigo: desconto.codigo,
        descricao: desconto.descricao,
        tipo: desconto.tipo,
        valor_desconto: desconto.valor,
        total_descontado: Number(totalDiscounted.toFixed(2)),
        incide_comissao: desconto.incide_comissao !== false && desconto.incide_comissao !== 0,
        aplicado_em: new Date().toISOString()
      } : null;

      sale.itens = saleItens;
      sale.changed('itens', true);
      await sale.update({
        itens: saleItens,
        valor_total: v_total,
        desconto_aplicado: discountAppliedData,
        produto_id: primeiro.produto_id || sale.produto_id,
        produto_nome: saleItens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${saleItens.length - 1})`,
        quantidade: saleItens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
      }, { transaction });
    }

    // Salvar atualização do agendamento
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
        total_descontado: Number(discountServices.toFixed(2)),
        incide_comissao: desconto.incide_comissao !== false && desconto.incide_comissao !== 0,
        aplicado_em: new Date().toISOString()
      }
    }, { transaction });

    await transaction.commit();
    res.json({ ok: true, agendamento: ag });
  } catch (error) {
    await transaction.rollback();
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
