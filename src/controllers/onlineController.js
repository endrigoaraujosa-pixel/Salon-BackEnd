import { Op } from 'sequelize';
import { getServicoModel } from '../models/Servico.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getCategoriaModel } from '../models/Categoria.js';
import { getAgendamentoOnlineDisponibilidadeModel } from '../models/AgendamentoOnlineDisponibilidade.js';
import { getAgendamentoOnlineSolicitacaoModel } from '../models/AgendamentoOnlineSolicitacao.js';
import { getClienteModel } from '../models/Cliente.js';
import { getAgendamentoOnlineAuthModel } from '../models/AgendamentoOnlineAuth.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';
import { getColaboradorIndisponibilidadeModel } from '../models/ColaboradorIndisponibilidade.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../modules/whatsapp/whatsapp.service.js';
import whatsappProvider from '../modules/whatsapp/provider/whatsapp.provider.js';
import { normalizeAgendaDateTime, buildAgendaDayRange } from '../utils/agendaDateTime.js';
import { findClienteByTelefone } from '../utils/clienteUtils.js';

// ---- Middleware: verificar se agendamento online está ativo ----
const checkOnlineAtivo = async () => {
  const Config = getConfiguracaoSistemaModel();
  const config = await Config.findOne().catch(() => null);
  if (config && config.agendamento_online_ativo === false) {
    throw new Error('Agendamento Online desabilitado.');
  }
};

export const getOnlineConfig = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const Config = getConfiguracaoSistemaModel();
    const config = await Config.findOne().catch(() => null);
    res.json({
      agendamento_online_ativo: config ? config.agendamento_online_ativo !== false : true,
      ocultar_valores_online: config ? Boolean(config.ocultar_valores_online) : false
    });
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

// ---- Helpers ----
const timeToMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

const minutesToTime = (m) => {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
};

/**
 * Verifica se um slot de (dataHoraISO + duraçãoMin) conflita com agendamentos reais
 * e indisponibilidades de um colaborador específico (ou qualquer, se sem colabId).
 */
const slotConflicts = async (dataISO, duraMin, colaboradorId) => {
  const inicio = normalizeAgendaDateTime(dataISO);
  const fim = new Date(inicio.getTime() + duraMin * 60000);

  // Verificar agendamentos existentes
  const Agendamento = getAgendamentoModel();  
  
  const agendamentosProximos = await Agendamento.findAll({
    where: {
      status: { [Op.notIn]: ['cancelado'] },
      data_hora: { [Op.between]: [
        new Date(inicio.getTime() - 12 * 3600000),
        new Date(inicio.getTime() + 12 * 3600000)
      ]}
    },  
  });

  for (const ag of agendamentosProximos) {
    const agStart = new Date(ag.data_hora);
    // calcular duração total dos itens
    const Servico = getServicoModel();
    let agDur = 0;
    for (const item of (ag.itens || [])) {
      const s = await Servico.findByPk(item.servico_id).catch(() => null);
      agDur += s?.duracao_minutos || 0;
    }
    const agEnd = new Date(agStart.getTime() + agDur * 60000);
    
    // Verificar sobreposição apenas se mesma colaborador
    if (colaboradorId) {
      const colabMatch = (ag.itens || []).some(i =>
        i.colaborador_id === colaboradorId || i.auxiliar_id === colaboradorId
      );
      if (!colabMatch) continue;
    }

    if (inicio < agEnd && fim > agStart) return true;
  }

  // Verificar indisponibilidades
  if (colaboradorId) {
    const Indisp = getColaboradorIndisponibilidadeModel();
    const indisps = await Indisp.findAll({
      where: {
        colaborador_id: colaboradorId,
        deletado: 'N',
        data_hora_inicio: { [Op.lt]: fim },
        data_hora_fim: { [Op.gt]: inicio }
      }
    });
    if (indisps.length > 0) return true;
  }

  // Verificar solicitações de agendamento online ativas (pendentes ou reservadas válidas)
  const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
  const agora = new Date();
  const solicitacoesAtivas = await Solicitacao.findAll({
    where: {
      [Op.or]: [
        { status: 'pendente' },
        {
          status: 'reservado',
          data_expiracao_reserva: { [Op.gt]: agora }
        }
      ]
    }
  });

  for (const sol of solicitacoesAtivas) {
    const solStart = new Date(sol.data_hora_desejada);
    const Servico = getServicoModel();
    let solDur = 0;
    let servicosList = [];
    try {
      servicosList = typeof sol.servicos === 'string' ? JSON.parse(sol.servicos) : (sol.servicos || []);
    } catch (e) {
      servicosList = [];
    }
    for (const item of servicosList) {
      const s = await Servico.findByPk(item.servico_id || item.id).catch(() => null);
      solDur += s?.duracao_minutos || 0;
    }
    if (solDur === 0) solDur = 30; // fallback padrão
    const solEnd = new Date(solStart.getTime() + solDur * 60000);

    // Verificar se mesmo colaborador
    if (colaboradorId) {
      const solColabId = sol.profissional_id;
      const colabMatch = (solColabId === colaboradorId) || servicosList.some(i => i.colaborador_id === colaboradorId);
      if (!colabMatch) continue;
    }

    if (inicio < solEnd && fim > solStart) return true;
  }

  return false;
};


