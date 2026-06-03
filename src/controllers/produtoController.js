import { db } from "../config/db.js";
const listProd = async (req, res) => {
  try {
    const prods = await db.Produto.findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });
    res.json(prods);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createProd = async (req, res) => {
  try {
    const { categoria_id } = req.body;
    if (!categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    if (req.body.quantidade_estoque !== undefined) {
      req.body.quantidade_estoque = Number(Number(req.body.quantidade_estoque || 0).toFixed(3));
    }
    if (req.body.estoque_minimo !== undefined) {
      req.body.estoque_minimo = Number(Number(req.body.estoque_minimo || 0).toFixed(3));
    }
    const prod = await db.Produto.create(req.body);
    res.status(201).json(prod);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateProd = async (req, res) => {
  try {
    const { categoria_id } = req.body;
    if (categoria_id !== undefined && !categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    const prod = await db.Produto.findByPk(req.params.pid);
    if (!prod) return res.status(404).json({ detail: 'Produto não encontrado' });
    
    if (req.body.quantidade_estoque !== undefined) {
      req.body.quantidade_estoque = Number(Number(req.body.quantidade_estoque || 0).toFixed(3));
    }
    if (req.body.estoque_minimo !== undefined) {
      req.body.estoque_minimo = Number(Number(req.body.estoque_minimo || 0).toFixed(3));
    }
    await prod.update(req.body);
    res.json(prod);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteProd = async (req, res) => {
  try {
    const prod = await db.Produto.findByPk(req.params.pid);
    if (prod) {
      await prod.update({
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

export { listProd, createProd, updateProd, deleteProd };
