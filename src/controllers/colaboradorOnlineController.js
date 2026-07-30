import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getColaboradorComissaoServicoModel } from '../models/ColaboradorComissaoServico.js';
import { getColaboradorOnlineDisponibilidadeModel } from '../models/ColaboradorOnlineDisponibilidade.js';
import { getServicoModel } from '../models/Servico.js';

/**
 * GET /configuracoes-online/colaboradores
 * Retorna todos os colaboradores ativos com suas configurações de agendamento online:
 *   - Flag agendamento_online_ativo
 *   - Serviços vinculados (com flag agendamento_online_ativo por serviço)
 *   - Horários de disponibilidade online individuais
 */
export const listColaboradoresOnline = async (req, res) => {
  try {
    const Colaborador = getColaboradorModel();
    const ColabServico = getColaboradorComissaoServicoModel();
    const ColabDisp = getColaboradorOnlineDisponibilidadeModel();
    const Servico = getServicoModel();

    // 1. Buscar todos os colaboradores ativos (não deletados)
    const colaboradores = await Colaborador.findAll({
      where: { ativo: true, deletado: 'N' },
      attributes: ['id', 'nome', 'foto', 'cargo', 'agendamento_online_ativo'],
      order: [['nome', 'ASC']]
    });

    // 2. Buscar todos os serviços ativos para referência
    const servicos = await Servico.findAll({
      where: { ativo: true, deletado: 'N' },
      attributes: ['id', 'nome', 'categoria_id'],
      order: [['nome', 'ASC']]
    });

    // 3. Para cada colaborador, buscar os vínculos de serviço e disponibilidades
    const result = [];
    for (const colab of colaboradores) {
      // Serviços vinculados ao colaborador (da tabela de comissão por serviço)
      const servicosVinculados = await ColabServico.findAll({
        where: { colaborador_id: colab.id },
        attributes: ['id', 'servico_id', 'agendamento_online_ativo']
      });

      // Mapear para incluir o nome do serviço
      const servicosMap = servicosVinculados.map(sv => {
        const servico = servicos.find(s => s.id === sv.servico_id);
        return {
          id: sv.id,
          servico_id: sv.servico_id,
          servico_nome: servico?.nome || '(Serviço removido)',
          agendamento_online_ativo: sv.agendamento_online_ativo
        };
      }).filter(sv => servicos.some(s => s.id === sv.servico_id)); // excluir serviços deletados

      // Disponibilidades do colaborador
      const disponibilidades = await ColabDisp.findAll({
        where: { colaborador_id: colab.id },
        order: [['dia_semana', 'ASC']],
        attributes: ['id', 'dia_semana', 'hora_inicio', 'hora_fim', 'ativo']
      });

      result.push({
        id: colab.id,
        nome: colab.nome,
        foto: colab.foto,
        cargo: colab.cargo,
        agendamento_online_ativo: colab.agendamento_online_ativo,
        servicos: servicosMap,
        disponibilidades: disponibilidades.map(d => d.toJSON())
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * PUT /configuracoes-online/colaboradores/:id
 * Atualiza as configurações de agendamento online de um colaborador:
 *   - agendamento_online_ativo (boolean)
 *   - servicos: [{ servico_id, agendamento_online_ativo }]
 *   - disponibilidades: [{ dia_semana, hora_inicio, hora_fim, ativo }]
 */
export const updateColaboradorOnline = async (req, res) => {
  try {
    const { id } = req.params;
    const { agendamento_online_ativo, servicos, disponibilidades } = req.body;

    const Colaborador = getColaboradorModel();
    const ColabServico = getColaboradorComissaoServicoModel();
    const ColabDisp = getColaboradorOnlineDisponibilidadeModel();

    // 1. Atualizar flag do colaborador
    const colab = await Colaborador.findByPk(id);
    if (!colab) {
      return res.status(404).json({ detail: 'Colaborador não encontrado.' });
    }

    if (agendamento_online_ativo !== undefined) {
      await colab.update({ agendamento_online_ativo });
    }

    // 2. Atualizar flags de serviços (agendamento_online_ativo por serviço)
    if (Array.isArray(servicos)) {
      for (const svc of servicos) {
        if (svc.servico_id) {
          await ColabServico.update(
            { agendamento_online_ativo: !!svc.agendamento_online_ativo },
            { where: { colaborador_id: id, servico_id: svc.servico_id } }
          );
        }
      }
    }

    // 3. Atualizar disponibilidades de horário
    if (Array.isArray(disponibilidades)) {
      // Remover antigas
      await ColabDisp.destroy({ where: { colaborador_id: id } });

      // Inserir novas
      const records = disponibilidades.map(d => ({
        id: uuidv4(),
        colaborador_id: id,
        dia_semana: d.dia_semana,
        hora_inicio: d.hora_inicio,
        hora_fim: d.hora_fim,
        ativo: d.ativo !== undefined ? d.ativo : true
      }));

      if (records.length > 0) {
        await ColabDisp.bulkCreate(records);
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};
