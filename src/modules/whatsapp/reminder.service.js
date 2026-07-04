import { getWhatsappConfigModel } from '../../models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../../models/WhatsappLembrete.js';
import { getClienteModel } from '../../models/Cliente.js';
import { DEFAULT_TEMPLATE } from './templates/reminder.template.js';
import { DEFAULT_THANKYOU_TEMPLATE } from './templates/thankyou.template.js';
import { sequelize } from '../../config/db.js';
import { formatPhoneNumber } from '../../utils/index.js';
import { normalizeAgendaDateTime } from '../../utils/agendaDateTime.js';
import axios from 'axios';
import { addMinutes } from 'date-fns';
import { Op } from 'sequelize';

function getEvolutionBaseUrl(config = {}) {
  const configuredUrl = String(config.api_url || '').trim();
  const envUrl = String(process.env.EVOLUTION_API_URL || '').trim();

  if (configuredUrl && configuredUrl !== 'external' && configuredUrl !== 'local') {
    return configuredUrl.replace(/\/+$/, '');
  }

  return envUrl.replace(/\/+$/, '');
}

function getEvolutionApiKey(config = {}) {
  return String(process.env.EVOLUTION_API_TOKEN || config.token || '').trim();
}

/**
 * Gera os lembretes automáticos na tabela whatsapp_lembretes para um agendamento.
 * @param {object} agendamento - Objeto do agendamento criado ou editado.
 */
export async function generateReminders(agendamento) {
  try {
    // 1. Consultar configurações do WhatsApp.
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

    // Se o envio automático não estiver ativo, não faz nada
    if (Number(config.ativo) !== 1) {
      console.log(`[WhatsAppReminderService] Envio automático inativo. Ignorando agendamento ${agendamento.id}.`);
      return;
    }

    // 2. Consultar o telefone do cliente
    const client = await getClienteModel().findByPk(agendamento.cliente_id);
    if (!client) {
      console.error(`[WhatsAppReminderService] Cliente ID ${agendamento.cliente_id} não encontrado para o agendamento ${agendamento.id}.`);
      return;
    }

    const phone = formatPhoneNumber(client?.telefone || "");

    if (!phone) {
      console.warn(`[WhatsAppReminderService] O cliente ${client.nome} (ID: ${client.id}) não possui telefone cadastrado. Lembrete NÃO gerado para agendamento ${agendamento.id}.`);
      return;
    }

    const instance = config?.instancia;
    const baseUrl = getEvolutionBaseUrl(config);
    const apiKey = getEvolutionApiKey(config);
    
    // Apenas verifica se o numero existe se estiver usando provedor externo e com configuracoes
    if (config.api_url !== 'local' && baseUrl && instance) {
      const urlCheckNumber = `${baseUrl}/chat/whatsappNumbers/${instance}`;
      try {
        const response = await axios.post(urlCheckNumber, {
          numbers: [phone]
        }, {
          headers: {
            ...(apiKey ? { apikey: apiKey } : {}),
            'Content-Type': 'application/json'
          }
        });

        if (!response.data || !response.data[0] || !response.data[0].exists) {
          console.log(`[WhatsAppReminderService] O número ${phone} não está cadastrado no WhatsApp. Lembrete não gerado.`);
          return;
        }
      } catch (err) {
        console.error(`[WhatsAppReminderService] Erro ao verificar número na API externa:`, err.message);
        // Em caso de falha da API externa de verificação, não impedimos a criação do lembrete localmente
      }
    }

    // 3. Identificar lembretes habilitados.
    const activeReminders = [];
    if (Number(config.lembrete_24h) === 1) activeReminders.push({ type: '24h', hoursBefore: 24 });
    if (Number(config.lembrete_2h) === 1) activeReminders.push({ type: '2h', hoursBefore: 2 });
    if (Number(config.lembrete_1h) === 1) activeReminders.push({ type: '1h', hoursBefore: 1 });

    const appointmentDate = normalizeAgendaDateTime(agendamento.data_hora);

    for (const item of activeReminders) {
      // Calcular data_programada
      const scheduledTime = new Date(appointmentDate.getTime() - item.hoursBefore * 60 * 60 * 1000);

      // Prevenção de duplicidade: checar se já existe um lembrete ativo
      const existing = await getWhatsappLembreteModel().findOne({
        where: {
          agendamento_id: agendamento.id,
          tipo_lembrete: item.type
        }
      });

      // Apenas gera se a data_programada for no futuro
      if (scheduledTime > new Date()) {
        try {
          if (!existing) {
            await getWhatsappLembreteModel().create({
              agendamento_id: agendamento.id,
              tipo_lembrete: item.type,
              data_programada: scheduledTime,
              status: 'Pendente',
              tentativas: 0
            });
            console.log(`[WhatsAppReminderService] Lembrete ${item.type} criado para agendamento ${agendamento.id} para ${scheduledTime.toISOString()}.`);
          } else {
            // Se já existe e não foi enviado, atualiza a data e redefine
            if (existing.status !== 'Enviado') {
              existing.data_programada = scheduledTime;
              existing.status = 'Pendente';
              existing.tentativas = 0;
              existing.mensagem = null;
              existing.erro = null;
              await existing.save();
              console.log(`[WhatsAppReminderService] Lembrete ${item.type} atualizado para agendamento ${agendamento.id} para ${scheduledTime.toISOString()}.`);
            } else {
              // Se já foi enviado, mas o horário agendado mudou, precisamos arquivar o antigo e criar um novo
              if (existing.data_programada.getTime() !== scheduledTime.getTime()) {
                existing.tipo_lembrete = `${existing.tipo_lembrete}_enviado_${existing.id}`;
                await existing.save();

                await getWhatsappLembreteModel().create({
                  agendamento_id: agendamento.id,
                  tipo_lembrete: item.type,
                  data_programada: scheduledTime,
                  status: 'Pendente',
                  tentativas: 0
                });
                console.log(`[WhatsAppReminderService] Lembrete ${item.type} enviado anteriormente foi arquivado. Novo lembrete gerado para ${scheduledTime.toISOString()}.`);
              }
            }
          }
        } catch (err) {
          console.error(`[WhatsAppReminderService] Erro ao criar/atualizar lembrete ${item.type} para agendamento ${agendamento.id}:`, err);
        }
      } else {
        console.log(`[WhatsAppReminderService] Lembrete ${item.type} para agendamento ${agendamento.id} não processado pois a data programada (${scheduledTime.toISOString()}) seria no passado.`);
      }
    }
  } catch (error) {
    console.error(`[WhatsAppReminderService] Falha ao processar reminders do agendamento ${agendamento.id}:`, error);
  }
}

