import { Op } from 'sequelize';
import { getAgendamentoModel } from '../../models/Agendamento.js';
import { getClienteModel } from '../../models/Cliente.js';
import { getWhatsappConfigModel } from '../../models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../../models/WhatsappLembrete.js';
import whatsappProvider from './provider/whatsapp.provider.js';
import { DEFAULT_TEMPLATE, formatMessage } from './templates/reminder.template.js';

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
      modelo_mensagem: DEFAULT_TEMPLATE
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
  console.log("config", config);

  if (!config) {
    config = await getWhatsappConfigModel().create(data);
  } else {
    console.log("cheguei", config.id, data);

    await getWhatsappConfigModel().update({
      ...data,
      instancia: data.instancia,
      token: data.token,
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
  const { status, startDate, endDate, cliente, numero } = filters;
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
      { '$Agendamento.Cliente.nome$': { [Op.like]: `%${cliente}%` } },
      { '$Agendamento.cliente_nome$': { [Op.like]: `%${cliente}%` } }
    ];
  }
  // Filtro de número no Agendamento
  const agendamentoWhere = {};
  if (numero && !isNaN(parseInt(numero, 10))) {
    agendamentoWhere.numero = parseInt(numero, 10);
  }
  // 3. Executando a consulta usando o ORM
  const lembretes = await Lembrete.findAll({
    where: whereClause,
    include: [
      {
        model: Agendamento,
        required: false, // Isso garante que seja um LEFT JOIN
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
    limit: 500,
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
  return results;
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
  let colabNome = "Não informado";
  if (Array.isArray(agendamento.profissionais) && agendamento.profissionais.length > 0) {
    colabNome = agendamento.profissionais.map(p => p.nome).join(", ");
  }

  // Obter serviços
  let servicoNome = "Serviço";
  if (Array.isArray(agendamento.itens) && agendamento.itens.length > 0) {
    servicoNome = agendamento.itens.map(i => i.nome).join(", ");
  }

  // Formatar data e hora
  const dateObj = new Date(agendamento.data_hora);
  const formattedDate = dateObj.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  const formattedTime = dateObj.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  const messageText = formatMessage(config.modelo_mensagem, {
    nome: cliente.nome,
    data: formattedDate,
    hora: formattedTime,
    servico: servicoNome,
    profissional: colabNome
  });

  // Incrementar tentativa
  reminder.tentativas = (reminder.tentativas || 0) + 1;

  try {
    const result = await whatsappProvider.sendMessage(phone, messageText, config);
    if (result.success) {
      reminder.status = "Enviado";
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
