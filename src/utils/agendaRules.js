import { Op } from 'sequelize';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { buildAgendaDayRange, formatAgendaDate, formatAgendaTime } from './agendaDateTime.js';

export async function verificarDisponibilidade({
  dataHoraNormalizada,
  duracaoTotalMinutos,
  profissionaisIds,
  excludeAgendamentoId = null
}) {
  const novoInicio = dataHoraNormalizada;
  const novoFim = new Date(novoInicio.getTime() + duracaoTotalMinutos * 60000);
  const dataBusca = formatAgendaDate(dataHoraNormalizada);
  const { start: dataInicioDia, end: dataFimDia } = buildAgendaDayRange(dataBusca);

  const where = {
    data_hora: { [Op.between]: [dataInicioDia, dataFimDia] },
    deletado: 'N',
  };

  if (excludeAgendamentoId) {
    where.id = { [Op.ne]: excludeAgendamentoId };
  }

  const existentes = await getAgendamentoModel().findAll({ where });

  // Verificar conflitos de agendamentos
  for (const ag of existentes) {
    const agInicio = new Date(ag.data_hora);
    const agFim = new Date(agInicio.getTime() + ag.duracao_minutos * 60000);

    const sobrepoe = agInicio < novoFim && agFim > novoInicio;

    if (sobrepoe) {
      const profsNoExistente = ag.profissionais.map(p => p.id);
      const conflito = profissionaisIds.some(id => profsNoExistente.includes(id));

      if (conflito) {
        const profConflitoId = profissionaisIds.find(id => profsNoExistente.includes(id));
        const profConflitoModel = await getColaboradorModel().findByPk(profConflitoId);
        const profConflitoNome = profConflitoModel ? profConflitoModel.nome : 'Profissional';
        throw new Error(`Conflito de horário: O profissional ${profConflitoNome} já possui um agendamento entre ${formatAgendaTime(agInicio)} e ${formatAgendaTime(agFim)}`);
      }
    }
  }

  // Verificar conflitos de indisponibilidade
  if (profissionaisIds.length > 0) {
    const { getColaboradorIndisponibilidadeModel } = await import('../models/ColaboradorIndisponibilidade.js');
    const indispList = await getColaboradorIndisponibilidadeModel().findAll({
      where: {
        colaborador_id: { [Op.in]: profissionaisIds },
        deletado: 'N',
        data_hora_inicio: { [Op.lt]: novoFim },
        data_hora_fim: { [Op.gt]: novoInicio }
      }
    });

    if (indispList.length > 0) {
      const { TZDate } = await import('@date-fns/tz');
      const { format } = await import('date-fns');
      const { AGENDA_TIME_ZONE } = await import('../utils/agendaDateTime.js');

      const conflitos = [];
      for (const indisp of indispList) {
        const colab = await getColaboradorModel().findByPk(indisp.colaborador_id);
        const colabNome = colab ? colab.nome : 'Colaborador';
        
        const dateStr = format(new TZDate(indisp.data_hora_inicio, AGENDA_TIME_ZONE), 'dd/MM/yyyy');
        const startStr = format(new TZDate(indisp.data_hora_inicio, AGENDA_TIME_ZONE), 'HH:mm');
        const endStr = format(new TZDate(indisp.data_hora_fim, AGENDA_TIME_ZONE), 'HH:mm');
        
        const motivoStr = indisp.motivo ? indisp.motivo : 'indisponibilidade registrada sem motivo específico';
        conflitos.push(`O colaborador ${colabNome} possui uma indisponibilidade cadastrada para o período selecionado (${dateStr} ${startStr} - ${endStr}). Motivo: ${motivoStr}`);
      }
      throw new Error(`Conflito de indisponibilidade: ${conflitos.join('; ')}`);
    }
  }
}
