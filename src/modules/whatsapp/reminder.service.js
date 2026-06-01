import WhatsappConfig from '../../models/WhatsappConfig.js';
import WhatsappLembrete from '../../models/WhatsappLembrete.js';
import Cliente from '../../models/Cliente.js';
import { DEFAULT_TEMPLATE } from './templates/reminder.template.js';
import { sequelize } from '../../config/db.js';

/**
 * Gera os lembretes automáticos na tabela whatsapp_lembretes para um agendamento.
 * @param {object} agendamento - Objeto do agendamento criado ou editado.
 */
export async function generateReminders(agendamento) {
  try {
    // 1. Consultar configurações do WhatsApp.
    let config = await WhatsappConfig.findOne();
    if (!config) {
      config = await WhatsappConfig.create({
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
    const client = await Cliente.findByPk(agendamento.cliente_id);
    if (!client) {
      console.error(`[WhatsAppReminderService] Cliente ID ${agendamento.cliente_id} não encontrado para o agendamento ${agendamento.id}.`);
      return;
    }

    const phone = (client.telefone || "").trim();
    if (!phone) {
      // Validação de Telefone: Caso o cliente não possua telefone cadastrado: Não gerar lembrete. Registrar ocorrência em log.
      console.warn(`[WhatsAppReminderService] O cliente ${client.nome} (ID: ${client.id}) não possui telefone cadastrado. Lembrete NÃO gerado para agendamento ${agendamento.id}.`);
      return;
    }

    // Cancelar/renomear lembretes antigos pendentes para evitar violação do índice único
    // "Ao alterar data ou hora: 1. Cancelar lembretes antigos. 2. Gerar novos lembretes com base na nova data."
    await WhatsappLembrete.update(
      {
        status: 'Cancelado',
        tipo_lembrete: sequelize.literal("tipo_lembrete || '_cancelado_' || id")
      },
      {
        where: {
          agendamento_id: agendamento.id,
          status: 'Pendente'
        }
      }
    );

    // 3. Identificar lembretes habilitados.
    const activeReminders = [];
    if (Number(config.lembrete_24h) === 1) activeReminders.push({ type: '24h', hoursBefore: 24 });
    if (Number(config.lembrete_2h) === 1) activeReminders.push({ type: '2h', hoursBefore: 2 });
    if (Number(config.lembrete_1h) === 1) activeReminders.push({ type: '1h', hoursBefore: 1 });

    const appointmentDate = new Date(agendamento.data_hora);

    for (const item of activeReminders) {
      // Calcular data_programada
      const scheduledTime = new Date(appointmentDate.getTime() - item.hoursBefore * 60 * 60 * 1000);

      // Apenas gera se a data_programada for no futuro
      if (scheduledTime > new Date()) {
        try {
          // Prevenção de duplicidade: checar se já existe um lembrete idêntico ativo (por garantia)
          const existing = await WhatsappLembrete.findOne({
            where: {
              agendamento_id: agendamento.id,
              tipo_lembrete: item.type
            }
          });

          if (!existing) {
            await WhatsappLembrete.create({
              agendamento_id: agendamento.id,
              tipo_lembrete: item.type,
              data_programada: scheduledTime,
              status: 'Pendente',
              tentativas: 0
            });
            console.log(`[WhatsAppReminderService] Lembrete ${item.type} criado para agendamento ${agendamento.id} para ${scheduledTime.toISOString()}.`);
          } else {
            // Se já existe e não foi enviado, atualiza
            if (existing.status !== 'Enviado') {
              existing.data_programada = scheduledTime;
              existing.status = 'Pendente';
              existing.tentativas = 0;
              existing.mensagem = null;
              existing.erro = null;
              await existing.save();
              console.log(`[WhatsAppReminderService] Lembrete ${item.type} atualizado para agendamento ${agendamento.id} para ${scheduledTime.toISOString()}.`);
            }
          }
        } catch (err) {
          console.error(`[WhatsAppReminderService] Erro ao criar lembrete ${item.type} para agendamento ${agendamento.id}:`, err);
        }
      } else {
        console.log(`[WhatsAppReminderService] Lembrete ${item.type} para agendamento ${agendamento.id} não criado pois a data programada (${scheduledTime.toISOString()}) seria no passado.`);
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
    const [count] = await WhatsappLembrete.update(
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
