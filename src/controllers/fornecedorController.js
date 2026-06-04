import { getFornecedorModel } from "../models/Fornecedor.js";
const listFornecedores = async (req, res) => {
  try {
    const where = { deletado: 'N' };
    const fornecedores = await getFornecedorModel().findAll({
      where,
      order: [['nome_razosocial', 'ASC']]
    });
    res.json(fornecedores);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createFornecedor = async (req, res) => {
  try {
    if (!req.body.nome_razosocial || !req.body.nome_razosocial.trim()) {
      return res.status(400).json({ detail: 'Nome/Razão Social é obrigatório.' });
    }
    const fornecedor = await getFornecedorModel().create(req.body);
    res.status(201).json(fornecedor);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateFornecedor = async (req, res) => {
  try {
    const fornecedor = await getFornecedorModel().findByPk(req.params.id);
    if (!fornecedor || fornecedor.deletado === 'S') {
      return res.status(404).json({ detail: 'Fornecedor não encontrado.' });
    }

    if (req.body.nome_razosocial && !req.body.nome_razosocial.trim()) {
      return res.status(400).json({ detail: 'Nome/Razão Social não pode ser vazio.' });
    }

    await fornecedor.update(req.body);
    res.json(fornecedor);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteFornecedor = async (req, res) => {
  try {
    const fornecedor = await getFornecedorModel().findByPk(req.params.id);
    if (fornecedor) {
      await fornecedor.update({
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
  createFornecedor, deleteFornecedor, listFornecedores, updateFornecedor
};

