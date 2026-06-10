import { getWhatsappLembreteModel } from '../models/WhatsappLembrete.js';
import { getWhatsappConfigModel } from '../models/WhatsappConfig.js';
import whatsappProvider from '../modules/whatsapp/provider/whatsapp.provider.js';
import { formatMessage } from '../modules/whatsapp/templates/reminder.template.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { tenantStorage } from '../config/tenantContext.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getClienteModel } from '../models/Cliente.js';


/**
 * Auxiliar para formatar data e hora de forma neutra de fuso horário.
 */
function parseDateString(dateInput) {
  if (!dateInput) return { date: "", time: "" };
  
  // Caso venha como objeto Date, converte para string ISO
  const isoStr = dateInput instanceof Date ? dateInput.toISOString() : String(dateInput);
  
  const parts = isoStr.replace(' ', 'T').split('T');
  const datePart = parts[0]; // Ex: "2026-06-01"
  const timePart = parts[1] || '00:00:00'; // Ex: "12:00:00.000Z"
  
  const dateParts = datePart.split('-');
  const formattedDate = dateParts.length === 3 
    ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` 
    : datePart;
    
  const timeParts = timePart.split(':');
  const formattedTime = timeParts.length >= 2 
    ? `${timeParts[0]}:${timeParts[1]}` 
    : '00:00';
    
  return { date: formattedDate, time: formattedTime };
}

/**
 * Busca e envia todos os lembretes pendentes que estão na hora programada de envio.
 */
export async function runSingleTenantProcessReminders(schema = 'default') {
  console.log(`[WhatsAppReminderJob] Processando lembretes pendentes [Schema: ${schema}] às ${new Date().toISOString()}`);


  try {
    const now = new Date();
    // Buscar lembretes que estão Pendentes e que já deveriam ter sido enviados
    const pendentes = await getWhatsappLembreteModel().findAll({
      where: {
        status: 'Pendente',
        data_programada: {
          [Op.lte]: now
        },
        tentativas: {
          [Op.lt]: 3 // limite máximo para evitar retentativas infinitas
        }
      }
    });

    if (pendentes.length === 0) {
      return;
    }

    console.log(`[WhatsAppReminderJob] Encontrados ${pendentes.length} lembrete(s) para processar.`);

    // Consultar as configurações do WhatsApp para verificar se o envio está ativo
    const config = await getWhatsappConfigModel().findOne();
    if (!config || Number(config.ativo) !== 1) {
      console.log('[WhatsAppReminderJob] Envio automático inativo nas configurações do sistema. Ignorando lote.');
      return;
    }

    for (const reminder of pendentes) {
      console.log(`[WhatsAppReminderJob] Processando lembrete ID ${reminder.id} (Tipo: ${reminder.tipo_lembrete})...`);

      // Incrementar o número de tentativas
      reminder.tentativas = (reminder.tentativas || 0) + 1;

      try {
        // Obter agendamento associado
        const ag = await getAgendamentoModel().findByPk(reminder.agendamento_id);
        if (!ag || ag.deletado === 'S') {
          console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} foi deletado ou não existe. Lembrete Cancelado.`);
          reminder.status = 'Cancelado';
          reminder.erro = 'Agendamento deletado ou inexistente';
          await reminder.save();
          continue;
        }

        // Se o agendamento foi cancelado
        if (ag.status === 'cancelado') {
          console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} está com status cancelado. Lembrete Cancelado.`);
          reminder.status = 'Cancelado';
          reminder.erro = 'Agendamento cancelado';
          await reminder.save();
          continue;
        }

        // Obter cliente
        const cliente = await getClienteModel().findByPk(ag.cliente_id);
        if (!cliente || cliente.deletado === 'S') {
          console.log(`[WhatsAppReminderJob] Cliente ID ${ag.cliente_id} deletado ou não encontrado.`);
          reminder.status = 'Falhou';
          reminder.erro = 'Cliente deletado ou não encontrado';
          await reminder.save();
          continue;
        }

        const phone = (cliente.telefone || '').trim();
        if (!phone) {
          console.log(`[WhatsAppReminderJob] Cliente ${cliente.nome} não possui telefone cadastrado.`);
          reminder.status = 'Falhou';
          reminder.erro = 'Cliente sem telefone cadastrado';
          await reminder.save();
          continue;
        }

        // Extrair nome dos profissionais
        let colabNome = "Não informado";
        if (Array.isArray(ag.profissionais) && ag.profissionais.length > 0) {
          colabNome = ag.profissionais.map(p => p.nome).join(", ");
        }

        // Extrair nome dos serviços
        let servicoNome = "Serviço";
        if (Array.isArray(ag.itens) && ag.itens.length > 0) {
          servicoNome = ag.itens.map(i => i.nome).join(", ");
        }

        // Formatar data e hora timezone-neutras
        const { date: formattedDate, time: formattedTime } = parseDateString(ag.data_hora);

        // Montar a mensagem
        const messageText = formatMessage(config.modelo_mensagem, {
          nome: cliente.nome,
          data: formattedDate,
          hora: formattedTime,
          servico: servicoNome,
          profissional: colabNome
        });

        // Enviar a mensagem via provedor WhatsApp
        const result = await whatsappProvider.sendMessage(phone, messageText, config);

        if (result.success) {
          reminder.status = 'Enviado';
          reminder.data_envio = new Date();
          reminder.mensagem = messageText;
          reminder.erro = null;
          await reminder.save();
          console.log(`[WhatsAppReminderJob] Lembrete ID ${reminder.id} enviado com sucesso via WhatsApp.`);
        } else {
          throw new Error(result.error || 'Erro reportado pelo provedor de envio.');
        }

      } catch (err) {
        console.error(`[WhatsAppReminderJob] Erro ao enviar lembrete ID ${reminder.id}:`, err);
        reminder.erro = err.message || 'Erro inesperado no envio.';
        if (reminder.tentativas >= 3) {
          reminder.status = 'Falhou';
        }
        await reminder.save();
      }
    }
  } catch (error) {
    console.error('[WhatsAppReminderJob] Erro geral na execução do runSingleTenantProcessReminders:', error);
  }
}

/**
 * Busca e envia todos os lembretes pendentes iterando sobre todos os schemas ativos do PostgreSQL.
 * Caso o dialeto não seja PostgreSQL (ex: SQLite), roda no contexto padrão.
 */
export async function processReminders() {
  const isPostgres = sequelize.options.dialect === 'postgres';

  if (!isPostgres) {
    // SQLite/development ou outros dialetos
    await runSingleTenantProcessReminders('default');
    return;
  }

  // PostgreSQL: Iterar sobre todos os schemas ativos do banco
  try {
    const results = await sequelize.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
        AND schema_name NOT LIKE 'pg_temp_%' 
        AND schema_name NOT LIKE 'pg_toast_temp_%'
        AND schema_name LIKE 'company_%';
    `, { type: sequelize.QueryTypes.SELECT });

    const schemas = results.map(row => row.schema_name);

    for (const schema of schemas) {
      // Executa de forma isolada usando o AsyncLocalStorage
      await tenantStorage.run(schema, async () => {
        await runSingleTenantProcessReminders(schema);
      });
    }
  } catch (error) {
    console.error('[WhatsAppReminderJob] Erro ao processar lembretes nos schemas:', error);
  }
}

/**
 * Inicializa a execução do job em intervalos regulares.
 */
export function startReminderJob() {
  console.log('[WhatsAppReminderJob] Agendando rotina de verificação de lembretes a cada 1 minuto.');
  // Execução imediata na inicialização do servidor
  processReminders();
  // Agendamento periódico
  setInterval(processReminders, 60000);
}

