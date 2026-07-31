import { Op } from 'sequelize';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { buildAgendaDayRange, formatAgendaDate, formatAgendaTime, normalizeAgendaDateTime } from './agendaDateTime.js';

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
    status: { [Op.ne]: 'cancelado' }
  };

  if (excludeAgendamentoId) {
    where.id = { [Op.ne]: excludeAgendamentoId };
  }

  const existentes = await getAgendamentoModel().findAll({ where });

  // Verificar conflitos de agendamentos
  for (const ag of existentes) {
    const agInicio = normalizeAgendaDateTime(ag.data_hora);
    if (!agInicio || isNaN(agInicio.getTime())) continue;

    const agDuracao = Number(ag.duracao_minutos) || 0;
    const agFim = new Date(agInicio.getTime() + agDuracao * 60000);

    const sobrepoe = agInicio < novoFim && agFim > novoInicio;

    if (sobrepoe) {
      let profsArray = ag.profissionais;
      if (typeof profsArray === 'string') {
        try { profsArray = JSON.parse(profsArray); } catch (e) { profsArray = []; }
      }
      if (!Array.isArray(profsArray)) profsArray = [];

      const profsNoExistente = profsArray.map(p => {
        if (!p) return { id: '', nome: '' };
        if (typeof p === 'object') return { id: String(p.id || p.colaborador_id || ''), nome: p.nome || '' };
        return { id: String(p), nome: '' };
      }).filter(p => p.id);

      const targetIds = (profissionaisIds || []).map(id => String(id));

      const profEncontrado = profsNoExistente.find(p => targetIds.includes(p.id));

      if (profEncontrado) {
        let profConflitoNome = (profEncontrado.nome || '').trim();
        if (!profConflitoNome) {
          const profConflitoModel = await getColaboradorModel().findByPk(profEncontrado.id);
          profConflitoNome = (profConflitoModel?.nome || '').trim() || 'Profissional';
        }

        const inicioStr = formatAgendaTime(agInicio) || '--:--';
        const fimStr = formatAgendaTime(agFim) || '--:--';

        throw new Error(`Conflito de horário: O profissional ${profConflitoNome} já possui um agendamento entre ${inicioStr} e ${fimStr}`);
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
