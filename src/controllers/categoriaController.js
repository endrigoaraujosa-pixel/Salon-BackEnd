import { db } from '../config/db.js';

const listCategorias = async (req, res) => {
  try {
    const { tipo, ativo } = req.query;
    const where = { deletado: 'N' };
    if (tipo) {
      where.tipo = tipo;
    }
    
    if(ativo){
      where.ativo = ativo;
    }

    const categorias = await db.Categoria.findAll({
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
    const categoria = await db.Categoria.create(req.body);
    res.status(201).json(categoria);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateCategoria = async (req, res) => {
  try {
    const categoria = await db.Categoria.findByPk(req.params.id);
    if (!categoria) return res.status(404).json({ detail: 'Categoria não encontrada' });
    
    await categoria.update(req.body);
    res.json(categoria);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteCategoria = async (req, res) => {
  try {
    const categoria = await db.Categoria.findByPk(req.params.id);
    if (categoria) {
      await categoria.update({
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
  listCategorias,
  createCategoria,
  updateCategoria,
  deleteCategoria
};

