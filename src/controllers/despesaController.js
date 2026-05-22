import Despesa from '../models/Despesa.js';

const listDespesas = async (req, res) => {
  try {
    const despesas = await Despesa.findAll({
      where: { deletado: 'N' },
      order: [['data_vencimento', 'DESC']]
    });
    res.json(despesas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createDespesa = async (req, res) => {
  try {
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (!req.body.descricao || !String(req.body.descricao).trim()) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    const despesa = await Despesa.create(req.body);
    res.status(201).json(despesa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateDespesa = async (req, res) => {
  try {
    const despesa = await Despesa.findByPk(req.params.id);
    if (!despesa) return res.status(404).json({ detail: 'Despesa não encontrada' });
    
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (req.body.descricao !== undefined && (!req.body.descricao || !String(req.body.descricao).trim())) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    
    await despesa.update(req.body);
    res.json(despesa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteDespesa = async (req, res) => {
  try {
    const despesa = await Despesa.findByPk(req.params.id);
    if (despesa) {
      await despesa.update({
        deletado: 'S',
        deletado_por: req.user ? req.user.name : 'Sistema',
        deletado_em: new Date()
      });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listDespesas,
  createDespesa,
  updateDespesa,
  deleteDespesa
};
