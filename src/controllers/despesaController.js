import Despesa from '../models/Despesa.js';

const listDespesas = async (req, res) => {
  try {
    const despesas = await Despesa.findAll({ order: [['data_vencimento', 'DESC']] });
    res.json(despesas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createDespesa = async (req, res) => {
  try {
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
    
    await despesa.update(req.body);
    res.json(despesa);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteDespesa = async (req, res) => {
  try {
    const despesa = await Despesa.findByPk(req.params.id);
    if (despesa) await despesa.destroy();
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
