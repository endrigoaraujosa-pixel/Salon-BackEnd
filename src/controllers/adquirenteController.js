import { getAdquirenteModel } from '../models/Adquirente.js';
import { getTaxaCartaoModel } from '../models/TaxaCartao.js';
import { sequelize } from '../config/db.js';
import { Op } from 'sequelize';

const listAdquirentes = async (req, res) => {
  try {
    const { ativo } = req.query;
    const where = { deletado: 'N' };
    
    if (ativo !== undefined) {
      where.ativo = ativo === 'true' || ativo === true;
    }

    const adquirentes = await getAdquirenteModel().findAll({
      where,
      order: [['descricao', 'ASC']]
    });
    res.json(adquirentes);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createAdquirente = async (req, res) => {
  try {
    const { descricao, ativo, observacao } = req.body;
    
    if (!descricao || !descricao.trim()) {
      return res.status(400).json({ detail: 'A descrição da adquirente é obrigatória.' });
    }

    const descFormatada = descricao.trim();

    // Validar duplicidade de adquirente ativa com o mesmo nome (case insensitive)
    const existing = await getAdquirenteModel().findOne({
      where: {
        deletado: 'N',
        ativo: true,
        descricao: sequelize.where(
          sequelize.fn('lower', sequelize.col('descricao')),
          descFormatada.toLowerCase()
        )
      }
    });

    if (existing) {
      return res.status(400).json({ detail: 'Já existe uma adquirente ativa cadastrada com esta descrição.' });
    }

    const createdBy = req.user ? {
      criado_por_id: req.user.id,
      criado_por_nome: req.user.name,
      alterado_por_id: req.user.id,
      alterado_por_nome: req.user.name
    } : {};

    const adquirente = await getAdquirenteModel().create({
      descricao: descFormatada,
      ativo: ativo !== undefined ? ativo : true,
      observacao: observacao || null,
      ...createdBy
    });

    res.status(201).json(adquirente);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateAdquirente = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { descricao, ativo, observacao } = req.body;

    const adquirente = await getAdquirenteModel().findByPk(id, { transaction });
    if (!adquirente || adquirente.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Adquirente não encontrada.' });
    }

    if (descricao !== undefined) {
      if (!descricao || !descricao.trim()) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'A descrição da adquirente é obrigatória.' });
      }
      
      const descFormatada = descricao.trim();
      if (descFormatada.toLowerCase() !== adquirente.descricao.toLowerCase()) {
        // Validar duplicidade se o nome mudou
        const existing = await getAdquirenteModel().findOne({
          where: {
            deletado: 'N',
            ativo: true,
            id: { [Op.ne]: id },
            descricao: sequelize.where(
              sequelize.fn('lower', sequelize.col('descricao')),
              descFormatada.toLowerCase()
            )
          },
          transaction
        });

        if (existing) {
          await transaction.rollback();
          return res.status(400).json({ detail: 'Já existe uma adquirente ativa cadastrada com esta descrição.' });
        }
      }
      adquirente.descricao = descFormatada;
    }

    if (ativo !== undefined) {
      adquirente.ativo = ativo;
      // Se inativar a adquirente, inativamos as taxas vinculadas a ela
      if (!ativo) {
        await getTaxaCartaoModel().update(
          { ativo: false },
          { where: { adquirente_id: id }, transaction }
        );
      }
    }

    if (observacao !== undefined) {
      adquirente.observacao = observacao || null;
    }

    if (req.user) {
      adquirente.alterado_por_id = req.user.id;
      adquirente.alterado_por_nome = req.user.name;
    }

    await adquirente.save({ transaction });
    await transaction.commit();
    res.json(adquirente);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const deleteAdquirente = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const adquirente = await getAdquirenteModel().findByPk(id, { transaction });
    
    if (adquirente) {
      const deletedBy = req.user ? req.user.name : 'Sistema';
      
      await adquirente.update({
        deletado: 'S',
        deletado_por: deletedBy,
        deletado_em: new Date(),
        ativo: false
      }, { transaction });

      // Soft delete nas formas de pagamento vinculadas
      await getTaxaCartaoModel().update({
        deletado: 'S',
        deletado_por: deletedBy,
        deletado_em: new Date(),
        ativo: false
      }, { where: { adquirente_id: id }, transaction });
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

export {
  listAdquirentes,
  createAdquirente,
  updateAdquirente,
  deleteAdquirente
};
