import { getAgendamentoOnlineDisponibilidadeModel } from '../models/AgendamentoOnlineDisponibilidade.js';

export const listDisponibilidade = async (req, res) => {
  try {
    const Model = getAgendamentoOnlineDisponibilidadeModel();
    const records = await Model.findAll({
      order: [['dia_semana', 'ASC'], ['hora_inicio', 'ASC']]
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const saveDisponibilidade = async (req, res) => {
  try {
    const { disponibilidades } = req.body; // array de { dia_semana, hora_inicio, hora_fim, ativo }
    const Model = getAgendamentoOnlineDisponibilidadeModel();

    // Remove old ones
    await Model.destroy({ where: {} });

    if (Array.isArray(disponibilidades) && disponibilidades.length > 0) {
      await Model.bulkCreate(disponibilidades);
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};