// ============================================================
// ENDPOINTS PÚBLICOS
// ============================================================

export const getServicosOnline = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const Servico = getServicoModel();
    const Categoria = getCategoriaModel();
    const servicos = await Servico.findAll({
      where: { ativo: true, deletado: 'N', disponivel_online: true },
      attributes: ['id', 'nome', 'duracao_minutos', 'valor', 'descricao', 'categoria_id'],
    });

    // Enriquecer com nome da categoria
    const Categorias = await Categoria.findAll({ attributes: ['id', 'nome'] });
    const catMap = {};
    Categorias.forEach(c => { catMap[c.id] = c.nome; });

    const result = servicos.map(s => ({
      ...s.toJSON(),
      categoria_nome: catMap[s.categoria_id] || null,
    }));

    res.json(result);
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

export const getCategoriasOnline = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const Categoria = getCategoriaModel();
    // Filtrar apenas categorias que têm serviços online
    const Servico = getServicoModel();
    const servicos = await Servico.findAll({
      where: { ativo: true, deletado: 'N', disponivel_online: true },
      attributes: ['categoria_id']
    });
    const catIds = [...new Set(servicos.map(s => s.categoria_id).filter(Boolean))];
    const cats = await Categoria.findAll({
      where: { id: { [Op.in]: catIds } },
      attributes: ['id', 'nome']
    });
    res.json(cats);
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

export const getProfissionaisOnline = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const Colaborador = getColaboradorModel();
    const { getColaboradorComissaoServicoModel } = await import('../models/ColaboradorComissaoServico.js');
    const ColabServico = getColaboradorComissaoServicoModel();
    const { getColaboradorOnlineDisponibilidadeModel } = await import('../models/ColaboradorOnlineDisponibilidade.js');
    const ColabDisp = getColaboradorOnlineDisponibilidadeModel();

    // Parâmetros opcionais vindos do query string
    const servicosParam = req.query.servicos; // string csv ou array
    const dataParam = req.query.data; // YYYY-MM-DD

    // 1. Buscar todos os colaboradores ativos e habilitados para o agendamento online
    let profissionais = await Colaborador.findAll({
      where: { ativo: true, deletado: 'N', agendamento_online_ativo: true },
      attributes: ['id', 'nome', 'foto', 'cargo']
    });

    // 2. Filtrar por serviços selecionados (se informados)
    if (servicosParam) {
      const servicoIds = Array.isArray(servicosParam)
        ? servicosParam
        : servicosParam.split(',').map(s => s.trim()).filter(Boolean);

      if (servicoIds.length > 0) {
        // Para cada colaborador, verificar se ele realiza TODOS os serviços selecionados no online
        const filtrados = [];
        for (const prof of profissionais) {
          const vinculos = await ColabServico.findAll({
            where: {
              colaborador_id: prof.id,
              servico_id: { [Op.in]: servicoIds },
              agendamento_online_ativo: true
            }
          });
          // O colaborador deve ter o vínculo ativo para todos os serviços requisitados
          if (vinculos.length >= servicoIds.length) {
            filtrados.push(prof);
          }
        }
        profissionais = filtrados;
      }
    }

    // 3. Filtrar por data (se informada) — excluir colaboradores com dia fechado ou indisponibilidade
    if (dataParam) {
      const [year, month, day] = dataParam.split('-').map(Number);
      const dateObj = new Date(year, month - 1, day);
      const diaSemana = dateObj.getDay();

      // Limites do dia em UTC para comparar indisponibilidades
      const { start: diaInicio, end: diaFim } = buildAgendaDayRange(dataParam);

      const Indisp = getColaboradorIndisponibilidadeModel();

      const filtrados = [];
      for (const prof of profissionais) {
        // Verificar se o colaborador tem horário configurado para esse dia da semana
        const dispColab = await ColabDisp.findOne({
          where: { colaborador_id: prof.id, dia_semana: diaSemana, ativo: true }
        });

        // Se o colaborador tem registros de disponibilidade online mas nenhum ativo para esse dia, exclui
        const totalDispColab = await ColabDisp.count({ where: { colaborador_id: prof.id } });
        if (totalDispColab > 0 && !dispColab) {
          continue; // Colaborador configurou horários mas está fechado nesse dia
        }

        // Verificar indisponibilidades de dia inteiro (cobrindo o dia todo)
        const indispDiaInteiro = await Indisp.findAll({
          where: {
            colaborador_id: prof.id,
            deletado: 'N',
            data_hora_inicio: { [Op.lte]: diaInicio },
            data_hora_fim: { [Op.gte]: diaFim }
          }
        });
        if (indispDiaInteiro.length > 0) {
          continue; // Colaborador indisponível o dia inteiro
        }

        filtrados.push(prof);
      }
      profissionais = filtrados;
    }

    res.json(profissionais);
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

