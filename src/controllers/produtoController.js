import { getProdutoModel } from "../models/Produto.js";
import { sequelize } from "../config/db.js";
import { Op } from "sequelize";

const listProd = async (req, res) => {
  try {
    const { paginate, page = '1', limit = '25', search = '', only_low_stock } = req.query;
    const Produto = getProdutoModel();
    const where = { deletado: 'N' };

    if (search.trim()) {
      where[Op.or] = [
        { nome: { [Op.iLike]: `%${search.trim()}%` } },
        { fornecedor: { [Op.iLike]: `%${search.trim()}%` } }
      ];
    }

    if (only_low_stock === 'true') {
      where[Op.and] = [
        sequelize.where(sequelize.col('quantidade_estoque'), Op.lte, sequelize.col('estoque_minimo'))
      ];
    }

    if (paginate !== 'true') {
      const prods = await Produto.findAll({ where, order: [['nome', 'ASC']] });
      return res.json(prods);
    }

    const currentPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(limit, 10) || 25));
    const [result, summary] = await Promise.all([
      Produto.findAndCountAll({
        where,
        order: [['nome', 'ASC']],
        limit: pageSize,
        offset: (currentPage - 1) * pageSize
      }),
      Produto.findOne({
        where: { deletado: 'N' },
        attributes: [
          [sequelize.fn('COUNT', sequelize.col('id')), 'totalProdutos'],
          [sequelize.literal('COALESCE(SUM(CASE WHEN quantidade_por_unidade > 0 THEN quantidade_estoque / quantidade_por_unidade ELSE quantidade_estoque END), 0)'), 'totalItens'],
          [sequelize.literal('COALESCE(SUM(CASE WHEN quantidade_por_unidade > 0 THEN quantidade_estoque * custo_unitario / quantidade_por_unidade ELSE quantidade_estoque * custo_unitario END), 0)'), 'totalValor'],
          [sequelize.literal('COALESCE(SUM(CASE WHEN quantidade_estoque <= estoque_minimo THEN 1 ELSE 0 END), 0)'), 'alertaBaixoEstoque']
        ],
        raw: true
      })
    ]);

    res.json({
      data: result.rows,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total: result.count,
        totalPages: Math.max(1, Math.ceil(result.count / pageSize))
      },
      summary: {
        totalProdutos: Number(summary?.totalProdutos || 0),
        totalItens: Number(summary?.totalItens || 0),
        totalValor: Number(summary?.totalValor || 0),
        alertaBaixoEstoque: Number(summary?.alertaBaixoEstoque || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createProd = async (req, res) => {
  try {
    const { categoria_id, uso_exclusivo_servicos, ocultar_insumos, nome } = req.body;
    if (!categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    if (uso_exclusivo_servicos && ocultar_insumos) {
      return res.status(400).json({ detail: 'Um produto não pode ser de uso exclusivo em serviços e ao mesmo tempo oculto no lançamento de insumos.' });
    }
    if (nome) {
      const existing = await getProdutoModel().findOne({
        where: {
          nome: sequelize.where(sequelize.fn('LOWER', sequelize.col('nome')), nome.trim().toLowerCase()),
          deletado: 'N'
        }
      });
      if (existing) {
        return res.status(400).json({ detail: 'Já existe um produto cadastrado com este nome.' });
      }
    }
    if (req.body.quantidade_estoque !== undefined) {
      req.body.quantidade_estoque = Number(Number(req.body.quantidade_estoque || 0).toFixed(3));
    }
    if (req.body.estoque_minimo !== undefined) {
      req.body.estoque_minimo = Number(Number(req.body.estoque_minimo || 0).toFixed(3));
    }
    if (req.body.quantidade_por_unidade !== undefined) {
      req.body.quantidade_por_unidade = Number(Number(req.body.quantidade_por_unidade || 0).toFixed(4));
    }
    const prod = await getProdutoModel().create(req.body);
    res.status(201).json(prod);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateProd = async (req, res) => {
  try {
    const { categoria_id, uso_exclusivo_servicos, ocultar_insumos, nome } = req.body;
    if (categoria_id !== undefined && !categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    if (nome) {
      const existing = await getProdutoModel().findOne({
        where: {
          nome: sequelize.where(sequelize.fn('LOWER', sequelize.col('nome')), nome.trim().toLowerCase()),
          deletado: 'N',
          id: { [Op.ne]: req.params.pid }
        }
      });
      if (existing) {
        return res.status(400).json({ detail: 'Já existe um produto cadastrado com este nome.' });
      }
    }
    const prod = await getProdutoModel().findByPk(req.params.pid);
    if (!prod) return res.status(404).json({ detail: 'Produto não encontrado' });

    const finalUsoExclusivo = uso_exclusivo_servicos !== undefined ? uso_exclusivo_servicos : prod.uso_exclusivo_servicos;
    const finalOcultarInsumos = ocultar_insumos !== undefined ? ocultar_insumos : prod.ocultar_insumos;
    if (finalUsoExclusivo && finalOcultarInsumos) {
      return res.status(400).json({ detail: 'Um produto não pode ser de uso exclusivo em serviços e ao mesmo tempo oculto no lançamento de insumos.' });
    }

    if (req.body.quantidade_estoque !== undefined) {
      req.body.quantidade_estoque = Number(Number(req.body.quantidade_estoque || 0).toFixed(3));
    }
    if (req.body.estoque_minimo !== undefined) {
      req.body.estoque_minimo = Number(Number(req.body.estoque_minimo || 0).toFixed(3));
    }
    if (req.body.quantidade_por_unidade !== undefined) {
      req.body.quantidade_por_unidade = Number(Number(req.body.quantidade_por_unidade || 0).toFixed(4));
    }
    await prod.update(req.body);
    res.json(prod);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteProd = async (req, res) => {
  try {
    const prod = await getProdutoModel().findByPk(req.params.pid);
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
