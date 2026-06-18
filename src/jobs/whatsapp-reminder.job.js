import { format } from 'date-fns';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { tenantStorage } from '../config/tenantContext.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getClienteModel } from '../models/Cliente.js';
import { getWhatsappConfigModel } from '../models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../models/WhatsappLembrete.js';
import whatsappProvider from '../modules/whatsapp/provider/whatsapp.provider.js';
import { formatMessage } from '../modules/whatsapp/templates/reminder.template.js';

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
 * Função utilitária para dividir um array em chunks.
 */
function chunkArray(array, size) {
  const chunked = [];
  for (let i = 0; i < array.length; i += size) {
    chunked.push(array.slice(i, i + size));
  }
  return chunked;
}

/**
 * Busca e envia todos os lembretes pendentes que estão na hora programada de envio.
 */
export async function runSingleTenantProcessReminders(schema = 'default') {
  console.log(`[WhatsAppReminderJob] Processando lembretes pendentes [Schema: ${schema}] às ${new Date().toISOString()}`);

  try {
    const now = new Date();

    // 1. Liberar lembretes que ficaram presos no status "Processando" por mais de 5 minutos
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    await getWhatsappLembreteModel().update(
      { status: 'Pendente' },
      {
        where: {
          status: 'Processando',
          atualizado_em: {
            [Op.lte]: fiveMinutesAgo
          }
        }
      }
    );

    // 2. Consultar as configurações do WhatsApp para verificar se o envio está ativo
    const config = await getWhatsappConfigModel().findOne();
    if (!config || Number(config.ativo) !== 1) {
      console.log('[WhatsAppReminderJob] Envio automático inativo nas configurações do sistema. Ignorando lote.');
      return;
    }

    // 3. Atualizar atomicamente os lembretes Pendentes para 'Processando' e retornar os registros afetados (Locking)
    const [affectedCount, pendentes] = await getWhatsappLembreteModel().update(
      { status: 'Processando' },
      {
        where: {
          status: 'Pendente',
          data_programada: {
            [Op.lte]: now
          },
          tentativas: {
            [Op.lt]: 3
          }
        },
        returning: true
      }
    );

    if (!pendentes || pendentes.length === 0) {
      return;
    }

    console.log(`[WhatsAppReminderJob] Encontrados ${pendentes.length} lembrete(s) para processar.`);

    // 5. Pre-fetching: Buscar todos os agendamentos e clientes de uma vez
    const agendamentoIds = [...new Set(pendentes.map(p => p.agendamento_id))];
    const agendamentosList = await getAgendamentoModel().findAll({
      where: { id: { [Op.in]: agendamentoIds } }
    });

    // Indexar agendamentos por ID para acesso rápido
    const agendamentosMap = {};
    const clienteIds = new Set();

    for (const ag of agendamentosList) {
      agendamentosMap[ag.id] = ag;
      if (ag.cliente_id) {
        clienteIds.add(ag.cliente_id);
      }
    }

    // Buscar todos os clientes
    const clientesList = await getClienteModel().findAll({
      where: { id: { [Op.in]: Array.from(clienteIds) } }
    });

    // Indexar clientes por ID para acesso rápido
    const clientesMap = {};
    for (const cli of clientesList) {
      clientesMap[cli.id] = cli;
    }

    // 6. Processamento em Lotes (Chunking e Paralelismo)
    // Usaremos blocos de 5 mensagens por vez para não sobrecarregar a Evolution API
    const chunks = chunkArray(pendentes, 5);

    for (const chunk of chunks) {
      const promises = chunk.map(async (reminder) => {
        console.log(`[WhatsAppReminderJob] Processando lembrete ID ${reminder.id} (Tipo: ${reminder.tipo_lembrete})...`);

        // Incrementar o número de tentativas
        reminder.tentativas = (reminder.tentativas || 0) + 1;

        try {
          const ag = agendamentosMap[reminder.agendamento_id];

          if (!ag || ag.deletado === 'S') {
            console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} foi deletado ou não existe. Lembrete Cancelado.`);
            reminder.status = 'Cancelado';
            reminder.erro = 'Agendamento deletado ou inexistente';
            await reminder.save();
            return;
          }

          if (ag.status === 'cancelado') {
            console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} está com status cancelado. Lembrete Cancelado.`);
            reminder.status = 'Cancelado';
            reminder.erro = 'Agendamento cancelado';
            await reminder.save();
            return;
          }

          const cliente = clientesMap[ag.cliente_id];
          if (!cliente || cliente.deletado === 'S') {
            console.log(`[WhatsAppReminderJob] Cliente ID ${ag.cliente_id} deletado ou não encontrado.`);
            reminder.status = 'Falhou';
            reminder.erro = 'Cliente deletado ou não encontrado';
            await reminder.save();
            return;
          }

          const phone = (cliente.telefone || '').trim();
          if (!phone) {
            console.log(`[WhatsAppReminderJob] Cliente ${cliente.nome} não possui telefone cadastrado.`);
            reminder.status = 'Falhou';
            reminder.erro = 'Cliente sem telefone cadastrado';
            await reminder.save();
            return;
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
            reminder.data_envio = format(new Date(), "yyyy-MM-dd'T'HH:mm:ss'Z'");
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

          // Reverter para Pendente se ainda não excedeu tentativas
          if (reminder.tentativas >= 3) {
            reminder.status = 'Falhou';
          } else {
            reminder.status = 'Pendente';
          }
          await reminder.save();
        }
      });

      // Aguardar o término do processamento de todas as mensagens do chunk
      await Promise.allSettled(promises);
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