/**
 * Cancela todos os lembretes pendentes associados a um agendamento (Ex: quando cancelado ou excluído).
 * @param {string} agendamentoId - ID do agendamento
 */
export async function cancelReminders(agendamentoId) {
  try {
    const [count] = await getWhatsappLembreteModel().update(
      {
        status: 'Cancelado',
        tipo_lembrete: sequelize.literal("tipo_lembrete || '_cancelado_' || id")
      },
      {
        where: {
          agendamento_id: agendamentoId,
          status: 'Pendente'
        }
      }
    );
    console.log(`[WhatsAppReminderService] Cancelados ${count} lembretes pendentes do agendamento ${agendamentoId}.`);
  } catch (error) {
    console.error(`[WhatsAppReminderService] Erro ao cancelar lembretes do agendamento ${agendamentoId}:`, error);
  }
}

/**
 * Gera um lembrete de agradecimento automático para envio após a conclusão de um atendimento.
 * O envio somente ocorre se:
 * - A configuração de agradecimento estiver ativa
 * - O cliente possuir telefone cadastrado
 * - O modelo de mensagem de agradecimento estiver preenchido
 * @param {object} agendamento - Objeto do agendamento concluído.
 */
export async function generateThankYouReminder(agendamento) {
  try {
    // 1. Consultar configurações do WhatsApp
    let config = await getWhatsappConfigModel().findOne();
    if (!config) {
      console.log(`[WhatsAppThankYouService] Configuração do WhatsApp não encontrada. Ignorando agendamento ${agendamento.id}.`);
      return;
    }

    // 2. Verificar se o envio de agradecimento está ativo
    if (Number(config.agradecimento_ativo) !== 1) {
      console.log(`[WhatsAppThankYouService] Envio de agradecimento desativado. Ignorando agendamento ${agendamento.id}.`);
      return;
    }

    // 3. Verificar se o modelo de mensagem está preenchido
    const modeloMensagem = config.agradecimento_modelo_mensagem || '';
    if (!modeloMensagem.trim()) {
      console.log(`[WhatsAppThankYouService] Modelo de mensagem de agradecimento vazio. Ignorando agendamento ${agendamento.id}.`);
      return;
    }

    // 4. Verificar se o cliente possui telefone cadastrado
    const client = await getClienteModel().findByPk(agendamento.cliente_id);
    if (!client) {
      console.error(`[WhatsAppThankYouService] Cliente ID ${agendamento.cliente_id} não encontrado para o agendamento ${agendamento.id}.`);
      return;
    }

    const phone = formatPhoneNumber(client?.telefone || "");
    if (!phone) {
      console.warn(`[WhatsAppThankYouService] O cliente ${client.nome} (ID: ${client.id}) não possui telefone cadastrado. Agradecimento NÃO gerado para agendamento ${agendamento.id}.`);
      return;
    }

    // 5. Verificar se já existe um lembrete de agradecimento para este agendamento (prevenir duplicidade)
    const existing = await getWhatsappLembreteModel().findOne({
      where: {
        agendamento_id: agendamento.id,
        tipo_lembrete: 'agradecimento'
      }
    });

    if (existing) {
      console.log(`[WhatsAppThankYouService] Lembrete de agradecimento já existe para agendamento ${agendamento.id}. Ignorando.`);
      return;
    }

    // 6. Calcular data_programada = agora + tempo configurado em minutos
    const tempoMinutos = Number(config.agradecimento_tempo_minutos) || 30;
    const scheduledTime = addMinutes(new Date(), tempoMinutos);

    // 7. Criar o lembrete de agradecimento
    await getWhatsappLembreteModel().create({
      agendamento_id: agendamento.id,
      tipo_lembrete: 'agradecimento',
      data_programada: scheduledTime,
      status: 'Pendente',
      tentativas: 0
    });

    console.log(`[WhatsAppThankYouService] Lembrete de agradecimento criado para agendamento ${agendamento.id} programado para ${scheduledTime.toISOString()} (${tempoMinutos} min após conclusão).`);
  } catch (error) {
    console.error(`[WhatsAppThankYouService] Falha ao gerar lembrete de agradecimento para agendamento ${agendamento.id}:`, error);
  }
}
