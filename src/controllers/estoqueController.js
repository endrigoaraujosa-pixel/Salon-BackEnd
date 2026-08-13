import { sequelize } from '../config/db.js';
import { getEntradaEstoqueModel } from '../models/EntradaEstoque.js';
import { getEntradaEstoqueItemModel } from '../models/EntradaEstoqueItem.js';
import { getMovimentacaoEstoqueModel } from '../models/MovimentacaoEstoque.js';
import { getProdutoModel } from '../models/Produto.js';
import { getMotivoMovimentacaoModel } from '../models/MotivoMovimentacao.js';
import { getInventarioProtocoloModel } from '../models/InventarioProtocolo.js';
import { Op } from 'sequelize';
import bcrypt from 'bcryptjs';
import { getUserModel } from '../models/User.js';
import { getPerfilAcessoModel } from '../models/PerfilAcesso.js';
import { getDespesaModel } from '../models/Despesa.js';

// List all stock entries
const listEntradas = async (req, res) => {
  try {
    const entradas = await getEntradaEstoqueModel().findAll({
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
    const entrada = await getEntradaEstoqueModel().findByPk(id);
    if (!entrada) {
      return res.status(404).json({ detail: 'Entrada de estoque não encontrada.' });
    }
    const itens = await getEntradaEstoqueItemModel().findAll({
      where: { entrada_estoque_id: id }
    });
    const despesas = await getDespesaModel().findAll({
      where: { entrada_estoque_id: id, deletado: 'N' }
    });
    res.json({
      ...entrada.toJSON(),
      itens,
      despesas
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Register a new stock entry
const registrarEntrada = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { 
      fornecedor_id, 
      fornecedor_nome, 
      data_entrada, 
      numero_nota, 
      serie_nota, 
      observacoes, 
      itens,
      natureza_operacao = 'compra_prazo',
      gerar_financeiro = true,
      condicao_pagamento = 'avista',
      qtd_parcelas = 1,
      vencimento_primeira_parcela,
      categoria_despesa = 'Suprimentos'
    } = req.body;

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

    const existingDuplicate = await getEntradaEstoqueModel().findOne({
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

    // Create the stock entry record
    const entrada = await getEntradaEstoqueModel().create({
      fornecedor_id,
      fornecedor_nome,
      data_entrada,
      numero_nota: numero_nota.trim(),
      serie_nota: serie_nota.trim(),
      observacoes: observacoes || '',
      valor_total: 0, // Will update below
      natureza_operacao,
      gerar_financeiro: !!gerar_financeiro,
      condicao_pagamento: condicao_pagamento || 'avista',
      qtd_parcelas: parseInt(qtd_parcelas) || 1,
      usuario_id: req.user ? req.user.id : null,
      usuario_nome: req.user ? req.user.name : null
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

      const product = await getProdutoModel().findByPk(produto_id, { transaction });
      if (!product || product.deletado === 'S') {
        await transaction.rollback();
        return res.status(404).json({ detail: `Produto ID ${produto_id} não encontrado ou inativo.` });
      }

      const qtyPerUnit = Number(product.quantidade_por_unidade || 0);
      const qteReal = qtyPerUnit > 0 ? Number((qte * qtyPerUnit).toFixed(3)) : qte;

      const qtdAnterior = product.quantidade_estoque || 0;
      const qtdAtual = Number((qtdAnterior + qteReal).toFixed(3));

      // Update product quantity, unit cost, and supplier name
      await product.update({
        quantidade_estoque: qtdAtual,
        custo_unitario: custo,
        fornecedor: fornecedor_nome
      }, { transaction });

      // Save item details
      const itemRecord = await getEntradaEstoqueItemModel().create({
        entrada_estoque_id: entrada.id,
        produto_id,
        produto_nome: product.nome,
        quantidade: qte,
        valor_custo: custo,
        subtotal
      }, { transaction });

      processedItens.push(itemRecord);

      // Log the movement for traceability
      await getMovimentacaoEstoqueModel().create({
        produto_id,
        produto_nome: product.nome,
        tipo: 'entrada',
        quantidade: qteReal,
        quantidade_anterior: qtdAnterior,
        quantidade_atual: qtdAtual,
        valor_unitario: custo,
        motivo: `Entrada de mercadoria (${natureza_operacao}) - NF: ${numero_nota.trim()} (Série: ${serie_nota.trim()})`,
        referencia_id: entrada.id,
        usuario_id: req.user ? req.user.id : null,
        usuario_nome: req.user ? req.user.name : null
      }, { transaction });
    }

    // Update total entry value
    await entrada.update({ valor_total: valorTotal }, { transaction });

    // Financial entry logic conditioned by Natureza da Operação
    const isNonFinancialOp = ['bonificacao', 'garantia', 'troca', 'transferencia'].includes(natureza_operacao);
    const shouldCreateExpenses = !!gerar_financeiro && !isNonFinancialOp && valorTotal > 0;
    const createdDespesas = [];

    if (shouldCreateExpenses) {
      const category = categoria_despesa || 'Suprimentos';
      const docNum = numero_nota.trim();
      const supplier = fornecedor_nome.trim();

      if (natureza_operacao === 'compra_vista') {
        const despesa = await getDespesaModel().create({
          descricao: `Compra de Produtos - NF ${docNum} (À Vista)`,
          valor: valorTotal,
          tipo: 'variavel',
          categoria: category,
          data_documento: data_entrada,
          data_vencimento: data_entrada,
          data_pagamento: data_entrada,
          pago: true,
          status: 'Pago',
          numero_documento: docNum,
          fornecedor: supplier,
          baixado_por: req.user ? req.user.name : 'Sistema',
          baixado_em: new Date(),
          observacoes: `Lançamento automático via Entrada de Estoque (NF ${docNum})`,
          entrada_estoque_id: entrada.id
        }, { transaction });
        createdDespesas.push(despesa);
      } else if (natureza_operacao === 'compra_prazo') {
        const numParcelas = Math.max(1, parseInt(qtd_parcelas) || 1);
        const valorBase = Math.floor((valorTotal / numParcelas) * 100) / 100;
        const diff = Number((valorTotal - (valorBase * numParcelas)).toFixed(2));

        const baseVencimentoStr = vencimento_primeira_parcela && vencimento_primeira_parcela.trim() 
          ? vencimento_primeira_parcela.trim() 
          : data_entrada;

        for (let i = 0; i < numParcelas; i++) {
          const valParcela = i === 0 ? Number((valorBase + diff).toFixed(2)) : valorBase;

          let dueDateStr = baseVencimentoStr;
          if (i > 0) {
            const [y, m, d] = baseVencimentoStr.split('-').map(Number);
            if (y && m && d) {
              const dt = new Date(Date.UTC(y, m - 1 + i, d));
              dueDateStr = dt.toISOString().split('T')[0];
            }
          }

          const desc = numParcelas > 1 
            ? `Compra de Produtos - NF ${docNum} (${i + 1}/${numParcelas})` 
            : `Compra de Produtos - NF ${docNum}`;

          const numDoc = numParcelas > 1 ? `${docNum}-${i + 1}` : docNum;

          const despesa = await getDespesaModel().create({
            descricao: desc,
            valor: valParcela,
            tipo: 'variavel',
            categoria: category,
            data_documento: data_entrada,
            data_vencimento: dueDateStr,
            pago: false,
            status: 'Aberto',
            numero_documento: numDoc,
            fornecedor: supplier,
            observacoes: `Lançamento automático via Entrada de Estoque (NF ${docNum})`,
            entrada_estoque_id: entrada.id
          }, { transaction });
          createdDespesas.push(despesa);
        }
      }
    }

    await transaction.commit();

    res.status(201).json({
      ok: true,
      entrada: {
        ...entrada.toJSON(),
        itens: processedItens,
        despesas: createdDespesas
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

    const product = await getProdutoModel().findByPk(produto_id, { transaction });
    if (!product || product.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Produto não encontrado ou inativo.' });
    }

    const qtdAnterior = product.quantidade_estoque || 0;
    const qtdAtual = Number(Number(quantidade_contada).toFixed(3));
    const diferenca = Number((qtdAtual - qtdAnterior).toFixed(3));

    await product.update({
      quantidade_estoque: qtdAtual
    }, { transaction });

    // Log the adjustment movement for full traceability
    const movement = await getMovimentacaoEstoqueModel().create({
      produto_id,
      produto_nome: product.nome,
      tipo: 'ajuste',
      quantidade: diferenca,
      quantidade_anterior: qtdAnterior,
      quantidade_atual: qtdAtual,
      valor_unitario: product.custo_unitario || 0,
      motivo: observacoes || `Ajuste de Inventário (Diferença de ${diferenca > 0 ? '+' : ''}${diferenca})`,
      usuario_id: req.user ? req.user.id : null,
      usuario_nome: req.user ? req.user.name : null
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

// Register manual movement (saida_manual, perda, consumo_interno, ajuste_positivo, ajuste_negativo, transferencia)
const registrarMovimentacao = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { produto_id, tipo, quantidade, motivo_id, observacao } = req.body;

    if (!produto_id || !tipo || quantidade === undefined || Number(quantidade) <= 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Produto, tipo da movimentação e quantidade válida são obrigatórios.' });
    }

    if (!motivo_id) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'O motivo operacional da movimentação é obrigatório.' });
    }

    const product = await getProdutoModel().findByPk(produto_id, { transaction });
    if (!product || product.deletado === 'S') {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Produto não encontrado ou inativo.' });
    }

    // Load custom motive from database (mandatory)
    const Motivo = getMotivoMovimentacaoModel();
    const dbMotivo = await Motivo.findByPk(motivo_id, { transaction });
    if (!dbMotivo) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Motivo operacional de movimentação não encontrado ou inativo.' });
    }
    const motivoNome = dbMotivo.nome;

    const qtdAnterior = product.quantidade_estoque || 0;
    let qtyChange = Number(Number(quantidade).toFixed(3));
    let dbTipo = 'ajuste'; // default

    // Determine type behaviour
    const isReduction = ['saida_manual', 'perda', 'consumo_interno', 'ajuste_negativo', 'transferencia'].includes(tipo);

    if (isReduction) {
      qtyChange = -qtyChange;
      if (tipo === 'saida_manual' || tipo === 'transferencia') {
        dbTipo = 'saida';
      } else {
        dbTipo = 'ajuste';
      }
    } else {
      dbTipo = 'ajuste';
    }

    const qtdAtual = Number((qtdAnterior + qtyChange).toFixed(3));

    // Block negative stock if configuration is disabled
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne({ transaction });
    const permitirEstoqueNegativo = systemConfig ? !!systemConfig.permitir_estoque_negativo : false;

    if (qtdAtual < 0 && !permitirEstoqueNegativo) {
      await transaction.rollback();
      return res.status(400).json({ detail: `Quantidade insuficiente em estoque. Saldo atual: ${qtdAnterior}` });
    }

    await product.update({
      quantidade_estoque: qtdAtual
    }, { transaction });

    // Format final motivo log
    const displayType = {
      saida_manual: 'Saída Manual',
      perda: 'Perda',
      consumo_interno: 'Consumo Interno',
      ajuste_positivo: 'Ajuste Positivo',
      ajuste_negativo: 'Ajuste Negativo',
      transferencia: 'Transferência'
    }[tipo] || tipo;

    const motivoLogParts = [];
    motivoLogParts.push(displayType);
    if (motivoNome) motivoLogParts.push(motivoNome);
    if (observacao && observacao.trim()) motivoLogParts.push(observacao.trim());
    const motivoLog = motivoLogParts.join(' - ');

    const movement = await getMovimentacaoEstoqueModel().create({
      produto_id,
      produto_nome: product.nome,
      tipo: dbTipo,
      quantidade: qtyChange,
      quantidade_anterior: qtdAnterior,
      quantidade_atual: qtdAtual,
      valor_unitario: product.custo_unitario || 0,
      motivo: motivoLog,
      usuario_id: req.user ? req.user.id : null,
      usuario_nome: req.user ? req.user.name : null
    }, { transaction });

    await transaction.commit();

    res.json({
      ok: true,
      produto: product,
      movimentacao: movement
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

// Register physical inventory in batch (Assisted Inventory)
const registrarInventarioAssistido = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { itens, observacao } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Nenhum item informado para inventariar.' });
    }

    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;
    
    // Find the latest protocol number for current year
    const Inventario = getInventarioProtocoloModel();
    const latest = await Inventario.findOne({
      where: {
        numero_protocolo: {
          [Op.like]: `${prefix}%`
        }
      },
      order: [['numero_protocolo', 'DESC']],
      transaction
    });

    let nextSeq = 1;
    if (latest) {
      const parts = latest.numero_protocolo.split('-');
      const seqPart = parseInt(parts[2], 10);
      if (!isNaN(seqPart)) {
        nextSeq = seqPart + 1;
      }
    }
    const numero_protocolo = `${prefix}${String(nextSeq).padStart(5, '0')}`;

    let qtdConferida = 0;
    let qtdDivergencias = 0;
    let valorDivergencia = 0;

    const protocolo = await Inventario.create({
      numero_protocolo,
      data_conferenca: new Date(),
      usuario_id: req.user ? req.user.id : 'system',
      usuario_nome: req.user ? req.user.name : 'Sistema',
      qtd_conferida: 0,
      qtd_divergencias: 0,
      valor_divergencia: 0,
      observacao: observacao || ''
    }, { transaction });

    for (const item of itens) {
      const { produto_id, quantidade_contada } = item;
      if (!produto_id || quantidade_contada === undefined) {
        continue;
      }

      const product = await getProdutoModel().findByPk(produto_id, { transaction });
      if (!product || product.deletado === 'S') {
        continue;
      }

      qtdConferida++;
      const qtdAnterior = product.quantidade_estoque || 0;
      const qtdAtual = Number(Number(quantidade_contada).toFixed(3));
      const diferenca = Number((qtdAtual - qtdAnterior).toFixed(3));
      const custo = product.custo_unitario || 0;

      if (diferenca !== 0) {
        qtdDivergencias++;
        valorDivergencia += Math.abs(diferenca * custo);

        // Update product stock
        await product.update({
          quantidade_estoque: qtdAtual
        }, { transaction });

        // Log the adjustment movement for full traceability
        await getMovimentacaoEstoqueModel().create({
          produto_id,
          produto_nome: product.nome,
          tipo: 'ajuste',
          quantidade: diferenca,
          quantidade_anterior: qtdAnterior,
          quantidade_atual: qtdAtual,
          valor_unitario: custo,
          motivo: `Ajuste de Inventário (Protocolo ${numero_protocolo})`,
          referencia_id: protocolo.id,
          usuario_id: req.user ? req.user.id : null,
          usuario_nome: req.user ? req.user.name : null
        }, { transaction });
      }
    }

    // Update protocol stats
    await protocolo.update({
      qtd_conferida: qtdConferida,
      qtd_divergencias: qtdDivergencias,
      valor_divergencia: Number(valorDivergencia.toFixed(2))
    }, { transaction });

    await transaction.commit();

    res.json({
      ok: true,
      protocolo: {
        ...protocolo.toJSON()
      }
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

// List all physical inventory protocols
const listProtocolos = async (req, res) => {
  try {
    const Inventario = getInventarioProtocoloModel();
    const list = await Inventario.findAll({
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// List all stock movements (traceability history)
const listMovimentacoes = async (req, res) => {
  try {
    const { produto_id } = req.query;
    const where = {};
    if (produto_id) {
      where.produto_id = produto_id;
    }
    const movements = await getMovimentacaoEstoqueModel().findAll({
      where,
      order: [['createdAt', 'DESC']]
    });

    const { getVendaDiretaModel } = await import('../models/VendaDireta.js');
    const { Op } = await import('sequelize');
    const vendaIds = [...new Set(movements.filter(m => m.referencia_id).map(m => m.referencia_id))];

    let vendasMap = new Map();
    if (vendaIds.length > 0) {
      const vendas = await getVendaDiretaModel().findAll({
        where: { id: { [Op.in]: vendaIds } }
      });
      vendasMap = new Map(vendas.map(v => [v.id, v]));
    }

    const formattedMovements = movements.map(m => {
      const movementData = m.toJSON();
      let motivoFormatado = m.motivo || '';

      if (m.referencia_id && vendasMap.has(m.referencia_id)) {
        const v = vendasMap.get(m.referencia_id);
        if (m.tipo === 'saida') {
          motivoFormatado = `Saída Venda - Código: ${String(v.numero_venda || '').padStart(6, '0')} | V`;
        }
      } else if (motivoFormatado.startsWith('Venda Direta - Código:')) {
        const uuid = motivoFormatado.replace('Venda Direta - Código:', '').trim();
        const shortId = uuid.length > 8 ? uuid.substring(0, 8) : uuid;
        motivoFormatado = `Saída Venda - Código: ${shortId} | V`;
      }

      movementData.motivo = motivoFormatado;
      return movementData;
    });

    res.json(formattedMovements);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const autorizarZeragemEstoque = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ detail: "Email e senha são obrigatórios" });
  }

  try {
    const user = await getUserModel().findOne({ 
      where: { 
        email: email.toLowerCase().trim(), 
        deletado: 'N' 
      } 
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash)) || !user.ativo) {
      return res.status(400).json({ detail: "Usuário ou senha incorretos" });
    }

    // Verificar se o usuário supervisor possui permissão estoque.zerar ou é admin
    let temPermissao = user.role === 'admin';
    if (!temPermissao && user.perfil_acesso_id) {
      const perfil = await getPerfilAcessoModel().findByPk(user.perfil_acesso_id);
      if (perfil && (perfil.permissoes?.['estoque.zerar'] === true || perfil.permissoes?.acoes?.['estoque.zerar'] === true)) {
        temPermissao = true;
      }
    }

    if (!temPermissao) {
      return res.status(403).json({ detail: "Este usuário não possui permissão para autorizar a zeragem." });
    }

    res.json({ success: true, supervisor: user.name });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  getEntradaDetail, listEntradas, listMovimentacoes, registrarAjusteInventario, registrarEntrada, registrarMovimentacao, registrarInventarioAssistido, listProtocolos, autorizarZeragemEstoque
};
