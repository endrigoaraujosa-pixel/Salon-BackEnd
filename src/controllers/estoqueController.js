import { sequelize } from '../config/db.js';
import Produto from '../models/Produto.js';
import EntradaEstoque from '../models/EntradaEstoque.js';
import EntradaEstoqueItem from '../models/EntradaEstoqueItem.js';
import MovimentacaoEstoque from '../models/MovimentacaoEstoque.js';

// List all stock entries
const listEntradas = async (req, res) => {
  try {
    const entradas = await EntradaEstoque.findAll({
      order: [['data_entrada', 'DESC'], ['createdAt', 'DESC']]
    });
    res.json(entradas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Get details of a single stock entry
const getEntradaDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const entrada = await EntradaEstoque.findByPk(id);
    if (!entrada) {
      return res.status(404).json({ detail: 'Entrada de estoque não encontrada.' });
    }
    const itens = await EntradaEstoqueItem.findAll({
      where: { entrada_estoque_id: id }
    });
    res.json({
      ...entrada.toJSON(),
      itens
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Register a new stock entry
const registrarEntrada = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { fornecedor_id, fornecedor_nome, data_entrada, numero_nota, serie_nota, observacoes, itens } = req.body;

    if (!fornecedor_nome || !data_entrada || !itens || !Array.isArray(itens) || itens.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Os campos Fornecedor, Data da Entrada e Itens são obrigatórios.' });
    }

    if (!numero_nota || !numero_nota.trim()) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'O campo Número da Nota (NF) é obrigatório.' });
    }

    if (!serie_nota || !serie_nota.trim()) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'O campo Série da Nota Fiscal é obrigatório.' });
    }

    // Check composite unique index (Supplier + NF + Series) to prevent duplicate entries
    const duplicateQuery = {
      numero_nota: numero_nota.trim(),
      serie_nota: serie_nota.trim()
    };
    if (fornecedor_id) {
      duplicateQuery.fornecedor_id = fornecedor_id;
    } else {
      duplicateQuery.fornecedor_nome = fornecedor_nome.trim();
    }

    const existingDuplicate = await EntradaEstoque.findOne({
      where: duplicateQuery,
      transaction
    });
    if (existingDuplicate) {
      await transaction.rollback();
      return res.status(400).json({ 
        detail: `Duplicidade detectada! Já existe uma entrada para este Fornecedor com a mesma Nota Fiscal (${numero_nota.trim()}) e Série (${serie_nota.trim()}).` 
      });
    }

    let valorTotal = 0;
    const processedItens = [];

    // Create the stock entry record (Sequelize will auto-generate UUID for id)
    const entrada = await EntradaEstoque.create({
      fornecedor_id,
      fornecedor_nome,
      data_entrada,
      numero_nota: numero_nota.trim(),
      serie_nota: serie_nota.trim(),
      observacoes: observacoes || '',
      valor_total: 0 // Will update below
    }, { transaction });

    for (const item of itens) {
      const { produto_id, quantidade, valor_custo } = item;

      if (!produto_id || quantidade === undefined || valor_custo === undefined) {
        await transaction.rollback();
        return res.status(400).json({ detail: 'Dados de item incompletos. Informe Produto, Quantidade e Custo.' });
      }

      const qte = Number(Number(quantidade).toFixed(3));
      const custo = Number(Number(valor_custo).toFixed(2));
      const subtotal = Number((qte * custo).toFixed(2));
      valorTotal += subtotal;

      const product = await Produto.findByPk(produto_id, { transaction });
      if (!product || product.deletado === 'S') {
        await transaction.rollback();
        return res.status(404).json({ detail: `Produto ID ${produto_id} não encontrado ou inativo.` });
      }

      const qtdAnterior = product.quantidade_estoque || 0;
      const qtdAtual = Number((qtdAnterior + qte).toFixed(3));

      // Update product quantity, unit cost, and supplier name
      await product.update({
        quantidade_estoque: qtdAtual,
        custo_unitario: custo,
        fornecedor: fornecedor_nome
      }, { transaction });

      // Save item details
      const itemRecord = await EntradaEstoqueItem.create({
        entrada_estoque_id: entrada.id,
        produto_id,
        produto_nome: product.nome,
        quantidade: qte,
        valor_custo: custo,
        subtotal
      }, { transaction });

      processedItens.push(itemRecord);

      // Log the movement for traceability
      await MovimentacaoEstoque.create({
        produto_id,
        produto_nome: product.nome,
        tipo: 'entrada',
        quantidade: qte,
        quantidade_anterior: qtdAnterior,
        quantidade_atual: qtdAtual,
        valor_unitario: custo,
        motivo: `Entrada de mercadoria - NF: ${numero_nota.trim()} (Série: ${serie_nota.trim()})`,
        referencia_id: entrada.id
      }, { transaction });
    }

    // Update total entry value
    await entrada.update({ valor_total: valorTotal }, { transaction });

    await transaction.commit();

    res.status(201).json({
      ok: true,
      entrada: {
        ...entrada.toJSON(),
        itens: processedItens
      }
    });
  } catch (error) {
    await transaction.rollback();
    if (error.name === 'SequelizeUniqueConstraintError' || error.message?.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ 
        detail: `Duplicidade detectada! Já existe uma entrada registrada para este Fornecedor com a mesma Nota Fiscal e Série.` 
      });
    }
    res.status(500).json({ detail: error.message });
  }
};

// Register physical inventory / adjustment
const registrarAjusteInventario = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { produto_id, quantidade_contada, observacoes } = req.body;

    if (!produto_id || quantidade_contada === undefined) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Produto e quantidade contada são obrigatórios.' });
    }

    const product = await Produto.findByPk(produto_id, { transaction });
    if (!product || product.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Produto não encontrado ou inativo.' });
    }

    const qtdAnterior = product.quantidade_estoque || 0;
    const qtdAtual = Number(Number(quantidade_contada).toFixed(3));
    const diferenca = Number((qtdAtual - qtdAnterior).toFixed(3));

    // If difference is 0, no stock update is strictly needed, but let's allow saving the adjustment record if desired.
    await product.update({
      quantidade_estoque: qtdAtual
    }, { transaction });

    // Log the adjustment movement for full traceability
    const movement = await MovimentacaoEstoque.create({
      produto_id,
      produto_nome: product.nome,
      tipo: 'ajuste',
      quantidade: diferenca,
      quantidade_anterior: qtdAnterior,
      quantidade_atual: qtdAtual,
      valor_unitario: product.custo_unitario || 0,
      motivo: observacoes || `Ajuste de Inventário (Diferença de ${diferenca > 0 ? '+' : ''}${diferenca})`
    }, { transaction });

    await transaction.commit();

    res.json({
      ok: true,
      diferenca,
      produto: product,
      movimentacao: movement
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

// List all stock movements (traceability history)
const listMovimentacoes = async (req, res) => {
  try {
    const movements = await MovimentacaoEstoque.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(movements);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listEntradas,
  getEntradaDetail,
  registrarEntrada,
  registrarAjusteInventario,
  listMovimentacoes
};
