import Categoria from '../models/Categoria.js';

const listCategorias = async (req, res) => {
  try {
    const { tipo } = req.query;
    const where = {};
    if (tipo) {
      where.tipo = tipo;
    }
    const categorias = await Categoria.findAll({
      where,
      order: [['nome', 'ASC']]
    });
    res.json(categorias);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createCategoria = async (req, res) => {
  try {
    const categoria = await Categoria.create(req.body);
    res.status(201).json(categoria);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateCategoria = async (req, res) => {
  try {
    const categoria = await Categoria.findByPk(req.params.id);
    if (!categoria) return res.status(404).json({ detail: 'Categoria não encontrada' });
    
    await categoria.update(req.body);
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteCategoria = async (req, res) => {
  try {
    const categoria = await Categoria.findByPk(req.params.id);
    if (categoria) await categoria.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listCategorias,
  createCategoria,
  updateCategoria,
  deleteCategoria
};
