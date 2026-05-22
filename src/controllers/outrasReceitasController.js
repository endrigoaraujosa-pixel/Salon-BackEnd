import OutrasReceitas from '../models/OutrasReceitas.js';

const listReceitas = async (req, res) => {
  try {
    const receitas = await OutrasReceitas.findAll({
      where: { deletado: 'N' },
      order: [['data_recebimento', 'DESC']]
    });
    res.json(receitas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createReceita = async (req, res) => {
  try {
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (!req.body.descricao || !String(req.body.descricao).trim()) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    const receita = await OutrasReceitas.create(req.body);
    res.status(201).json(receita);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateReceita = async (req, res) => {
  try {
    const receita = await OutrasReceitas.findByPk(req.params.id);
    if (!receita) return res.status(404).json({ detail: 'Receita não encontrada' });
    
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (req.body.descricao !== undefined && (!req.body.descricao || !String(req.body.descricao).trim())) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    
    await receita.update(req.body);
    res.json(receita);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteReceita = async (req, res) => {
  try {
    const receita = await OutrasReceitas.findByPk(req.params.id);
    if (receita) {
      await receita.update({
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
  listReceitas,
  createReceita,
  updateReceita,
  deleteReceita
};
