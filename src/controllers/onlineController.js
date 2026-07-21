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

// ---- Middleware: verificar se agendamento online está ativo ----
const checkOnlineAtivo = async () => {
  const Config = getConfiguracaoSistemaModel();
  const config = await Config.findOne().catch(() => null);
  if (config && config.agendamento_online_ativo === false) {
    throw new Error('Agendamento Online desabilitado.');
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
  const inicio = new Date(dataISO);
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
    res.status(500).json({ detail: error.message });
  }
};

export const getProfissionaisOnline = async (req, res) => {
  try {
    await checkOnlineAtivo();
    const Colaborador = getColaboradorModel();
    const profissionais = await Colaborador.findAll({
      where: { ativo: true, deletado: 'N' },
      attributes: ['id', 'nome', 'foto', 'cargo']
    });
    res.json(profissionais);
  } catch (error) {
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

    // Obter regra de disponibilidade para o dia da semana
    const [year, month, day] = data.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const diaSemana = dateObj.getDay(); // 0 = Dom

    const Disponibilidade = getAgendamentoOnlineDisponibilidadeModel();
    const regra = await Disponibilidade.findOne({
      where: { dia_semana: diaSemana, ativo: true }
    });

    if (!regra) {
      return res.json({ horarios: [] }); // Dia fechado
    }

    // Gerar slots de 30 em 30 minutos dentro do horário de funcionamento
    const inicioMin = timeToMinutes(regra.hora_inicio);
    const fimMin = timeToMinutes(regra.hora_fim);
    const INTERVALO = 30; // minutos entre slots
    const now = new Date();

    const slots = [];
    for (let t = inicioMin; t + duracaoTotal <= fimMin; t += INTERVALO) {
      const horaSlot = minutesToTime(t);
      const dataHoraISO = `${data}T${horaSlot}:00`;

      // Desconsiderar horários que já passaram para o dia de hoje
      const slotDate = new Date(dataHoraISO);
      if (slotDate <= now) {
        continue;
      }

      // Verificar se não há conflito
      const conflito = await slotConflicts(dataHoraISO, duracaoTotal, profissional_id || null);
      if (!conflito) {
        slots.push(horaSlot);
      }
    }

    res.json({ horarios: slots });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const solicitarAgendamento = async (req, res) => {
  try {
    await checkOnlineAtivo();

    const { cliente_nome, telefone, data_hora, servicos, profissional_id, observacoes } = req.body;

    if (!cliente_nome || !telefone || !data_hora || !servicos || servicos.length === 0) {
      return res.status(400).json({ detail: 'Campos obrigatórios: cliente_nome, telefone, data_hora, servicos.' });
    }

    // Buscar ou criar cliente pelo telefone
    const Cliente = getClienteModel();
    const phoneDigits = telefone.replace(/\D/g, '');
    let cliente = await Cliente.findOne({
      where: { telefone: { [Op.like]: `%${phoneDigits.slice(-8)}%` }, deletado: 'N' }
    });
    let clienteId = cliente?.id || null;

    const Solicitacao = getAgendamentoOnlineSolicitacaoModel();

    await Solicitacao.create({
      id: uuidv4(),
      cliente_id: clienteId,
      nome_cliente: cliente_nome,
      telefone,
      data_hora_desejada: new Date(data_hora),
      servicos: typeof servicos === 'string' ? JSON.parse(servicos) : servicos,
      profissional_id: profissional_id || null,
      observacoes: observacoes || '',
      status: 'pendente'
    });

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

    const codigo_otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expira_em = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

    const AuthModel = getAgendamentoOnlineAuthModel();
    await AuthModel.create({
      id: uuidv4(),
      telefone: phoneDigits,
      codigo_otp,
      expira_em,
      tentativas: 0,
      validado: false,
    });

    res.json({
      ok: true,
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

    const Cliente = getClienteModel();
    const cliente = await Cliente.findOne({
      where: { telefone: { [Op.like]: `%${phoneDigits.slice(-8)}%` }, deletado: 'N' }
    });

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

    const phoneDigits = telefone.replace(/\D/g, '');
    const Cliente = getClienteModel();

    let cliente = await Cliente.findOne({
      where: { telefone: { [Op.like]: `%${phoneDigits.slice(-8)}%` }, deletado: 'N' }
    });

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

