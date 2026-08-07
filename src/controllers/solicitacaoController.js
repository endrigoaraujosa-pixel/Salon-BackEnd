import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { getAgendamentoOnlineSolicitacaoModel } from '../models/AgendamentoOnlineSolicitacao.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getServicoModel } from '../models/Servico.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getClienteModel } from '../models/Cliente.js';
import { getConfig } from '../modules/whatsapp/whatsapp.service.js';
import whatsappProvider from '../modules/whatsapp/provider/whatsapp.provider.js';
import { sequelize } from '../config/db.js';
import { generateReminders } from '../modules/whatsapp/reminder.service.js';
import { getWhatsappLembreteModel } from '../models/WhatsappLembrete.js';
import { normalizeAgendaDateTime } from '../utils/agendaDateTime.js';
import { findClienteByTelefone } from '../utils/clienteUtils.js';

export const listarSolicitacoes = async (req, res) => {
  try {
    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
    const pendentes = await Solicitacao.findAll({
      where: { status: 'pendente' },
      order: [['criado_em', 'ASC']]
    });

    const parsed = pendentes.map(item => {
      const data = item.toJSON();
      if (typeof data.servicos === 'string') {
        try {
          data.servicos = JSON.parse(data.servicos);
        } catch (e) {
          data.servicos = [];
        }
      }
      return data;
    });

    res.json(parsed);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const executarAprovacaoSolicitacao = async ({ solicitacao, transaction, reqUser }) => {
  // 1. Parse dos serviços da solicitação
  let servicosList = [];
  try {
    servicosList = typeof solicitacao.servicos === 'string' 
      ? JSON.parse(solicitacao.servicos) 
      : (solicitacao.servicos || []);
  } catch (e) {
    servicosList = [];
  }

  // 2. Buscar ou criar o Cliente utilizando o telefone como identificador principal
  const Cliente = getClienteModel();
  let cliente = null;
  if (solicitacao.cliente_id) {
    cliente = await Cliente.findByPk(solicitacao.cliente_id, { transaction });
  }
  if (!cliente && solicitacao.telefone) {
    cliente = await findClienteByTelefone(solicitacao.telefone, { transaction });
  }
  if (!cliente) {
    cliente = await Cliente.create({
      id: uuidv4(),
      nome: solicitacao.nome_cliente,
      telefone: solicitacao.telefone,
      deletado: 'N'
    }, { transaction });
  } else if (solicitacao.nome_cliente && (!cliente.nome || cliente.nome === 'Cliente Sem Nome')) {
    cliente.nome = solicitacao.nome_cliente;
    await cliente.save({ transaction });
  }

  // 3. Processar Itens do Agendamento e Profissionais
  const Servico = getServicoModel();
  const Colaborador = getColaboradorModel();
  const itens = [];
  const profsMap = new Map();
  let valorTotal = 0;

  for (const item of servicosList) {
    const sId = item.servico_id || item.id;
    const s = sId ? await Servico.findByPk(sId, { transaction }) : null;
    const val = Number(s?.valor || item.valor || 0);
    const colabId = item.colaborador_id || solicitacao.profissional_id || null;

    itens.push({
      servico_id: sId || null,
      nome: s?.nome || item.servico_nome || 'Serviço',
      valor: val,
      valor_original: val,
      duracao: s?.duracao_minutos || 30,
      colaborador_id: colabId,
      auxiliar_id: null,
      produtos_utilizados: []
    });
    valorTotal += val;

    if (colabId && !profsMap.has(colabId)) {
      const colab = await Colaborador.findByPk(colabId, { transaction });
      if (colab) {
        profsMap.set(colab.id, { id: colab.id, nome: colab.nome, tipo: 'principal' });
      }
    }
  }

  // 4. Criar Agendamento real na agenda
  const Agendamento = getAgendamentoModel();
  const maxNum = (await Agendamento.max('numero', { transaction })) || 0;

  const agendamentoCreated = await Agendamento.create({
    id: uuidv4(),
    numero: maxNum + 1,
    cliente_id: cliente.id,
    cliente_nome: cliente.nome,
    data_hora: solicitacao.data_hora_desejada,
    observacoes: solicitacao.observacoes ? `Online: ${solicitacao.observacoes}` : 'Agendamento Online',
    status: 'agendado',
    itens,
    profissionais: Array.from(profsMap.values()),
    valor_total: valorTotal,
    valor_pago: 0,
    desconto: 0,
    criado_em: new Date(),
    criado_por_id: reqUser?.id || null,
    criado_por_nome: reqUser?.name || null,
    deletado: 'N'
  }, { transaction });

  // 5. Marcar solicitação como 'aprovado'
  solicitacao.status = 'aprovado';
  await solicitacao.save({ transaction });

  return agendamentoCreated;
};

export const enviarNotificacaoConfirmacaoOnline = async (solicitacao, agendamentoCreated) => {
  // Gerar lembretes de WhatsApp se configurado
  try {
    await generateReminders(agendamentoCreated);
  } catch (remErr) {
    console.error('Erro ao gerar lembretes de WhatsApp na aprovação da solicitação:', remErr);
  }

  // Enviar mensagem de sucesso via WhatsApp e salvar no histórico
  try {
    const waConfig = await getConfig();
    if (waConfig && waConfig.ativo) {
      const dataFmt = new Date(solicitacao.data_hora_desejada).toLocaleString('pt-BR', { timeZone: 'America/Recife' });
      const text = `Seu agendamento para o dia ${dataFmt} foi confirmado!`;

      let status = 'Enviado';
      let erro = null;
      try {
        await whatsappProvider.sendMessage(
          solicitacao.telefone, 
          text, 
          waConfig
        );
      } catch (sendErr) {
        console.error('Erro ao enviar mensagem física:', sendErr);
        status = 'Falhou';
        erro = sendErr.message || 'Erro no envio da mensagem';
      }

      // Salvar no histórico de lembretes
      try {
        const Lembrete = getWhatsappLembreteModel();
        await Lembrete.create({
          agendamento_id: agendamentoCreated.id,
          tipo_lembrete: 'confirmacao_online',
          data_programada: new Date(),
          data_envio: status === 'Enviado' ? new Date() : null,
          status,
          mensagem: text,
          erro,
          tentativas: 1
        });
      } catch (dbErr) {
        console.error('Erro ao gravar histórico do WhatsApp no banco de dados:', dbErr);
      }
    }
  } catch (waErr) {
    console.error('Erro ao enviar mensagem WhatsApp na aprovação:', waErr);
  }
};

export const aprovarSolicitacao = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { data_hora, profissional_id } = req.body;
    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
    
    const solicitacao = await Solicitacao.findByPk(id, { transaction });
    if (!solicitacao || solicitacao.status !== 'pendente') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Solicitação não encontrada ou não está pendente.' });
    }

    if (data_hora) {
      solicitacao.data_hora_desejada = normalizeAgendaDateTime(data_hora);
    }
    if (profissional_id) {
      solicitacao.profissional_id = profissional_id;
    }

    const agendamentoCreated = await executarAprovacaoSolicitacao({
      solicitacao,
      transaction,
      reqUser: req.user
    });

    await transaction.commit();

    await enviarNotificacaoConfirmacaoOnline(solicitacao, agendamentoCreated);

    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

export const rejeitarSolicitacao = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    
    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
    const solicitacao = await Solicitacao.findByPk(id, { transaction });
    
    if (!solicitacao || solicitacao.status !== 'pendente') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Solicitação não encontrada ou não está pendente.' });
    }

    solicitacao.status = 'rejeitado';
    solicitacao.observacoes = (solicitacao.observacoes || '') + `\nRejeitado: ${motivo}`;
    await solicitacao.save({ transaction });

    await transaction.commit();

    // Enviar mensagem
    const waConfig = await getConfig();
    if (waConfig && waConfig.ativo) {
      const dataFmt = new Date(solicitacao.data_hora_desejada).toLocaleString('pt-BR', { timeZone: 'America/Recife' });
      await whatsappProvider.sendMessage(
        solicitacao.telefone, 
        `Infelizmente não pudemos confirmar seu agendamento para o dia ${dataFmt}. Motivo: ${motivo}`, 
        waConfig
      );
    }

    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};
