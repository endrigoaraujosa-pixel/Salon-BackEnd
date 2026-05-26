import Agendamento from '../models/Agendamento.js';
import Cliente from '../models/Cliente.js';
import Servico from '../models/Servico.js';
import Colaborador from '../models/Colaborador.js';
import Pagamento from '../models/Pagamento.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import Produto from '../models/Produto.js';

const adjustStock = async (ag, type) => {
  try {
    for (const item of ag.itens || []) {
      const utilized = item.produtos_utilizados || [];
      for (const pu of utilized) {
        const prod = await Produto.findByPk(pu.produto_id);
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
  const cliente = await Cliente.findByPk(body.cliente_id);
  if (!cliente) throw new Error('Cliente inválido');

  let itens = [];
  let valorTotal = 0;
  let duracaoTotal = 0;
  let profsMap = new Map();

  for (const item of body.itens_selecionados) {
    const s = await Servico.findByPk(item.servico_id);
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
            const prod = await Produto.findByPk(pu.produto_id);
            custoUnitario = prod ? Number(prod.custo_unitario || 0) : 0;
          }
          let prodNome = pu.produto_nome || pu.produto_name || "";
          if (!prodNome && pu.produto_id) {
            const prod = await Produto.findByPk(pu.produto_id);
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
        const p = await Colaborador.findByPk(item.colaborador_id);
        if (p) profsMap.set(p.id, { id: p.id, nome: p.nome, tipo: 'principal' });
      }
      if (item.auxiliar_id) {
        const p = await Colaborador.findByPk(item.auxiliar_id);
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

  const existentes = await Agendamento.findAll({ where });

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
            const profConflito = (await Colaborador.findByPk(idsVerificar.find(id => profsNoExistente.includes(id))))?.nome;
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

const listAgend = async (req, res) => {
  const { data, mes } = req.query;
  const where = { deletado: 'N' };
  if (data) {
    where.data_hora = { [Op.between]: [`${data}T00:00:00`, `${data}T23:59:59`] };
  } else if (mes) {
    where.data_hora = { [Op.between]: [`${mes}-01T00:00:00`, `${mes}-31T23:59:59`] };
  }

  try {
    let colabId = null;
    if (req.user && req.user.role === 'funcionario') {
      const colab = await Colaborador.findOne({
        where: { nome: req.user.name, deletado: 'N' }
      });
      if (colab) {
        colabId = colab.id;
      }
    }

    const agends = await Agendamento.findAll({
      where,
      order: [['data_hora', 'ASC']],
      limit: 2000
    });

    if (colabId) {
      const filtered = agends.filter(ag => {
        let itens = [];
        try {
          itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
        } catch (e) {
          itens = ag.itens || [];
        }
        return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
      });
      return res.json(filtered);
    }

    res.json(agends);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getAgend = async (req, res) => {
  try {
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag || ag.deletado === 'S') return res.status(404).json({ detail: 'Não encontrado' });

    const { email, password } = req.query;
    if (email && password) {
      const authUser = await User.findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' } });
      if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
        return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
      }
      if (!authUser.pode_alterar_concluido) {
        return res.status(403).json({ detail: 'Este usuário não possui permissão para alterar agendamentos concluídos.' });
      }
    }

    const pagamentos = await Pagamento.findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
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
    const maxNum = await Agendamento.max('numero') || 0;
    const ag = await Agendamento.create({
      ...doc,
      id: uuidv4(),
      numero: maxNum + 1
    });
    res.status(201).json(ag);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

const updateAgend = async (req, res) => {
  try {
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Não encontrado' });

    const wasConcluido = ag.status === 'concluido';
    if (wasConcluido) {
      await adjustStock(ag, 'restore');
    }

    if (ag.status === 'concluido') {
      const email = req.query.email || req.body.auth_email;
      const password = req.query.password || req.body.auth_password;
      if (!email || !password) {
        return res.status(400).json({ detail: 'Para alterar um agendamento concluído, é necessária a autorização de um administrador (usuário e senha).' });
      }
      const authUser = await User.findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' } });
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
      const updatedAg = await Agendamento.findByPk(req.params.aid);
      await adjustStock(updatedAg, 'deduct');
    }

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

    const ag = await Agendamento.findByPk(req.params.aid);
    if (ag) {
      // Validar pagamentos vinculados
      const countPagamentos = await Pagamento.count({
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
      await Pagamento.update(
        {
          deletado: 'S',
          deletado_por: req.user ? req.user.name : 'Sistema',
          deletado_em: new Date()
        },
        {
          where: { agendamento_id: req.params.aid }
        }
      );
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
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Não encontrado' });

    if (status === 'concluido') {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      const pagamentos = await Pagamento.findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
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
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const addPagamentos = async (req, res) => {
  const { pagamentos, finalizar } = req.body;

  try {
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Agendamento não encontrado' });

    const existingPags = await Pagamento.findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
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
      await Pagamento.create({
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
    const user = await User.findByPk(req.user.id);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Senha incorreta' });
    }

    const pagamento = await Pagamento.findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    pagamento.valor = Number(valor || 0);
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = observacao || '';
    await pagamento.save();

    const ag = await Agendamento.findByPk(req.params.aid);
    if (ag) {
      const oldStatus = ag.status;
      const allPags = await Pagamento.findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
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
    const authUser = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
    }
    if (!authUser.pode_excluir_pagamento) {
      return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
    }

    const pagamento = await Pagamento.findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    await pagamento.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });

    const ag = await Agendamento.findByPk(req.params.aid);
    if (ag) {
      const oldStatus = ag.status;
      const allPags = await Pagamento.findAll({ where: { agendamento_id: req.params.aid, deletado: 'N' } });
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
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag || ag.deletado === 'S') return res.status(404).json({ detail: 'Não encontrado' });

    const { observacoes } = req.body;
    ag.observacoes = observacoes || '';
    await ag.save();

    res.json({ ok: true, observacoes: ag.observacoes });
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
  patchObservacoes
};
