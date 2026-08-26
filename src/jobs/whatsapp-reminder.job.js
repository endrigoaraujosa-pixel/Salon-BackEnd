import { TZDate } from '@date-fns/tz';
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
import { formatThankYouMessage } from '../modules/whatsapp/templates/thankyou.template.js';
import { getContextualDayOfWeek } from '../utils/agendaDateTime.js';
import { formatProfissionalNames, formatPhoneNumber, maskPhoneNumber } from '../utils/index.js';

let heartbeatCounter = 0;

/**
 * Auxiliar para formatar data e hora no fuso horário da agenda (America/Recife).
 */
function parseDateString(dateInput) {
  if (!dateInput) return { date: "", time: "" };

  try {
    const tzDate = new TZDate(dateInput, 'America/Recife');
    const formattedDate = format(tzDate, 'dd/MM/yyyy');
    const formattedTime = format(tzDate, 'HH:mm');
    return { date: formattedDate, time: formattedTime };
  } catch (err) {
    console.error("[WhatsAppReminderJob] Erro ao converter data/hora para o fuso horário da agenda:", err);
    return { date: "", time: "" };
  }
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
  try {
    const now = new Date();

    // 1. Liberar lembretes que ficaram presos no status "Processando" por mais de 5 minutos (ex: crash do servidor)
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const [releasedCount] = await getWhatsappLembreteModel().update(
      { status: 'Pendente', atualizado_em: new Date() },
      {
        where: {
          status: 'Processando',
          atualizado_em: {
            [Op.lte]: fiveMinutesAgo
          }
        }
      }
    );

    if (releasedCount > 0) {
      console.log(`[WhatsAppReminderJob] [Schema: ${schema}] Liberados ${releasedCount} lembrete(s) que estavam presos em 'Processando' há mais de 5 minutos.`);
    }

    // 2. Consultar as configurações do WhatsApp para verificar se o envio está ativo
    const config = await getWhatsappConfigModel().findOne();
    if (!config || Number(config.ativo) !== 1) {
      return;
    }

    // 3. SELEÇÃO E LOCK ATÔMICO EM 2 ETAPAS (Garantia contra Concorrência)
    // Etapa A: Buscar candidatos a envio
    const candidates = await getWhatsappLembreteModel().findAll({
      where: {
        status: 'Pendente',
        data_programada: {
          [Op.lte]: new Date()
        },
        tentativas: {
          [Op.lt]: 3
        }
      },
      limit: 20,
      order: [['data_programada', 'ASC']]
    });

    if (!candidates || candidates.length === 0) {
      return;
    }

    const candidateIds = candidates.map(c => c.id);

    // Etapa B: Travar atômicos apenas os que continuam em 'Pendente'
    const [updatedCount] = await getWhatsappLembreteModel().update(
      { status: 'Processando', atualizado_em: new Date() },
      {
        where: {
          id: { [Op.in]: candidateIds },
          status: 'Pendente'
        }
      }
    );

    if (updatedCount === 0) {
      return;
    }

    // Buscar as instâncias de Model reais com status 'Processando' reservadas
    const pendentes = await getWhatsappLembreteModel().findAll({
      where: {
        id: { [Op.in]: candidateIds },
        status: 'Processando'
      }
    });

    if (!pendentes || pendentes.length === 0) {
      return;
    }

    console.log(`[WhatsAppReminderJob] [Schema: ${schema}] Reservados ${pendentes.length} lembrete(s) para processamento.`);

    // 4. Pre-fetching: Buscar todos os agendamentos e clientes de uma vez
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

    // 5. Processamento em Lotes Fracionados (Chunking e Throttling)
    const chunks = chunkArray(pendentes, 5);

    for (const chunk of chunks) {
      const promises = chunk.map(async (reminder) => {
        // Incrementar o número de tentativas
        reminder.tentativas = (reminder.tentativas || 0) + 1;

        try {
          const ag = agendamentosMap[reminder.agendamento_id];

          if (!ag || ag.deletado === 'S') {
            console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} deletado/inexistente. Lembrete ID ${reminder.id} Cancelado.`);
            reminder.status = 'Cancelado';
            reminder.erro = 'Agendamento deletado ou inexistente';
            await reminder.save();
            return;
          }

          if (ag.status === 'cancelado') {
            console.log(`[WhatsAppReminderJob] Agendamento ID ${reminder.agendamento_id} cancelado. Lembrete ID ${reminder.id} Cancelado.`);
            reminder.status = 'Cancelado';
            reminder.erro = 'Agendamento cancelado';
            await reminder.save();
            return;
          }

          // Validar elegibilidade por tipo de lembrete
          if (reminder.tipo_lembrete === 'agradecimento') {
            if (ag.status !== 'concluido') {
              console.log(`[WhatsAppReminderJob] Lembrete agradecimento ID ${reminder.id} cancelado pois agendamento ${ag.id} está com status '${ag.status}'.`);
              reminder.status = 'Cancelado';
              reminder.erro = 'Agendamento não concluído';
              await reminder.save();
              return;
            }
          } else {
            if (ag.status === 'concluido') {
              console.log(`[WhatsAppReminderJob] Lembrete padrão ID ${reminder.id} cancelado pois agendamento ${ag.id} já está concluído.`);
              reminder.status = 'Cancelado';
              reminder.erro = 'Agendamento concluído';
              await reminder.save();
              return;
            }
            if (ag.status !== 'agendado' && ag.status !== 'confirmado') {
              console.log(`[WhatsAppReminderJob] Lembrete padrão ID ${reminder.id} cancelado pois agendamento ${ag.id} está com status '${ag.status}'.`);
              reminder.status = 'Cancelado';
              reminder.erro = `Agendamento com status ${ag.status}`;
              await reminder.save();
              return;
            }
          }

          // Validar se a opção específica do tipo está ativa nas configurações
          if (reminder.tipo_lembrete === '24h' && Number(config.lembrete_24h) !== 1) {
            reminder.status = 'Ignorado';
            reminder.erro = 'Configuração lembrete 24h desativada';
            await reminder.save();
            return;
          }
          if (reminder.tipo_lembrete === '2h' && Number(config.lembrete_2h) !== 1) {
            reminder.status = 'Ignorado';
            reminder.erro = 'Configuração lembrete 2h desativada';
            await reminder.save();
            return;
          }
          if (reminder.tipo_lembrete === '1h' && Number(config.lembrete_1h) !== 1) {
            reminder.status = 'Ignorado';
            reminder.erro = 'Configuração lembrete 1h desativada';
            await reminder.save();
            return;
          }
          if (reminder.tipo_lembrete === 'agradecimento' && Number(config.agradecimento_ativo) !== 1) {
            reminder.status = 'Ignorado';
            reminder.erro = 'Configuração agradecimento desativada';
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

          const phone = formatPhoneNumber(cliente.telefone || '');
          if (!phone) {
            console.log(`[WhatsAppReminderJob] Cliente ${cliente.nome} não possui telefone válido.`);
            reminder.status = 'Falhou';
            reminder.erro = 'Cliente sem telefone cadastrado';
            await reminder.save();
            return;
          }

          const colabNome = formatProfissionalNames(ag.profissionais);
          let servicoNome = "Serviço";
          let servicosValores = "";
          if (Array.isArray(ag.itens) && ag.itens.length > 0) {
            servicoNome = ag.itens.map(i => i.nome).join(", ");
            servicosValores = ag.itens.map(i => {
              const valor = parseFloat(i.valor || 0);
              return `${i.nome} - R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }).join("\n");
          }

          const { date: formattedDate, time: formattedTime } = parseDateString(ag.data_hora);
          const diaSemana = getContextualDayOfWeek(ag.data_hora, reminder.tipo_lembrete);

          const templateParams = {
            nome: cliente.nome,
            data: formattedDate,
            hora: formattedTime,
            servico: servicoNome,
            profissional: colabNome,
            servicos_valores: servicosValores,
            dia_semana: diaSemana
          };

          let messageText;
          if (reminder.tipo_lembrete === 'agradecimento') {
            messageText = formatThankYouMessage(config.agradecimento_modelo_mensagem, templateParams);
          } else {
            messageText = formatMessage(config.modelo_mensagem, templateParams);
          }

          const masked = maskPhoneNumber(phone);
          console.log(`[WhatsAppReminderJob] Disparando Lembrete ID ${reminder.id} (Tipo: ${reminder.tipo_lembrete}) para ${masked} | Tentativa ${reminder.tentativas}/3...`);

          const result = await whatsappProvider.sendMessage(phone, messageText, config);

          if (result && result.success) {
            reminder.status = 'Enviado';
            reminder.data_envio = new Date();
            reminder.mensagem = messageText;
            reminder.erro = null;
            await reminder.save();
            console.log(`[WhatsAppReminderJob] Lembrete ID ${reminder.id} ENVIADO COM SUCESSO para ${masked}. (Agendamento #${ag.numero || ag.id})`);
          } else {
            const errReason = (result && result.error) || 'Erro desconhecido retornado pela API.';
            const isPermanent = result && result.isPermanent === true;
            throw { message: errReason, isPermanent };
          }

        } catch (err) {
          const errMsg = err.message || (typeof err === 'string' ? err : 'Erro inesperado no envio.');
          const isPermanent = err.isPermanent === true;

          console.error(`[WhatsAppReminderJob] Falha no Lembrete ID ${reminder.id} (Tentativa ${reminder.tentativas}/3):`, errMsg);
          reminder.erro = errMsg;

          // Se for erro definitivo ou atingiu 3 tentativas, define como Falhou
          if (isPermanent || reminder.tentativas >= 3) {
            reminder.status = 'Falhou';
            console.log(`[WhatsAppReminderJob] Lembrete ID ${reminder.id} marcado definitivamente como FALHOU.`);
          } else {
            // Retry com Backoff Incremental: Tentativa 1 -> +5 minutos; Tentativa 2 -> +15 minutos
            const delayMinutes = reminder.tentativas === 1 ? 5 : 15;
            reminder.status = 'Pendente';
            reminder.data_programada = new Date(Date.now() + delayMinutes * 60 * 1000);
            console.log(`[WhatsAppReminderJob] Lembrete ID ${reminder.id} REAGENDADO para +${delayMinutes}m (Próxima tentativa em ${reminder.data_programada.toISOString()}).`);
          }
          await reminder.save();
        }
      });

      await Promise.allSettled(promises);
    }
  } catch (error) {
    console.error('[WhatsAppReminderJob] Erro geral na execução de runSingleTenantProcessReminders:', error);
  }
}

