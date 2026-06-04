import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import { getVendaDiretaModel } from '../models/VendaDireta.js';
import { getPagamentoModel } from '../models/Pagamento.js';
import { getClienteModel } from '../models/Cliente.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getDescontoModel } from '../models/Desconto.js';

const listVendas = async (req, res) => {
  const { data_inicio, data_fim, cliente_id, status } = req.query;
  console.log('[DEBUG listVendas] Received query params:', { data_inicio, data_fim, cliente_id, status });
  try {
    const where = { deletado: 'N' };
    if (data_inicio && data_fim) {
      where.data_venda = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }
    if (cliente_id) {
      where.cliente_id = cliente_id;
    }
    if (status) {
      where.status = status;
    }
    console.log('[DEBUG listVendas] sequelize where:', where);
    const vendas = await getVendaDiretaModel().findAll({
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
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S') return res.status(404).json({ detail: 'Venda não encontrada' });

    const pagamentos = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' } });
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
  const { itens, colaborador_id, cliente_id, data_venda } = req.body;

  if (!colaborador_id) {
    return res.status(400).json({ detail: 'Informe o profissional responsável pela venda.' });
  }

  // Suporte a formato legado (produto_id + quantidade) e novo formato (itens=[])
  let carrinho = [];
  if (Array.isArray(itens) && itens.length > 0) {
    carrinho = itens;
  } else if (req.body.produto_id && req.body.quantidade) {
    // Retrocompatibilidade com formato antigo (1 produto)
    carrinho = [{ produto_id: req.body.produto_id, quantidade: Number(req.body.quantidade) }];
  }

  if (carrinho.length === 0) {
    return res.status(400).json({ detail: 'Adicione ao menos um produto ao carrinho.' });
  }

  try {
    // Buscar e validar todos os produtos do carrinho
    const itensProcessados = [];
    let valor_total = 0;

    for (const item of carrinho) {
      const produto = await Produto.findByPk(item.produto_id);
      if (!produto) {
        return res.status(400).json({ detail: `Produto não encontrado: ${item.produto_id}` });
      }
      const qtd = Number(item.quantidade);
      if (produto.quantidade_estoque < qtd) {
        return res.status(400).json({
          detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${produto.quantidade_estoque}`
        });
      }

      const preco_unitario = Number(item.preco_unitario || produto.preco_venda);
      const subtotal = qtd * preco_unitario;

      itensProcessados.push({
        produto_id: produto.id,
        produto_nome: produto.nome,
        quantidade: qtd,
        preco_unitario,
        subtotal,
        comissao_pct: Number(produto.comissao || 0)
      });

      valor_total += subtotal;
    }

    // NÃO deduzir estoque na criação da venda.
    // O estoque só é deduzido quando o pagamento for registrado.

    let colaborador_nome = null;
    const colab = await getColaboradorModel().findByPk(colaborador_id);
    if (colab) colaborador_nome = colab.nome;

    let cliente_nome = null;
    if (cliente_id) {
      const cli = await getClienteModel().findByPk(cliente_id);
      if (cli) cliente_nome = cli.nome;
    }

    const maxNum = await getVendaDiretaModel().max('numero_venda') || 0;

    // Campos legados preenchidos com o primeiro item (retrocompatibilidade)
    const primeiroItem = itensProcessados[0];

    let data_venda_db = new Date();
    if (data_venda) {
      const [year, month, day] = data_venda.split('-').map(Number);

      // Validação: data informada não pode ser futura
      const hoje = new Date();
      const dataVendaDateOnly = new Date(year, month - 1, day);
      const hojeDateOnly = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
      if (dataVendaDateOnly > hojeDateOnly) {
        return res.status(400).json({ detail: 'A data da venda não pode ser uma data futura.' });
      }

      data_venda_db.setFullYear(year);
      data_venda_db.setMonth(month - 1);
      data_venda_db.setDate(day);
    }

    const created_by_id = req.user ? req.user.id : null;
    const created_by_name = req.user ? req.user.name : 'Sistema';

    const venda = await getVendaDiretaModel().create({
      id: uuidv4(),
      numero_venda: maxNum + 1,
      data_venda: data_venda_db,
      data_lancamento: new Date(),
      criado_por_id: created_by_id,
      criado_por_nome: created_by_name,
      // Campos legados (retrocompatibilidade com relatórios e comissões antigas)
      produto_id: primeiroItem.produto_id,
      produto_nome: itensProcessados.length === 1
        ? primeiroItem.produto_nome
        : `${primeiroItem.produto_nome} (+${itensProcessados.length - 1})`,
      quantidade: itensProcessados.reduce((acc, i) => acc + i.quantidade, 0),
      // Novo campo: carrinho completo
      itens: itensProcessados,
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
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S') {
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    // Validar se existem pagamentos vinculados ativos
    const countPagamentos = await getPagamentoModel().count({
      where: {
        venda_direta_id: req.params.id,
        deletado: 'N'
      }
    });

    const temPagamentos = countPagamentos > 0 || (venda.valor_pago && venda.valor_pago > 0) || venda.status === 'pago';

    if (temPagamentos) {
      return res.status(400).json({ detail: 'Não é permitido excluir uma venda que possui pagamentos registrados.' });
    }

    // Soft delete sale (exclusão lógica)
    await venda.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const addPagamentos = async (req, res) => {
  const { pagamentos, finalizar } = req.body;

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda) return res.status(404).json({ detail: 'Venda não encontrada' });

    const existingPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' } });
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
      await getPagamentoModel().create({
        id: uuidv4(),
        venda_direta_id: req.params.id,
        valor: p.valor,
        forma_pagamento: p.forma_pagamento,
        observacao: p.observacao || '',
        data_hora: new Date()
      });
    }

    const eraStatusAnteriorPago = venda.status === 'pago';
    venda.valor_pago = novoTotal;
    const ficouPago = finalizar || novoTotal >= venda.valor_total - 0.01;
    if (ficouPago) {
      venda.status = 'pago';
    }
    await venda.save();

    // Deduzir estoque apenas na primeira vez que a venda fica paga
    if (ficouPago && !eraStatusAnteriorPago) {
      const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
      for (const item of itensVenda) {
        const produto = await getProdutoModel().findByPk(item.produto_id);
        if (produto) {
          produto.quantidade_estoque = Math.max(0, Number((produto.quantidade_estoque - Number(item.quantidade)).toFixed(3)));
          await produto.save();
        }
      }
    }

    res.json({ ok: true, total_pago: novoTotal, saldo: venda.valor_total - novoTotal });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updatePagamento = async (req, res) => {
  const { valor, forma_pagamento, observacao } = req.body;

  try {
    const pagamento = await getPagamentoModel().findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });

    pagamento.valor = valor;
    pagamento.forma_pagamento = forma_pagamento;
    pagamento.observacao = observacao || '';
    await pagamento.save();

    // Recompute venda total paid and handle stock adjustments on status transition
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (venda) {
      const eraStatusAnteriorPago = venda.status === 'pago';
      const allPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      venda.valor_pago = totalPago;
      const ficouPago = totalPago >= venda.valor_total - 0.01;
      if (ficouPago) {
        venda.status = 'pago';
      } else {
        venda.status = 'pendente';
      }
      await venda.save();

      // Devolver estoque se a venda deixou de ser paga (ficou pendente)
      if (eraStatusAnteriorPago && !ficouPago) {
        const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
          ? venda.itens
          : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
        for (const item of itensVenda) {
          const produto = await getProdutoModel().findByPk(item.produto_id);
          if (produto) {
            produto.quantidade_estoque = Number((produto.quantidade_estoque + Number(item.quantidade)).toFixed(3));
            await produto.save();
          }
        }
      }
      // Deduzir estoque se a venda passou de pendente para paga
      else if (!eraStatusAnteriorPago && ficouPago) {
        const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
          ? venda.itens
          : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
        for (const item of itensVenda) {
          const produto = await getProdutoModel().findByPk(item.produto_id);
          if (produto) {
            produto.quantidade_estoque = Math.max(0, Number((produto.quantidade_estoque - Number(item.quantidade)).toFixed(3)));
            await produto.save();
          }
        }
      }
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
    const authUser = await getUserModel().findOne({ where: { email: email.toLowerCase().trim() } });
    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      return res.status(401).json({ detail: 'Usuário ou senha incorretos' });
    }
    if (!authUser.pode_excluir_pagamento) {
      return res.status(403).json({ detail: 'Este usuário não possui permissão para excluir pagamentos' });
    }

    const pagamento = await getPagamentoModel().findByPk(req.params.pid);
    if (!pagamento) return res.status(404).json({ detail: 'Pagamento não encontrado' });
    await pagamento.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });

    // Recompute venda total paid and handle stock restoration if no longer paid
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (venda) {
      const eraStatusAnteriorPago = venda.status === 'pago';
      const allPags = await getPagamentoModel().findAll({ where: { venda_direta_id: req.params.id, deletado: 'N' } });
      const totalPago = allPags.reduce((acc, p) => acc + p.valor, 0);
      venda.valor_pago = totalPago;
      const ficouPago = totalPago >= venda.valor_total - 0.01;
      if (ficouPago) {
        venda.status = 'pago';
      } else {
        venda.status = 'pendente';
      }
      await venda.save();

      // Devolver estoque se a venda deixou de ser paga (ficou pendente)
      if (eraStatusAnteriorPago && !ficouPago) {
        const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
          ? venda.itens
          : [{ produto_id: venda.produto_id, quantidade: venda.quantidade }];
        for (const item of itensVenda) {
          const produto = await getProdutoModel().findByPk(item.produto_id);
          if (produto) {
            produto.quantidade_estoque = Number((produto.quantidade_estoque + Number(item.quantidade)).toFixed(3));
            await produto.save();
          }
        }
      }
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// ─────────────────────────────────────────────
// GERENCIAMENTO DO CARRINHO DA VENDA
// ─────────────────────────────────────────────

/**
 * Verifica se a venda está bloqueada para edição (possui pagamento ativo).
 */
const _isVendaBloqueada = async (vendaId) => {
  const count = await getPagamentoModel().count({
    where: { venda_direta_id: vendaId, deletado: 'N' }
  });
  return count > 0;
};

/**
 * Reconstrói os campos legados (produto_id, produto_nome, quantidade) e o valor_total
 * a partir do carrinho (itens[]) e salva a venda.
 */
const _recalcularVenda = async (venda) => {
  const itens = Array.isArray(venda.itens) ? venda.itens : [];
  const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
  const primeiro = itens[0] || {};
  await venda.update({
    itens,
    valor_total,
    produto_id: primeiro.produto_id || venda.produto_id,
    produto_nome:
      itens.length === 1
        ? primeiro.produto_nome
        : itens.length > 1
          ? `${primeiro.produto_nome} (+${itens.length - 1})`
          : venda.produto_nome,
    quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
  });
};

/**
 * GET /api/vendas-diretas/:id/carrinho
 * Retorna os itens do carrinho e indica se está bloqueado.
 */
const getCarrinho = async (req, res) => {
  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    const bloqueado = await _isVendaBloqueada(req.params.id);
    const itens =
      Array.isArray(venda.itens) && venda.itens.length > 0
        ? venda.itens
        : [{
          produto_id: venda.produto_id,
          produto_nome: venda.produto_nome,
          quantidade: venda.quantidade,
          preco_unitario:
            venda.quantidade > 0
              ? venda.valor_total / venda.quantidade
              : venda.valor_total,
          subtotal: venda.valor_total,
          comissao_pct: 0
        }];

    res.json({
      venda_id: venda.id,
      numero_venda: venda.numero_venda,
      status: venda.status,
      bloqueado,
      mensagem_bloqueio: bloqueado
        ? 'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
        : null,
      itens,
      valor_total: venda.valor_total,
      cliente_id: venda.cliente_id,
      cliente_nome: venda.cliente_nome
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * POST /api/vendas-diretas/:id/carrinho/itens
 * Adiciona um novo item ao carrinho (bloqueado se houver pagamento).
 */
const addItemCarrinho = async (req, res) => {
  const { produto_id, quantidade, preco_unitario } = req.body;

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    if (await _isVendaBloqueada(venda.id))
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });

    const produto = await getProdutoModel().findByPk(produto_id);
    if (!produto)
      return res.status(400).json({ detail: 'Produto não encontrado.' });

    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0)
      return res.status(400).json({ detail: 'Quantidade inválida.' });

    // Verifica estoque disponível considerando já comprometido no carrinho
    const itensAtuais = Array.isArray(venda.itens) ? venda.itens : [];
    const qtdJaNoCarrinho = itensAtuais
      .filter(i => i.produto_id === produto_id)
      .reduce((acc, i) => acc + Number(i.quantidade), 0);

    const estoqueDisponivel = produto.quantidade_estoque - qtdJaNoCarrinho;
    if (estoqueDisponivel < qtd)
      return res.status(400).json({
        detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${estoqueDisponivel}`
      });

    const precoUnit = Number(preco_unitario || produto.preco_venda);
    const subtotal = qtd * precoUnit;

    const novoItem = {
      produto_id: produto.id,
      produto_nome: produto.nome,
      quantidade: qtd,
      preco_unitario: precoUnit,
      subtotal,
      comissao_pct: Number(produto.comissao || 0)
    };

    const itensAtualizados = [...itensAtuais, novoItem];
    venda.itens = itensAtualizados;
    await _recalcularVenda(venda);

    res.status(201).json({
      ok: true,
      item: novoItem,
      itens: itensAtualizados,
      valor_total: venda.valor_total
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * PUT /api/vendas-diretas/:id/carrinho/itens/:itemIndex
 * Atualiza a quantidade de um item pelo índice (bloqueado se houver pagamento).
 */
const updateItemCarrinho = async (req, res) => {
  const { quantidade } = req.body;
  const itemIndex = parseInt(req.params.itemIndex, 10);

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    if (await _isVendaBloqueada(venda.id))
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });

    const itens = Array.isArray(venda.itens) ? [...venda.itens] : [];
    if (itemIndex < 0 || itemIndex >= itens.length)
      return res.status(400).json({ detail: 'Índice de item inválido.' });

    const qtd = Number(quantidade);
    if (!qtd || qtd <= 0)
      return res.status(400).json({ detail: 'Quantidade inválida.' });

    const item = itens[itemIndex];
    const produto = await getProdutoModel().findByPk(item.produto_id);
    if (!produto)
      return res.status(400).json({ detail: 'Produto do item não encontrado.' });

    // Estoque: considera a reserva dos outros itens do mesmo produto
    const qtdOutrosItens = itens
      .filter((_, i) => i !== itemIndex && itens[i].produto_id === item.produto_id)
      .reduce((acc, i) => acc + Number(i.quantidade), 0);

    const estoqueDisponivel = produto.quantidade_estoque - qtdOutrosItens;
    if (estoqueDisponivel < qtd)
      return res.status(400).json({
        detail: `Estoque insuficiente para "${produto.nome}". Disponível: ${estoqueDisponivel}`
      });

    itens[itemIndex] = {
      ...item,
      quantidade: qtd,
      subtotal: qtd * Number(item.preco_unitario)
    };

    venda.itens = itens;
    await _recalcularVenda(venda);

    res.json({
      ok: true,
      itens: venda.itens,
      valor_total: venda.valor_total
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

/**
 * DELETE /api/vendas-diretas/:id/carrinho/itens/:itemIndex
 * Remove um item do carrinho pelo índice (bloqueado se houver pagamento).
 * O carrinho deve ter ao menos 1 item.
 */
const removeItemCarrinho = async (req, res) => {
  const itemIndex = parseInt(req.params.itemIndex, 10);

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    if (await _isVendaBloqueada(venda.id))
      return res.status(403).json({
        detail:
          'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.'
      });

    const itens = Array.isArray(venda.itens) ? [...venda.itens] : [];
    if (itens.length <= 1)
      return res.status(400).json({
        detail: 'O carrinho deve ter ao menos um produto.'
      });

    if (itemIndex < 0 || itemIndex >= itens.length)
      return res.status(400).json({ detail: 'Índice de item inválido.' });

    const itensAtualizados = itens.filter((_, i) => i !== itemIndex);
    venda.itens = itensAtualizados;
    await _recalcularVenda(venda);

    res.json({
      ok: true,
      itens: venda.itens,
      valor_total: venda.valor_total
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateCliente = async (req, res) => {
  const { cliente_id } = req.body;

  try {
    const venda = await getVendaDiretaModel().findByPk(req.params.id);
    if (!venda || venda.deletado === 'S')
      return res.status(404).json({ detail: 'Venda não encontrada' });

    if (await _isVendaBloqueada(venda.id))
      return res.status(403).json({
        detail:
          'Não é permitido alterar a venda que já possui pagamento vinculado.'
      });

    let cliente_nome = null;
    if (cliente_id) {
      const cli = await getClienteModel().findByPk(cliente_id);
      if (!cli) {
        return res.status(400).json({ detail: 'Cliente não encontrado' });
      }
      cliente_nome = cli.nome;
    }

    await venda.update({
      cliente_id: cliente_id || null,
      cliente_nome
    });

    res.json({
      ok: true,
      cliente_id,
      cliente_nome
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const aplicarDescontoVenda = async (req, res) => {
  const { id } = req.params;
  const { descontoId } = req.body;

  try {
    const venda = await getVendaDiretaModel().findByPk(id);
    if (!venda || venda.deletado === 'S') {
      return res.status(404).json({ detail: 'Venda não encontrada' });
    }

    if (venda.status === 'pago' || venda.valor_pago > 0) {
      return res.status(400).json({ detail: 'Não é possível aplicar desconto em uma venda que já possui pagamentos.' });
    }

    // Normalizar itens
    let itens = Array.isArray(venda.itens) && venda.itens.length > 0
      ? [...venda.itens]
      : [{
        produto_id: venda.produto_id,
        produto_nome: venda.produto_nome,
        quantidade: venda.quantidade,
        preco_unitario: venda.quantidade > 0 ? venda.valor_total / venda.quantidade : venda.valor_total,
        subtotal: venda.valor_total,
        comissao_pct: 0
      }];

    // Se descontoId for nulo/vazio, estamos limpando o desconto (reverter para original)
    if (!descontoId) {
      // Reverter preços para original
      itens = itens.map(item => {
        if (item.preco_unitario_original !== undefined) {
          item.preco_unitario = item.preco_unitario_original;
          item.subtotal = item.quantidade * item.preco_unitario;
          delete item.preco_unitario_original;
        }
        return item;
      });

      venda.itens = itens;
      venda.changed('itens', true);
      const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
      const primeiro = itens[0] || {};

      await venda.update({
        itens,
        valor_total,
        desconto_aplicado: null,
        produto_id: primeiro.produto_id || venda.produto_id,
        produto_nome: itens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${itens.length - 1})`,
        quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
      });

      return res.json({ ok: true, venda });
    }

    const desconto = await getDescontoModel().findOne({ where: { id: descontoId, deletado: 'N', ativo: true } });
    if (!desconto) {
      return res.status(444).json({ detail: 'Desconto não encontrado ou inativo.' });
    }

    // Verificar itens vinculados
    let vinculados = { services: [], products: [] };
    if (desconto.itens_vinculados) {
      try {
        vinculados = typeof desconto.itens_vinculados === "string"
          ? JSON.parse(desconto.itens_vinculados)
          : desconto.itens_vinculados;
      } catch (e) { }
    }

    const isRestrictedToItems = (vinculados.products && vinculados.products.length > 0) || (vinculados.services && vinculados.services.length > 0);

    // Identificar itens elegíveis e reverter quaisquer descontos anteriores primeiro
    let eligibleItens = [];
    itens = itens.map(item => {
      // Restore first if already discounted previously
      if (item.preco_unitario_original !== undefined) {
        item.preco_unitario = item.preco_unitario_original;
        item.subtotal = item.quantidade * item.preco_unitario;
      } else {
        // Save original price
        item.preco_unitario_original = item.preco_unitario;
      }

      const isEligible = !isRestrictedToItems || (vinculados.products && vinculados.products.includes(item.produto_id));
      if (isEligible) {
        eligibleItens.push(item);
      }
      return item;
    });

    if (eligibleItens.length === 0) {
      return res.status(400).json({ detail: 'Este desconto não é elegível para nenhum produto desta venda.' });
    }

    const subtotalElegivel = eligibleItens.reduce((acc, i) => acc + Number(i.subtotal), 0);

    // Calcular o desconto total a ser aplicado
    let totalDiscount = 0;
    if (desconto.tipo === 'porcentagem') {
      totalDiscount = subtotalElegivel * (desconto.valor / 100);
    } else { // valor_fixo
      totalDiscount = Math.min(desconto.valor, subtotalElegivel);
    }

    // Distribuir o desconto proporcionalmente aos subtotais dos itens elegíveis
    if (subtotalElegivel > 0) {
      eligibleItens.forEach(item => {
        const proporcao = item.subtotal / subtotalElegivel;
        const itemDiscount = totalDiscount * proporcao;
        item.subtotal = Math.max(0, Number((item.subtotal - itemDiscount).toFixed(2)));
        item.preco_unitario = Number((item.subtotal / item.quantidade).toFixed(2));
      });
    }

    venda.itens = itens;
    venda.changed('itens', true);
    const valor_total = itens.reduce((acc, i) => acc + Number(i.subtotal || 0), 0);
    const primeiro = itens[0] || {};

    await venda.update({
      itens,
      valor_total,
      desconto_aplicado: {
        desconto_id: desconto.id,
        codigo: desconto.codigo,
        descricao: desconto.descricao,
        tipo: desconto.tipo,
        valor_desconto: desconto.valor,
        total_descontado: Number(totalDiscount.toFixed(2)),
        incide_comissao: desconto.incide_comissao !== false && desconto.incide_comissao !== 0,
        aplicado_em: new Date().toISOString()
      },
      produto_id: primeiro.produto_id || venda.produto_id,
      produto_nome: itens.length === 1 ? primeiro.produto_nome : `${primeiro.produto_nome} (+${itens.length - 1})`,
      quantidade: itens.reduce((acc, i) => acc + Number(i.quantidade || 0), 0)
    });

    res.json({ ok: true, venda });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  addItemCarrinho, addPagamentos, aplicarDescontoVenda, createVenda, deletePagamento, deleteVenda, getCarrinho, getVenda, listVendas, removeItemCarrinho,
  updateCliente, updateItemCarrinho, updatePagamento
};

