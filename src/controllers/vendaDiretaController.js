import VendaDireta from '../models/VendaDireta.js';
import Produto from '../models/Produto.js';
import Colaborador from '../models/Colaborador.js';
import Cliente from '../models/Cliente.js';
import Pagamento from '../models/Pagamento.js';
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';

const listVendas = async (req, res) => {
  const { data_inicio, data_fim } = req.query;
  try {
    const where = {};
    if (data_inicio && data_fim) {
      where.data_venda = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }
    const vendas = await VendaDireta.findAll({
      where,
      order: [['data_venda', 'DESC']]
    });
    res.json(vendas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const getVenda = async (req, res) => {
  try {
    const venda = await VendaDireta.findByPk(req.params.id);
    if (!venda) return res.status(404).json({ detail: 'Venda não encontrada' });

    const pagamentos = await Pagamento.findAll({ where: { venda_direta_id: req.params.id } });
    const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);

    res.json({
      ...venda.toJSON(),
      pagamentos,
      total_pago: totalPago
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createVenda = async (req, res) => {
  const { produto_id, quantidade, colaborador_id, cliente_id } = req.body;

  if (!colaborador_id) {
    return res.status(400).json({ detail: 'Informe o profissional responsável pela venda.' });
  }

  try {
    const produto = await Produto.findByPk(produto_id);
    if (!produto) {
      return res.status(400).json({ detail: 'Produto não encontrado' });
    }

    if (produto.quantidade_estoque < quantidade) {
      return res.status(400).json({ detail: `Estoque insuficiente. Quantidade disponível: ${produto.quantidade_estoque}` });
    }

    // Deduct stock
    produto.quantidade_estoque -= quantidade;
    await produto.save();

    let colaborador_nome = null;
    if (colaborador_id) {
      const colab = await Colaborador.findByPk(colaborador_id);
      if (colab) colaborador_nome = colab.nome;
    }

    let cliente_nome = null;
    if (cliente_id) {
      const cli = await Cliente.findByPk(cliente_id);
      if (cli) cliente_nome = cli.nome;
    }

    const valor_total = quantidade * produto.preco_venda;

    const venda = await VendaDireta.create({
      id: uuidv4(),
      produto_id,
      produto_nome: produto.nome,
      quantidade,
      colaborador_id,
      colaborador_nome,
      cliente_id,
      cliente_nome,
      valor_total,
      valor_pago: 0,
      status: 'pendente'
    });

    res.status(201).json(venda);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteVenda = async (req, res) => {
  try {
    const venda = await VendaDireta.findByPk(req.params.id);
    if (venda) {
      // Revert product stock
      const produto = await Produto.findByPk(venda.produto_id);
      if (produto) {
        produto.quantidade_estoque += venda.quantidade;
        await produto.save();
      }

      // Delete payments
      await Pagamento.destroy({ where: { venda_direta_id: req.params.id } });
      
      // Delete sale
      await venda.destroy();
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const addPagamentos = async (req, res) => {
  const { pagamentos, finalizar } = req.body;

  try {
    const venda = await VendaDireta.findByPk(req.params.id);
    if (!venda) return res.status(404).json({ detail: 'Venda não encontrada' });

    const existingPags = await Pagamento.findAll({ where: { venda_direta_id: req.params.id } });
    const pagoAtual = existingPags.reduce((acc, p) => acc + p.valor, 0);
    const novoValor = pagamentos.reduce((acc, p) => acc + p.valor, 0);
    let adjustedPagamentos = [...pagamentos];
    let novoTotal = pagoAtual + novoValor;

    if (novoTotal > venda.valor_total + 0.01) {
      let excesso = novoTotal - venda.valor_total;
      let idxDinheiro = adjustedPagamentos.findIndex(p => p.forma_pagamento === 'dinheiro');
      if (idxDinheiro !== -1 && adjustedPagamentos[idxDinheiro].valor >= excesso) {
        adjustedPagamentos[idxDinheiro].valor -= excesso;
        adjustedPagamentos[idxDinheiro].observacao = `Troco: R$ ${excesso.toFixed(2).replace('.', ',')}` + (adjustedPagamentos[idxDinheiro].observacao ? ` - ${adjustedPagamentos[idxDinheiro].observacao}` : '');
        novoTotal = venda.valor_total;
      } else {
        return res.status(400).json({ detail: 'Valor excede o total devido' });
      }
    }

    for (const p of adjustedPagamentos) {
      await Pagamento.create({
        id: uuidv4(),
        venda_direta_id: req.params.id,
        valor: p.valor,
        forma_pagamento: p.forma_pagamento,
        observacao: p.observacao || '',
        data_hora: new Date()
      });
    }

    venda.valor_pago = novoTotal;
    if (finalizar || novoTotal >= venda.valor_total - 0.01) {
      venda.status = 'pago';
    }
    await venda.save();

    res.json({ ok: true, total_pago: novoTotal, saldo: venda.valor_total - novoTotal });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updatePagamento = async (req, res) => {
  const { valor, forma_pagamento, observacao } = req.body;

  try {
    const pagamento = await Pagamento.findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    pagamento.valor = valor;
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = observacao || '';
    await pagamento.save();

    // Recompute venda total paid
    const venda = await VendaDireta.findByPk(req.params.id);
    if (venda) {
      const allPags = await Pagamento.findAll({ where: { venda_direta_id: req.params.id } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      venda.valor_pago = totalPago;
      if (totalPago >= venda.valor_total - 0.01) {
        venda.status = 'pago';
      } else {
        venda.status = 'pendente';
      }
      await venda.save();
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deletePagamento = async (req, res) => {
  const { email, password } = req.query;

  try {
    if (!email || !password) {
      return res.status(400).json({ detail: 'Usuário e senha são obrigatórios' });
    }
    const authUser = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
    }
    if (!authUser.pode_excluir_pagamento) {
      return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
    }

    const pagamento = await Pagamento.findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });
    await pagamento.destroy();

    // Recompute venda total paid
    const venda = await VendaDireta.findByPk(req.params.id);
    if (venda) {
      const allPags = await Pagamento.findAll({ where: { venda_direta_id: req.params.id } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      venda.valor_pago = totalPago;
      if (totalPago >= venda.valor_total - 0.01) {
        venda.status = 'pago';
      } else {
        venda.status = 'pendente';
      }
      await venda.save();
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listVendas,
  getVenda,
  createVenda,
  deleteVenda,
  addPagamentos,
  updatePagamento,
  deletePagamento
};
