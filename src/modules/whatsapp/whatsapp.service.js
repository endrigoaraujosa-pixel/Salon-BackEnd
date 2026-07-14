import { Op } from 'sequelize';
import { getAgendamentoModel } from '../../models/Agendamento.js';
import { getClienteModel } from '../../models/Cliente.js';
import { getWhatsappConfigModel } from '../../models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../../models/WhatsappLembrete.js';
import whatsappProvider from './provider/whatsapp.provider.js';
import { DEFAULT_TEMPLATE, formatMessage } from './templates/reminder.template.js';
import { DEFAULT_THANKYOU_TEMPLATE, formatThankYouMessage } from './templates/thankyou.template.js';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { formatAgendaDate, formatAgendaTime, getContextualDayOfWeek } from '../../utils/agendaDateTime.js';
import { formatProfissionalNames } from '../../utils/index.js';

/**
 * Obtém a configuração do WhatsApp, criando-a com valores padrão caso não exista.
 */
export async function getConfig() {
  let config = await getWhatsappConfigModel().findOne();
  if (!config) {
    config = await getWhatsappConfigModel().create({
      ativo: 0,
      lembrete_24h: 1,
      lembrete_2h: 1,
      lembrete_1h: 1,
      modelo_mensagem: DEFAULT_TEMPLATE,
      agradecimento_ativo: 0,
      agradecimento_tempo_minutos: 30,
      agradecimento_modelo_mensagem: DEFAULT_THANKYOU_TEMPLATE
    });
  }
  return config;
}

/**
 * Salva as configurações do WhatsApp.
 * @param {object} data - Dados da configuração
 */
export async function saveConfig(data) {
  let config = await getWhatsappConfigModel().findOne();
  if (!config) {
    config = await getWhatsappConfigModel().create(data);
  } else {
    await getWhatsappConfigModel().update({
      ...data,
      instancia: data.instancia ?? config.instancia,
      token: data.token ?? config.token,
    }, {
      where: {
        id: config.id
      }
    });

  }
  return config;
}

/**
 * Obtém o histórico de envios com filtros aplicáveis.
 * @param {object} filters - Filtros de busca (status, startDate, endDate, cliente)
 */
export async function getHistory(filters = {}) {
  const { status, startDate, endDate, cliente, numero, page, limit } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 50;
  const offset = (pageNum - 1) * limitNum;

  const Lembrete = getWhatsappLembreteModel();
  const Agendamento = getAgendamentoModel();
  const Cliente = getClienteModel();
  // 1. Definindo as associações dinamicamente (necessário apenas se não estiverem definidas nos Models)
  // Como as tabelas não possuem a associação formalizada no arquivo, a gente "avisa" o Sequelize aqui:
  if (!Lembrete.associations.Agendamento) {
    Lembrete.belongsTo(Agendamento, { foreignKey: 'agendamento_id' });
  }
  if (!Agendamento.associations.Cliente) {
    Agendamento.belongsTo(Cliente, { foreignKey: 'cliente_id' });
  }
  // 2. Construindo a cláusula WHERE da tabela principal (whatsapp_lembretes)
  const whereClause = {};
  if (status) {
    whereClause.status = status;
  }
  if (startDate || endDate) {
    whereClause.data_programada = {};
    if (startDate) {
      whereClause.data_programada[Op.gte] = new Date(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      whereClause.data_programada[Op.lte] = new Date(`${endDate}T23:59:59.999Z`);
    }
  }
  // Se precisar filtrar cliente (com um OR entre o nome do Cliente E o cliente_nome gravado no agendamento)
  if (cliente) {
    whereClause[Op.or] = [
      { '$Agendamento.Cliente.nome$': { [Op.iLike]: `%${cliente}%` } },
      { '$Agendamento.cliente_nome$': { [Op.iLike]: `%${cliente}%` } }
    ];
  }
  // Filtro de número no Agendamento
  const agendamentoWhere = {};
  if (numero && !isNaN(parseInt(numero, 10))) {
    agendamentoWhere.numero = parseInt(numero, 10);
  }
  // 3. Executando a consulta usando o ORM
  const { count, rows: lembretes } = await Lembrete.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: Agendamento,
        required: !!(numero || cliente), // Restringir resultados quando algum filtro dependente de Agendamento é aplicado
        where: Object.keys(agendamentoWhere).length > 0 ? agendamentoWhere : undefined,
        include: [
          {
            model: Cliente,
            required: false // LEFT JOIN
          }
        ]
      }
    ],
    order: [['data_programada', 'DESC']],
    limit: limitNum,
    offset,
    raw: true,  // Retorna um objeto JSON simples
    nest: true  // Agrupa os joins (cria os objetos Agendamento e Cliente encadeados na resposta)
  });
  // 4. Mapeando para o mesmo formato (achatado) que a query SQL raw retornava originalmente
  const results = lembretes.map(l => ({
    id: l.id,
    agendamento_id: l.agendamento_id,
    tipo_lembrete: l.tipo_lembrete,
    data_programada: l.data_programada,
    data_envio: l.data_envio,
    status: l.status,
    mensagem: l.mensagem,
    erro: l.erro,
    tentativas: l.tentativas,
    agendamento_numero: l.Agendamento?.numero || null,
    agendamento_data_hora: l.Agendamento?.data_hora || null,
    cliente_nome: l.Agendamento?.Cliente?.nome || l.Agendamento?.cliente_nome || '',
    cliente_telefone: l.Agendamento?.Cliente?.telefone || ''
  }));
  return {
    data: results,
    total: count,
    page: pageNum,
    pages: Math.ceil(count / limitNum)
  };
}

