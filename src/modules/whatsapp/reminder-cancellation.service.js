import { Op } from 'sequelize';
import { sequelize } from '../../config/db.js';
import { getWhatsappLembreteModel } from '../../models/WhatsappLembrete.js';
import { getAgendamentoModel } from '../../models/Agendamento.js';
import { getClienteModel } from '../../models/Cliente.js';

export const MANUAL_CANCELLATION = 'Envio cancelado manualmente pelo histórico';

export async function changeReminderCancellation(id, cancel) {
  const Lembrete = getWhatsappLembreteModel();
  return sequelize.transaction(async transaction => {
    const reminder = await Lembrete.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!reminder) throw new Error('Mensagem não encontrada.');
    if (cancel) {
      if (!['Pendente', 'Falhou'].includes(reminder.status)) {
        throw new Error('Só é possível cancelar mensagens pendentes ou com falha. Atualize o histórico.');
      }
      await reminder.update({ status: 'CANC MANUAL', erro: MANUAL_CANCELLATION }, { transaction });
    } else {
      if (!['Cancelado', 'CANC MANUAL'].includes(reminder.status)) throw new Error('Esta mensagem não está cancelada. Atualize o histórico.');
      const type = reminder.tipo_lembrete.split('_cancelado_')[0];
      if (!['24h', '2h', '1h', 'agradecimento'].includes(type)) {
        throw new Error('Este registro foi substituído por outro lembrete e não pode ser reativado.');
      }
      const ag = await getAgendamentoModel().findByPk(reminder.agendamento_id, { transaction });
      if (!ag || ag.deletado === 'S') throw new Error('O atendimento foi excluído ou não existe.');
      if (type === 'agradecimento') {
        if (ag.status !== 'concluido') throw new Error('O agradecimento exige um atendimento concluído.');
      } else if (!['agendado', 'confirmado'].includes(ag.status) || new Date(ag.data_hora) <= new Date()) {
        throw new Error('O lembrete exige um atendimento futuro, agendado ou confirmado.');
      }
      const cliente = await getClienteModel().findByPk(ag.cliente_id, { transaction });
      if (!cliente || cliente.deletado === 'S' || !String(cliente.telefone || '').trim()) {
        throw new Error('O cliente deve estar ativo e possuir telefone cadastrado.');
      }
      const existing = await Lembrete.findOne({ where: {
        agendamento_id: reminder.agendamento_id, tipo_lembrete: type, id: { [Op.ne]: reminder.id }
      }, transaction });
      if (existing) throw new Error('Já existe outro lembrete deste tipo para o atendimento. Utilize o registro atual.');
      await reminder.update({
        status: 'Pendente', tipo_lembrete: type, tentativas: 0, erro: null,
        mensagem: null, data_envio: null
      }, { transaction });
    }
    return { ok: true, status: reminder.status };
  });
}
