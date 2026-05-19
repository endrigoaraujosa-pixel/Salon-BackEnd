import Agendamento from '../models/Agendamento.js';
import Cliente from '../models/Cliente.js';
import Servico from '../models/Servico.js';
import Colaborador from '../models/Colaborador.js';
import Pagamento from '../models/Pagamento.js';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

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
      itens.push({ 
        servico_id: item.servico_id, 
        nome: s.nome, 
        valor: s.valor, 
        duracao: s.duracao_minutos,
        colaborador_id: item.colaborador_id || null,
        auxiliar_id: item.auxiliar_id || null
      });
      valorTotal += s.valor;
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

  // Validação de data no passado
  const novoInicio = new Date(body.data_hora);
  const agora = new Date();
  
  // Tolerância de 5 minutos para compensar atrasos no preenchimento
  if (novoInicio < new Date(agora.getTime() - 5 * 60000)) {
    throw new Error('Não é possível realizar agendamentos no passado.');
  }

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
  const where = {};
  if (data) {
    where.data_hora = { [Op.between]: [`${data}T00:00:00`, `${data}T23:59:59`] };
  } else if (mes) {
    // Para o mês, pegamos do dia 01 até o 31 (ou use uma lógica mais precisa se necessário)
    where.data_hora = { [Op.between]: [`${mes}-01T00:00:00`, `${mes}-31T23:59:59`] };
  }

  try {
    const agends = await Agendamento.findAll({
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
    const ag = await Agendamento.findByPk(req.params.aid);
    if (!ag) return res.status(404).json({ detail: 'Não encontrado' });

    const pagamentos = await Pagamento.findAll({ where: { agendamento_id: req.params.aid } });
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
    const ag = await Agendamento.create({
      ...doc,
      id: uuidv4()
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

    const doc = await buildAgendamentoDoc(req.body, req.params.aid);
    // Remove status and valor_pago from update to prevent manual overrides
    delete doc.status;
    delete doc.valor_pago;
    
    await ag.update(doc);
    res.json(ag);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

const deleteAgend = async (req, res) => {
  try {
    const ag = await Agendamento.findByPk(req.params.aid);
    if (ag) {
      await ag.destroy();
      await Pagamento.destroy({ where: { agendamento_id: req.params.aid } });
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
      const pagamentos = await Pagamento.findAll({ where: { agendamento_id: req.params.aid } });
      const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
      if (totalPago < ag.valor_total - 0.01) {
        return res.status(400).json({ detail: 'Registre o pagamento total antes de finalizar' });
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

    const existingPags = await Pagamento.findAll({ where: { agendamento_id: req.params.aid } });
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

    ag.valor_pago = novoTotal;
    if (finalizar && novoTotal >= ag.valor_total - 0.01) {
      for (const item of ag.itens || []) {
        if (!item.colaborador_id || item.colaborador_id === "none") {
          return res.status(400).json({ detail: 'Não é possível concluir o atendimento sem definir o profissional que realizou cada serviço.' });
        }
      }
      ag.status = 'concluido';
    }
    await ag.save();

    res.json({ ok: true, total_pago: novoTotal, saldo: ag.valor_total - novoTotal });
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
  addPagamentos
};
