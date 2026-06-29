import { Op } from 'sequelize';
import { getColaboradorIndisponibilidadeModel } from '../models/ColaboradorIndisponibilidade.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { sequelize } from '../config/db.js';
import { normalizeAgendaDateTime, buildAgendaDayRange } from '../utils/agendaDateTime.js';

export const createIndisponibilidade = async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const { colaborador_id, data_hora_inicio, data_hora_fim, motivo } = req.body;

  if (!colaborador_id) {
    return res.status(400).json({ detail: 'Selecione um colaborador.' });
  }
  if (!data_hora_inicio || !data_hora_fim) {
    return res.status(400).json({ detail: 'Selecione as datas/horários de início e fim.' });
  }



  if (motivo && motivo.length > 200) {
    return res.status(400).json({ detail: 'O motivo deve ter no máximo 200 caracteres.' });
  }

  const inicio = normalizeAgendaDateTime(data_hora_inicio);
  const fim = normalizeAgendaDateTime(data_hora_fim);

  if (inicio.getTime() >= fim.getTime()) {
    return res.status(400).json({ detail: 'A data/hora de início deve ser anterior à data/hora de fim.' });
  }

  const transaction = await sequelize.transaction();
  try {
    const colab = await getColaboradorModel().findByPk(colaborador_id, { transaction });
    if (!colab) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Colaborador não encontrado.' });
    }

    const overlap = await getColaboradorIndisponibilidadeModel().findOne({
      where: {
        colaborador_id,
        deletado: 'N',
        data_hora_inicio: { [Op.lt]: fim },
        data_hora_fim: { [Op.gt]: inicio }
      },
      transaction
    });

    if (overlap) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Este colaborador já possui um período de indisponibilidade registrado que se sobrepõe ao período informado.' });
    }

    const record = await getColaboradorIndisponibilidadeModel().create({
      colaborador_id,
      data_hora_inicio: inicio,
      data_hora_fim: fim,
      motivo: motivo || null,
      criado_por_id: req.user?.id || null,
      criado_por_nome: req.user?.name || null
    }, { transaction });

    await transaction.commit();
    return res.status(201).json(record);
  } catch (err) {
    await transaction.rollback();
    return res.status(500).json({ detail: err.message });
  }
};

export const updateIndisponibilidade = async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const { id } = req.params;
  const { colaborador_id, data_hora_inicio, data_hora_fim, motivo } = req.body;

  if (!data_hora_inicio || !data_hora_fim) {
    return res.status(400).json({ detail: 'Selecione as datas/horários de início e fim.' });
  }

  const record = await getColaboradorIndisponibilidadeModel().findByPk(id);
  if (!record || record.deletado === 'S') {
    return res.status(404).json({ detail: 'Registro de indisponibilidade não encontrado.' });
  }

  const targetColabId = colaborador_id || record.colaborador_id;



  if (motivo && motivo.length > 200) {
    return res.status(400).json({ detail: 'O motivo deve ter no máximo 200 caracteres.' });
  }

  const inicio = normalizeAgendaDateTime(data_hora_inicio);
  const fim = normalizeAgendaDateTime(data_hora_fim);

  if (inicio.getTime() >= fim.getTime()) {
    return res.status(400).json({ detail: 'A data/hora de início deve ser anterior à data/hora de fim.' });
  }

  const transaction = await sequelize.transaction();
  try {
    const colab = await getColaboradorModel().findByPk(targetColabId, { transaction });
    if (!colab) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Colaborador não encontrado.' });
    }

    const overlap = await getColaboradorIndisponibilidadeModel().findOne({
      where: {
        colaborador_id: targetColabId,
        deletado: 'N',
        id: { [Op.ne]: id },
        data_hora_inicio: { [Op.lt]: fim },
        data_hora_fim: { [Op.gt]: inicio }
      },
      transaction
    });

    if (overlap) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Este colaborador já possui um período de indisponibilidade registrado que se sobrepõe ao período informado.' });
    }

    await record.update({
      colaborador_id: targetColabId,
      data_hora_inicio: inicio,
      data_hora_fim: fim,
      motivo: motivo || null
    }, { transaction });

    await transaction.commit();
    return res.json(record);
  } catch (err) {
    await transaction.rollback();
    return res.status(500).json({ detail: err.message });
  }
};

export const listIndisponibilidades = async (req, res) => {
  const { data, colaborador_id, data_inicio, data_fim } = req.query;

  if (!data && !colaborador_id && (!data_inicio || !data_fim)) {
    return res.status(400).json({ detail: 'Filtro obrigatório ausente. Informe a data, o colaborador_id ou o período (data_inicio e data_fim).' });
  }

  const where = { deletado: 'N' };
  if (colaborador_id) {
    where.colaborador_id = colaborador_id;
  }

  if (data) {
    const { start, end } = buildAgendaDayRange(data);
    where.data_hora_inicio = { [Op.lt]: end };
    where.data_hora_fim = { [Op.gt]: start };
  } else if (data_inicio && data_fim) {
    const start = normalizeAgendaDateTime(`${data_inicio}T00:00:00`);
    const end = normalizeAgendaDateTime(`${data_fim}T23:59:59`);
    where.data_hora_inicio = { [Op.lt]: end };
    where.data_hora_fim = { [Op.gt]: start };
  }

  try {
    const list = await getColaboradorIndisponibilidadeModel().findAll({
      where,
      order: [['data_hora_inicio', 'ASC']]
    });
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};

export const deleteIndisponibilidade = async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const { id } = req.params;

  try {
    const record = await getColaboradorIndisponibilidadeModel().findByPk(id);
    if (!record || record.deletado === 'S') {
      return res.status(404).json({ detail: 'Registro de indisponibilidade não encontrado.' });
    }

    // Allow admin to delete any record; otherwise restrict to own records
    if (!isAdmin && record.colaborador_id !== req.user?.colaborador_id) {
      return res.status(403).json({ detail: 'Você não tem permissão para excluir a indisponibilidade de outro colaborador.' });
    }

    await record.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
};