/**
 * Busca e envia todos os lembretes pendentes iterando sobre todos os schemas ativos do PostgreSQL.
 * Caso o dialeto não seja PostgreSQL multi-tenant, roda no contexto padrão.
 */
export async function processReminders() {
  try {
    heartbeatCounter++;
    if (heartbeatCounter % 15 === 0) {
      console.log(`[WhatsAppReminderJob - Heartbeat] Worker ativo e operando normalmente em ${new Date().toISOString()}.`);
    }

    let schemas = [];
    try {
      const results = await sequelize.query(`
        SELECT schema_name 
        FROM information_schema.schemata 
        WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
          AND schema_name NOT LIKE 'pg_temp_%' 
          AND schema_name NOT LIKE 'pg_toast_temp_%'
          AND schema_name LIKE 'company_%';
      `, { type: sequelize.QueryTypes.SELECT });

      if (results && Array.isArray(results)) {
        schemas = results.map(row => row.schema_name);
      }
    } catch (err) {
      schemas = [];
    }

    if (schemas.length === 0) {
      await runSingleTenantProcessReminders('default');
    } else {
      for (const schema of schemas) {
        await tenantStorage.run(schema, async () => {
          await runSingleTenantProcessReminders(schema);
        });
      }
    }
  } catch (error) {
    console.error('[WhatsAppReminderJob] Erro ao processar lembretes nos schemas:', error);
  }
}

/**
 * Inicializa a execução do job em intervalos regulares.
 */
export function startReminderJob() {
  console.log('[WhatsAppReminderJob] Inicializando rotina de verificação de lembretes (intervalo: 60s).');
  // Execução imediata na inicialização
  processReminders();
  // Agendamento periódico
  setInterval(processReminders, 60000);
}