export const getDisponibilidadeOnline = async (req, res) => {
  try {
    await checkOnlineAtivo();

    // GET/POST params: data=YYYY-MM-DD, servicos=id1, profissional_id=xxx
    const data = req.query.data || req.body?.data;
    const servicosParam = req.query.servicos || req.body?.servicos;
    const profissional_id = req.query.profissional_id || req.body?.profissional_id;

    if (!data) return res.status(400).json({ detail: 'Parâmetro "data" é obrigatório.' });
    if (!servicosParam) return res.status(400).json({ detail: 'Parâmetro "servicos" é obrigatório.' });

    const servicoIds = Array.isArray(servicosParam) ? servicosParam : [servicosParam];

    // Calcular duração total dos serviços selecionados
    const Servico = getServicoModel();
    let duracaoTotal = 0;
    for (const sid of servicoIds) {
      const s = await Servico.findByPk(sid).catch(() => null);
      duracaoTotal += s?.duracao_minutos || 0;
    }
    if (duracaoTotal === 0) return res.status(400).json({ detail: 'Serviços não encontrados.' });

    // Obter regra de disponibilidade GERAL do salão para o dia da semana
    const [year, month, day] = data.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const diaSemana = dateObj.getDay(); // 0 = Dom

    const Disponibilidade = getAgendamentoOnlineDisponibilidadeModel();
    const regraSalao = await Disponibilidade.findOne({
      where: { dia_semana: diaSemana, ativo: true }
    });

    if (!regraSalao) {
      return res.json({ horarios: [] }); // Dia fechado no salão
    }

    const { getColaboradorOnlineDisponibilidadeModel } = await import('../models/ColaboradorOnlineDisponibilidade.js');
    const ColabDisp = getColaboradorOnlineDisponibilidadeModel();
    const { getColaboradorComissaoServicoModel } = await import('../models/ColaboradorComissaoServico.js');
    const ColabServico = getColaboradorComissaoServicoModel();
    const Colaborador = getColaboradorModel();
    const Indisp = getColaboradorIndisponibilidadeModel();

    const INTERVALO = 30; // minutos entre slots
    const now = new Date();

    // === CASO 1: Profissional específico selecionado ===
    if (profissional_id) {
      // Verificar se o profissional participa do agendamento online
      const prof = await Colaborador.findByPk(profissional_id);
      if (!prof || prof.agendamento_online_ativo === false) {
        return res.json({ horarios: [] });
      }

      // Obter a grade de atendimento individual do profissional para esse dia
      const dispColab = await ColabDisp.findOne({
        where: { colaborador_id: profissional_id, dia_semana: diaSemana, ativo: true }
      });

      // Se o colaborador tem registros de disponibilidade configurados mas nenhum ativo para esse dia = fechado
      const totalDispColab = await ColabDisp.count({ where: { colaborador_id: profissional_id } });
      if (totalDispColab > 0 && !dispColab) {
        return res.json({ horarios: [] }); // Dia de folga do profissional
      }

      // Usar a grade individual se existir, senão fallback para a grade geral do salão
      const horaInicio = dispColab ? dispColab.hora_inicio : regraSalao.hora_inicio;
      const horaFim = dispColab ? dispColab.hora_fim : regraSalao.hora_fim;

      const inicioMin = timeToMinutes(horaInicio);
      const fimMin = timeToMinutes(horaFim);

      const slots = [];
      for (let t = inicioMin; t + duracaoTotal <= fimMin; t += INTERVALO) {
        const horaSlot = minutesToTime(t);
        const dataHoraISO = `${data}T${horaSlot}:00`;

        // Desconsiderar horários que já passaram
        const slotDate = normalizeAgendaDateTime(dataHoraISO);
        if (slotDate <= now) continue;

        // Verificar conflitos (agendamentos, solicitações pendentes e indisponibilidades)
        const conflito = await slotConflicts(dataHoraISO, duracaoTotal, profissional_id);
        if (!conflito) {
          slots.push(horaSlot);
        }
      }

      return res.json({ horarios: slots });
    }

    // === CASO 2: "Qualquer Profissional" (profissional_id nulo) ===
    // Identificar todos os colaboradores habilitados para os serviços selecionados e ativos no online
    const todosColabs = await Colaborador.findAll({
      where: { ativo: true, deletado: 'N', agendamento_online_ativo: true },
      attributes: ['id']
    });

    // Filtrar por serviços: o colaborador deve ter o vínculo online ativo para todos os serviços requisitados
    const colabsHabilitados = [];
    for (const colab of todosColabs) {
      const vinculos = await ColabServico.findAll({
        where: {
          colaborador_id: colab.id,
          servico_id: { [Op.in]: servicoIds },
          agendamento_online_ativo: true
        }
      });
      if (vinculos.length >= servicoIds.length) {
        colabsHabilitados.push(colab.id);
      }
    }

    if (colabsHabilitados.length === 0) {
      return res.json({ horarios: [] }); // Nenhum profissional habilitado para esses serviços
    }

    // Usar os limites do salão para gerar os slots
    const inicioSalaoMin = timeToMinutes(regraSalao.hora_inicio);
    const fimSalaoMin = timeToMinutes(regraSalao.hora_fim);

    const slots = [];
    for (let t = inicioSalaoMin; t + duracaoTotal <= fimSalaoMin; t += INTERVALO) {
      const horaSlot = minutesToTime(t);
      const dataHoraISO = `${data}T${horaSlot}:00`;

      // Desconsiderar horários que já passaram
      const slotDate = normalizeAgendaDateTime(dataHoraISO);
      if (slotDate <= now) continue;

      // Verificar se há pelo menos UM colaborador habilitado e livre nesse slot
      let slotDisponivel = false;
      for (const colabId of colabsHabilitados) {
        // Verificar se o horário do slot está dentro da grade individual do colaborador
        const dispColab = await ColabDisp.findOne({
          where: { colaborador_id: colabId, dia_semana: diaSemana, ativo: true }
        });
        const totalDispColab = await ColabDisp.count({ where: { colaborador_id: colabId } });

        let colabInicioMin, colabFimMin;
        if (totalDispColab > 0) {
          if (!dispColab) continue; // Colaborador fechado nesse dia
          colabInicioMin = timeToMinutes(dispColab.hora_inicio);
          colabFimMin = timeToMinutes(dispColab.hora_fim);
        } else {
          // Fallback: grade geral do salão
          colabInicioMin = inicioSalaoMin;
          colabFimMin = fimSalaoMin;
        }

        // Verificar se o slot cabe na grade desse colaborador
        if (t < colabInicioMin || t + duracaoTotal > colabFimMin) continue;

        // Verificar conflitos de agenda e indisponibilidade para esse colaborador
        const conflito = await slotConflicts(dataHoraISO, duracaoTotal, colabId);
        if (!conflito) {
          slotDisponivel = true;
          break; // Pelo menos um profissional disponível é suficiente
        }
      }

      if (slotDisponivel) {
        slots.push(horaSlot);
      }
    }

    res.json({ horarios: slots });
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

export const solicitarAgendamento = async (req, res) => {
  try {
    await checkOnlineAtivo();

    const { cliente_nome, telefone, data_hora, servicos, profissional_id, observacoes, solicitacaoId } = req.body;

    if (!cliente_nome || !telefone || !data_hora || !servicos || servicos.length === 0) {
      return res.status(400).json({ detail: 'Campos obrigatórios: cliente_nome, telefone, data_hora, servicos.' });
    }

    // Buscar cliente existente pelo telefone como identificador principal
    let cliente = await findClienteByTelefone(telefone);
    let clienteId = cliente?.id || null;

    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();

    let solicitacao = null;
    if (solicitacaoId) {
      solicitacao = await Solicitacao.findByPk(solicitacaoId);
    }

    const parsedServicos = typeof servicos === 'string' ? JSON.parse(servicos) : servicos;
    const dataToSave = {
      cliente_id: clienteId,
      nome_cliente: cliente_nome,
      telefone,
      data_hora_desejada: normalizeAgendaDateTime(data_hora),
      servicos: parsedServicos,
      profissional_id: profissional_id || null,
      observacoes: observacoes || '',
      status: 'pendente',
      data_expiracao_reserva: null
    };

    if (solicitacao) {
      await solicitacao.update(dataToSave);
    } else {
      await Solicitacao.create({
        id: uuidv4(),
        ...dataToSave
      });
    }

    // Enviar mensagem de recepção via WhatsApp
    try {
      const waConfig = await getConfig();
      if (waConfig && waConfig.ativo) {
        const dataFmt = new Date(dataToSave.data_hora_desejada).toLocaleString('pt-BR', { timeZone: 'America/Recife' });
        await whatsappProvider.sendMessage(
          telefone, 
          `Olá, ${cliente_nome}! Recebemos sua solicitação de agendamento para o dia ${dataFmt}. Assim que o salão confirmar, enviaremos outra mensagem por aqui!`, 
          waConfig
        );
      }
    } catch (waErr) {
      console.error('Erro ao enviar mensagem WhatsApp de recepção:', waErr);
    }

    res.json({ ok: true, message: 'Solicitação recebida com sucesso! Aguarde a confirmação do salão.' });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const requestCode = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const { telefone } = req.body;
    if (!telefone) {
      return res.status(400).json({ detail: 'Telefone é obrigatório.' });
    }

    const phoneDigits = telefone.replace(/\D/g, '');
    if (!phoneDigits) {
      return res.status(400).json({ detail: 'Telefone inválido.' });
    }

    const waConfig = await getConfig();
    const isWaAtivo = Boolean(waConfig && (waConfig.ativo === true || waConfig.ativo === 1 || waConfig.ativo === '1'));

    if (!isWaAtivo) {
      return res.json({
        ok: true,
        requiresVerification: false,
        message: 'Verificação de WhatsApp dispensada.'
      });
    }

    const AuthModel = getAgendamentoOnlineAuthModel();

    // Rate Limit: máximo 3 solicitações de código nos últimos 10 minutos
    const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000);
    const enviosRecentes = await AuthModel.count({
      where: {
        telefone: phoneDigits,
        criado_em: {
          [Op.gt]: dezMinutosAtras
        }
      }
    });

    if (enviosRecentes >= 3) {
      return res.status(429).json({ 
        detail: 'Limite de envio de códigos excedido. Tente novamente em alguns minutos.' 
      });
    }

    const codigo_otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expira_em = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos
    await AuthModel.create({
      id: uuidv4(),
      telefone: phoneDigits,
      codigo_otp,
      expira_em,
      tentativas: 0,
      validado: false,
    });

    // LOG DE DEBUG PARA AMBIENTE DE TESTE LOCAL:
    console.log('\n======================================================');
    console.log(`[TESTE] CÓDIGO OTP GERADO PARA TELEFONE ${phoneDigits}: ${codigo_otp}`);
    console.log('======================================================\n');

    // Enviar código por WhatsApp se ativo
    if (isWaAtivo) {
      try {
        const sendResult = await whatsappProvider.sendMessage(
          phoneDigits,
          `Seu código de verificação para o agendamento online é: ${codigo_otp}. Ele expira em 10 minutos.`,
          waConfig
        );

        if (sendResult && sendResult.success === false) {
          console.error('[requestCode] Erro ao enviar OTP via WhatsApp:', sendResult.error);
          return res.status(400).json({ 
            detail: sendResult.error || 'Falha ao enviar o código de verificação pelo WhatsApp. Verifique o número informado.' 
          });
        }
      } catch (waErr) {
        console.error('[requestCode] Erro inesperado ao enviar OTP via WhatsApp:', waErr);
        return res.status(500).json({ detail: 'Falha ao enviar o código de verificação pelo WhatsApp. Tente novamente.' });
      }
    }

    res.json({
      ok: true,
      requiresVerification: true,
      message: 'Código de validação enviado com sucesso.',
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const validateCode = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const { telefone, codigo_otp } = req.body;
    if (!telefone || !codigo_otp) {
      return res.status(400).json({ detail: 'Telefone e código são obrigatórios.' });
    }

    const phoneDigits = telefone.replace(/\D/g, '');
    const AuthModel = getAgendamentoOnlineAuthModel();

    const authRecord = await AuthModel.findOne({
      where: {
        telefone: phoneDigits,
        codigo_otp: String(codigo_otp).trim(),
        validado: false,
        expira_em: { [Op.gt]: new Date() }
      },
      order: [['criado_em', 'DESC']]
    });

    if (!authRecord) {
      return res.status(400).json({ detail: 'Código inválido ou expirado.' });
    }

    authRecord.validado = true;
    await authRecord.save();

    const cliente = await findClienteByTelefone(telefone);

    res.json({
      valid: true,
      cliente: cliente ? { id: cliente.id, nome: cliente.nome, telefone: cliente.telefone, email: cliente.email } : null
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const registrarCliente = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const { nome, telefone, email, cpf, data_nascimento } = req.body;

    if (!nome || !telefone) {
      return res.status(400).json({ detail: 'Nome e telefone são obrigatórios.' });
    }

    let cliente = await findClienteByTelefone(telefone);
    const Cliente = getClienteModel();

    if (cliente) {
      if (nome) cliente.nome = nome;
      if (email) cliente.email = email;
      if (cpf) cliente.cpf = cpf;
      if (data_nascimento) cliente.data_nascimento = data_nascimento;
      await cliente.save();
    } else {
      cliente = await Cliente.create({
        id: uuidv4(),
        nome,
        telefone,
        email: email || null,
        cpf: cpf || null,
        data_nascimento: data_nascimento || null,
        deletado: 'N'
      });
    }

    res.json({
      ok: true,
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        telefone: cliente.telefone,
        email: cliente.email
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const reservarHorario = async (req, res) => {
  try {
    await checkOnlineAtivo();

    const { data_hora, servicos, profissional_id } = req.body;

    if (!data_hora || !servicos || servicos.length === 0) {
      return res.status(400).json({ detail: 'Campos obrigatórios: data_hora, servicos.' });
    }

    const servicoIds = Array.isArray(servicos) ? servicos : [servicos];

    // Calcular duração total dos serviços
    const Servico = getServicoModel();
    let duracaoTotal = 0;
    for (const sid of servicoIds) {
      const s = await Servico.findByPk(sid).catch(() => null);
      duracaoTotal += s?.duracao_minutos || 0;
    }
    if (duracaoTotal === 0) return res.status(400).json({ detail: 'Serviços não encontrados.' });

    // Verificar se ainda está livre de conflitos
    const conflito = await slotConflicts(data_hora, duracaoTotal, profissional_id || null);
    if (conflito) {
      return res.status(400).json({ detail: 'Este horário já não está mais disponível.' });
    }

    // Criar a reserva temporária por 5 minutos
    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
    const id = uuidv4();
    const data_expiracao_reserva = new Date(Date.now() + 5 * 60000); // 5 minutos de validade

    await Solicitacao.create({
      id,
      cliente_id: null,
      nome_cliente: 'Reserva Temporária',
      telefone: '00000000000',
      data_hora_desejada: normalizeAgendaDateTime(data_hora),
      servicos: servicoIds.map(id => ({ servico_id: id })),
      profissional_id: profissional_id || null,
      observacoes: '',
      status: 'reservado',
      data_expiracao_reserva
    });

    res.json({ ok: true, solicitacaoId: id });
  } catch (error) {
    if (error.message === 'Agendamento Online desabilitado.') {
      return res.status(403).json({ detail: error.message });
    }
    res.status(500).json({ detail: error.message });
  }
};

