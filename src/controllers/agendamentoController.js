import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { generateReminders, cancelReminders } from '../modules/whatsapp/reminder.service.js';
import { getClienteModel } from '../models/Cliente.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getServicoModel } from '../models/Servico.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getPagamentoModel } from '../models/Pagamento.js';
import { getUserModel } from '../models/User.js';
import { getDescontoModel } from '../models/Desconto.js';

const adjustStock = async (ag, type) => {
  try {
    for (const item of ag.itens || []) {
      const utilized = item.produtos_utilizados || [];
      for (const pu of utilized) {
        const prod = await getProdutoModel().findByPk(pu.produto_id);
        if (prod) {
          if (type === 'deduct') {
            prod.quantidade_estoque -= Number(pu.quantidade || 0);
          } else if (type === 'restore') {
            prod.quantidade_estoque += Number(pu.quantidade || 0);
          }
          await prod.save();
        }
      }
    }
  } catch (error) {
    console.error(`Failed to adjust stock (${type}) for appointment ${ag?.id}:`, error);
  }
};

const buildAgendamentoDoc = async (body, excludeId = null) => {
  const cliente = await getClienteModel().findByPk(body.cliente_id);
  if (!cliente) throw new Error('Cliente inválido');

  let itens = [];
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
          let custoUnitario = Number(pu.custo_unitario || 0);
          if (custoUnitario === 0) {
            const prod = await getProdutoModel().findByPk(pu.produto_id);
            custoUnitario = prod ? Number(prod.custo_unitario || 0) : 0;
          }
          let prodNome = pu.produto_nome || pu.produto_name || "";
          if (!prodNome && pu.produto_id) {
            const prod = await getProdutoModel().findByPk(pu.produto_id);
            prodNome = prod ? prod.nome : "";
          }
          resolvedProdutosUtilizados.push({
            produto_id: pu.produto_id,
            produto_nome: prodNome,
            quantidade: Number(pu.quantidade || 0),
            custo_unitario: custoUnitario
          });
        }
      }

      const valorOriginal = item.valor_original !== undefined && item.valor_original !== null && item.valor_original !== '' ? Number(item.valor_original) : Number(s.valor || 0);
      const valorCobrado = item.valor !== undefined && item.valor !== null && item.valor !== '' ? Number(item.valor) : Number(s.valor || 0);

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
    data_hora: body.data_hora,
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
  const { data, mes, data_inicio, data_fim } = req.query;
  const where = { deletado: 'N' };
  if (data) {
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

    const { email, password } = req.query;
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
  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Não encontrado' });

    const wasConcluido = ag.status === 'concluido';
    if (wasConcluido) {
      await adjustStock(ag, 'restore');
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

      console.log("[DEBUG UPDATE AGEND] Comparison results:");
      console.log(`- sameCliente: ${sameCliente} (tempDoc: ${tempDoc.cliente_id}, ag: ${ag.cliente_id})`);
      console.log(`- sameDataHora: ${sameDataHora} (tempDoc: ${new Date(tempDoc.data_hora).toISOString()}, ag: ${new Date(ag.data_hora).toISOString()})`);
      console.log(`- sameObservacoes: ${sameObservacoes} (tempDoc: '${tempDoc.observacoes || ""}', ag: '${ag.observacoes || ""}')`);
      console.log(`- sameItens: ${sameItens}`);

      if (!sameCliente || !sameDataHora || !sameObservacoes || !sameItens) {
        isOnlyInsumos = false;
      }
    }

    if (ag.status === 'concluido' && !isOnlyInsumos) {
      const email = req.query.email || req.body.auth_email;
      const password = req.query.password || req.body.auth_password;
      if (!email || !password) {
        return res.status(400).json({ detail: 'Para alterar um agendamento concluído, é necessária a autorização de um administrador (usuário e senha).' });
      }
      const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' } });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      if (!authUser.pode_alterar_concluido) {
        return res.status(403).json({ detail: 'Este usuário não possui permissão para alterar agendamentos concluídos.' });
      }
    }

    const doc = await buildAgendamentoDoc(req.body, req.params.aid);
    // Remove status and valor_pago from update to prevent manual overrides
    delete doc.status;
    delete doc.valor_pago;

    await ag.update(doc);

    if (wasConcluido) {
      const updatedAg = await getAgendamentoModel().findByPk(req.params.aid);
      await adjustStock(updatedAg, 'deduct');
    }

    // Update scheduled WhatsApp reminders (handles rescheduling)
    await generateReminders(ag);

    res.json(ag);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