/**
 * Reenvia uma notificação cujo envio falhou.
 * @param {number} reminderId - ID do lembrete falho
 */
export async function resendReminder(reminderId) {
  const reminder = await getWhatsappLembreteModel().findByPk(reminderId);
  if (!reminder) {
    throw new Error("Lembrete não encontrado.");
  }

  if (reminder.status !== "Falhou") {
    throw new Error("Apenas lembretes que falharam podem ser reenviados.");
  }

  // Obter agendamento e cliente
  const agendamento = await getAgendamentoModel().findByPk(reminder.agendamento_id);
  if (!agendamento) {
    throw new Error("Agendamento correspondente não encontrado.");
  }

  const cliente = await getClienteModel().findByPk(agendamento.cliente_id);
  if (!cliente) {
    throw new Error("Cliente não encontrado.");
  }

  const phone = (cliente.telefone || "").trim();
  if (!phone) {
    throw new Error("Cliente não possui telefone cadastrado.");
  }

  const config = await getConfig();

  // Obter nome do profissional
  const colabNome = formatProfissionalNames(agendamento.profissionais);

  // Obter serviços
  let servicoNome = "Serviço";
  let servicosValores = "";
  if (Array.isArray(agendamento.itens) && agendamento.itens.length > 0) {
    servicoNome = agendamento.itens.map(i => i.nome).join(", ");
    servicosValores = agendamento.itens.map(i => {
      const valor = parseFloat(i.valor || 0);
      return `${i.nome} - R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }).join("\n");
  }

    // Formatar data e hora usando a zona de agenda (America/Recife)
    const tzDate = new TZDate(agendamento.data_hora, 'America/Recife');
    const formattedDate = format(tzDate, 'dd/MM/yyyy');
    const formattedTime = format(tzDate, 'HH:mm');

  let messageText;
  if (reminder.tipo_lembrete === 'agradecimento') {
    messageText = formatThankYouMessage(config.agradecimento_modelo_mensagem, {
      nome: cliente.nome,
      data: formattedDate,
      hora: formattedTime,
      servico: servicoNome,
      profissional: colabNome,
      servicos_valores: servicosValores
    });
  } else {
    const diaSemana = getContextualDayOfWeek(agendamento.data_hora, reminder.tipo_lembrete);
    messageText = formatMessage(config.modelo_mensagem, {
      nome: cliente.nome,
      data: formattedDate,
      hora: formattedTime,
      servico: servicoNome,
      profissional: colabNome,
      dia_semana: diaSemana
    });
  }

  // Incrementar tentativa
  reminder.tentativas = (reminder.tentativas || 0) + 1;

  try {
    const result = await whatsappProvider.sendMessage(phone, messageText, config);
    if (result.success) {
      reminder.status = 'Enviado';
      reminder.data_envio = new Date();
      reminder.mensagem = messageText;
      reminder.erro = null;
      await reminder.save();
      return { success: true, reminder };
    } else {
      throw new Error(result.error || "Erro desconhecido no provedor de envio.");
    }
  } catch (err) {
    reminder.erro = err.message || "Erro durante o reenvio.";
    await reminder.save();
    throw err;
  }
}

/**
 * Verifica se um telefone está registrado no WhatsApp
 * @param {string} phone 
 */
export async function checkWhatsappNumber(phone) {
  if (!phone) {
    throw new Error("Telefone não fornecido.");
  }
  const config = await getConfig();
  return await whatsappProvider.checkNumber(phone, config);
}
