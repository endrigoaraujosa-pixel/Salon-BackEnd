import { getMotivoMovimentacaoModel } from '../models/MotivoMovimentacao.js';

export const listMotivos = async (req, res) => {
  try {
    const Motivo = getMotivoMovimentacaoModel();
    const { tipo, apenas_ativos } = req.query;

    const where = {};
    if (tipo) {
      where.tipo = tipo;
    }
    if (apenas_ativos === 'true') {
      where.ativo = true;
    }

    const list = await Motivo.findAll({
      where,
      order: [['nome', 'ASC']]
    });

    res.json(list);
  } catch (error) {
    res.status(500).json({ detail: error.message || 'Erro ao listar motivos de movimentação.' });
  }
};

export const createMotivo = async (req, res) => {
  try {
    const Motivo = getMotivoMovimentacaoModel();
    const { nome, tipo, ativo } = req.body;

    if (!nome || !nome.trim()) {
      return res.status(400).json({ detail: 'O nome do motivo é obrigatório.' });
    }
    if (!tipo) {
      return res.status(400).json({ detail: 'O tipo do motivo é obrigatório.' });
    }

    const novo = await Motivo.create({
      nome: nome.trim(),
      tipo,
      ativo: ativo !== undefined ? ativo : true
    });

    res.status(201).json(novo);
  } catch (error) {
    res.status(500).json({ detail: error.message || 'Erro ao criar motivo de movimentação.' });
  }
};

export const updateMotivo = async (req, res) => {
  try {
    const Motivo = getMotivoMovimentacaoModel();
    const { id } = req.params;
    const { nome, tipo, ativo } = req.body;

    const motivo = await Motivo.findByPk(id);
    if (!motivo) {
      return res.status(404).json({ detail: 'Motivo não encontrado.' });
    }

    if (nome !== undefined) {
      if (!nome.trim()) {
        return res.status(400).json({ detail: 'O nome do motivo não pode ser vazio.' });
      }
      motivo.nome = nome.trim();
    }
    if (tipo !== undefined) {
      motivo.tipo = tipo;
    }
    if (ativo !== undefined) {
      motivo.ativo = ativo;
    }

    await motivo.save();
    res.json(motivo);
  } catch (error) {
    res.status(500).json({ detail: error.message || 'Erro ao atualizar motivo de movimentação.' });
  }
};
