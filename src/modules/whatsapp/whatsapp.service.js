import { getWhatsappConfigModel } from '../../models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../../models/WhatsappLembrete.js';
import { getAgendamentoModel } from '../../models/Agendamento.js';
import { getClienteModel } from '../../models/Cliente.js';
import { getColaboradorModel } from '../../models/Colaborador.js';
import { sequelize } from '../../config/db.js';
import whatsappProvider from './provider/whatsapp.provider.js';
import { formatMessage, DEFAULT_TEMPLATE } from './templates/reminder.template.js';
import { QueryTypes } from 'sequelize';
import { getTenantSchema } from '../../config/tenantContext.js';

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

  let query = `
    SELECT 
      l.id,
      l.agendamento_id,
      l.tipo_lembrete,
      l.data_programada,
      l.data_envio,
      l.status,
      l.mensagem,
      l.erro,
      l.tentativas,
      a.numero AS agendamento_numero,
      a.data_hora AS agendamento_data_hora,
      COALESCE(c.nome, a.cliente_nome) AS cliente_nome,
      COALESCE(c.telefone, '') AS cliente_telefone
    FROM whatsapp_lembretes l
    LEFT JOIN agendamentos a ON l.agendamento_id = a.id
    LEFT JOIN clientes c ON a.cliente_id = c.id
    WHERE 1=1
  `;

  const replacements = {};

  if (status) {
    query += ` AND l.status = :status`;
    replacements.status = status;
  }

  if (startDate) {
    query += ` AND l.data_programada >= :startDate`;
    replacements.startDate = `${startDate}T00:00:00.000Z`;
  }

  if (endDate) {
    query += ` AND l.data_programada <= :endDate`;
    replacements.endDate = `${endDate}T23:59:59.999Z`;
  }

  if (cliente) {
    query += ` AND (c.nome LIKE :clientePattern OR a.cliente_nome LIKE :clientePattern)`;
    replacements.clientePattern = `%${cliente}%`;
  }

  if (numero && !isNaN(parseInt(numero, 10))) {
    query += ` AND a.numero = :numero`;
    replacements.numero = parseInt(numero, 10);
  }

  // Ordenar por data programada mais recente
  query += ` ORDER BY l.data_programada DESC LIMIT 500`;

  const results = await sequelize.query(query, {
    replacements,
    type: QueryTypes.SELECT,
    searchPath: getTenantSchema()
  });

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