const deleteAgend = async (req, res) => {
  try {
    if (!req.user || !req.user.pode_excluir_agendamento) {
      return res.status(403).json({ detail: 'Você não tem permissão para excluir agendamentos.' });
    }

    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (ag) {
      // Validar pagamentos vinculados
      const countPagamentos = await getPagamentoModel().count({
        where: {
          agendamento_id: req.params.aid,
          deletado: 'N'
        }
      });

      if (countPagamentos > 0) {
        console.warn(`[AUDIT] Tentativa de exclusão de agendamento bloqueada: O agendamento ID ${req.params.aid} possui pagamentos ativos.`);
        return res.status(400).json({ detail: "Não é permitido excluir registros que possuem pagamentos vinculados." });
      }

      if (ag.status === 'concluido') {
        await adjustStock(ag, 'restore');
      }
      await ag.update({
        deletado: 'S',
        deletado_por: req.user ? req.user.name : 'Sistema',
        deletado_em: new Date()
      });
      await getPagamentoModel().update(
        {
          deletado: 'S',
          deletado_por: req.user ? req.user.name : 'Sistema',
          deletado_em: new Date()
        },
        {
          where: { agendamento_id: req.params.aid }
        }
      );

      // Cancel any pending reminders
      await cancelReminders(req.params.aid);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const setStatus = async (req, res) => {
  const { status } = req.body;
  const valid = ['agendado', 'confirmado', 'em_andamento', 'concluido', 'cancelado'];
  if (!valid.includes(status)) return res.status(400).json({ detail: 'Status inválido' });

  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Não encontrado' });

    if (status === 'concluido') {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      const pagamentos = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
      const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
      if (totalPago < ag.valor_total - 0.01) {
        return res.status(400).json({ detail: 'Registre o pagamento total antes de finalizar' });
      }
    }

    const oldStatus = ag.status;
    if (oldStatus !== status) {
      if (status === 'concluido') {
        await adjustStock(ag, 'deduct');
      } else if (oldStatus === 'concluido') {
        await adjustStock(ag, 'restore');
      }
    }

    ag.status = status;
    await ag.save();

    // WhatsApp Reminders hooks
    if (status === 'cancelado') {
      await cancelReminders(ag.id);
    } else if (status === 'agendado' || status === 'confirmado') {
      await generateReminders(ag);
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const addPagamentos = async (req, res) => {
  const { pagamentos, finalizar } = req.body;

  try {
    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Agendamento não encontrado' });

    const existingPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
    const pagoAtual = existingPags.reduce((acc, p) => acc + p.valor, 0);
    const novoValor = pagamentos.reduce((acc, p) => acc + p.valor, 0);
    let adjustedPagamentos = [...pagamentos];
    let novoTotal = pagoAtual + novoValor;

    if (novoTotal > ag.valor_total + 0.01) {
      let excesso = novoTotal - ag.valor_total;
      let idxDinheiro = adjustedPagamentos.findIndex(p => p.forma_pagamento === 'dinheiro');
      if (idxDinheiro !== -1 && adjustedPagamentos[idxDinheiro].valor >= excesso) {
        adjustedPagamentos[idxDinheiro].valor -= excesso;
        adjustedPagamentos[idxDinheiro].observacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (adjustedPagamentos[idxDinheiro].observacao ? ` - ${adjustedPagamentos[idxDinheiro].observacao}` : '');
        novoTotal = ag.valor_total;
      } else {
        return res.status(400).json({ detail: 'Valor excede o total devido' });
      }
    }

    for (const p of adjustedPagamentos) {
      await getPagamentoModel().create({
        id: uuidv4(),
        agendamento_id: req.params.aid,
        valor: p.valor,
        forma_pagamento: p.forma_pagamento,
        observacao: p.observacao || '',
        data_hora: new Date()
      });
    }

    const oldStatus = ag.status;
    ag.valor_pago = novoTotal;
    if (finalizar && novoTotal >= ag.valor_total - 0.01) {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      ag.status = 'concluido';
    }

    if (oldStatus !== ag.status) {
      if (ag.status === 'concluido') {
        await adjustStock(ag, 'deduct');
      } else if (oldStatus === 'concluido') {
        await adjustStock(ag, 'restore');
      }
    }
    await ag.save();

    res.json({ ok: true, total_pago: novoTotal, saldo: ag.valor_total - novoTotal });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updatePagamento = async (req, res) => {
  const { valor, forma_pagamento, observacao } = req.body;
  const { password } = req.query;

  try {
    if (!password) {
      return res.status(400).json({ detail: 'Senha é obrigatória' });
    }
    const user = await getUserModel().findByPk(req.user.id);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Senha incorreta' });
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    pagamento.valor = Number(valor || 0);
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = observacao || '';
    await pagamento.save();

    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (ag) {
      const oldStatus = ag.status;
      const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      ag.valor_pago = totalPago;
      if (totalPago >= ag.valor_total - 0.01) {
        ag.status = 'concluido';
      } else {
        ag.status = 'agendado';
      }

      if (oldStatus !== ag.status) {
        if (ag.status === 'concluido') {
          await adjustStock(ag, 'deduct');
        } else if (oldStatus === 'concluido') {
          await adjustStock(ag, 'restore');
        }
      }
      await ag.save();
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deletePagamento = async (req, res) => {
  const { email, password } = req.query;

  try {
    if (!email || !password) {
      return res.status(400).json({ detail: 'Usuário e senha são obrigatórios' });
    }
    const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim() } });
    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
    }
    if (!authUser.pode_excluir_pagamento) {
      return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    await pagamento.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });

    const ag = await getAgendamentoModel().findByPk(req.params.aid);
    if (ag) {
      const oldStatus = ag.status;
      const allPags = await getPagamentoModel().findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      ag.valor_pago = totalPago;
      if (totalPago >= ag.valor_total - 0.01) {
        ag.status = 'concluido';
      } else {
        ag.status = 'agendado';
      }

      if (oldStatus !== ag.status) {
        if (ag.status === 'concluido') {
          await adjustStock(ag, 'deduct');
        } else if (oldStatus === 'concluido') {
          await adjustStock(ag, 'restore');
        }
      }
      await ag.save();
    }

    res.json({ ok: true });
  } catch (error) {
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
