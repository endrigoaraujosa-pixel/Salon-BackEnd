import Agendamento from '../models/Agendamento.js';
import Pagamento from '../models/Pagamento.js';
import Cliente from '../models/Cliente.js';
import Colaborador from '../models/Colaborador.js';
import Produto from '../models/Produto.js';
import Despesa from '../models/Despesa.js';
import TaxaCartao from '../models/TaxaCartao.js';
import VendaDireta from '../models/VendaDireta.js';
import OutrasReceitas from '../models/OutrasReceitas.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';

const dashboard = async (req, res) => {
  try {
    const totalClientes = await Cliente.count();
    const totalColaboradores = await Colaborador.count({ where: { ativo: true, deletado: 'N' } });
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59`;
    
    const agHoje = await Agendamento.count({ 
      where: { 
        data_hora: { [Op.between]: [todayStart, todayEnd] },
        deletado: 'N'
      } 
    });
    
    const mesPrefix = todayStr.substring(0, 7); // YYYY-MM
    const dataInicioMes = `${mesPrefix}-01T00:00:00`;
    const dataFimMes = `${mesPrefix}-31T23:59:59`;

    const pagamentosMes = await Pagamento.findAll({ 
      where: { 
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      } 
    });
    const faturamentoMes = pagamentosMes.reduce((acc, p) => acc + p.valor, 0);
    
    const concluidos = await Agendamento.count({
      where: {
        status: 'concluido',
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      }
    });
    
    const ticketMedio = concluidos ? (faturamentoMes / concluidos) : 0;
    const estoqueBaixo = await Produto.count({
      where: {
        ativo: true,
        quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
      }
    });

    const isAdmin = req.user && req.user.role === 'admin';

    res.json({
      total_clientes: totalClientes,
      total_colaboradores: totalColaboradores,
      agendamentos_hoje: agHoje,
      faturamento_mes: isAdmin ? faturamentoMes : 0,
      ticket_medio: isAdmin ? ticketMedio : 0,
      atendimentos_mes: concluidos,
      estoque_baixo: estoqueBaixo,
      top_servicos: []
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const relatorioDre = async (req, res) => {
  const { data_inicio, data_fim } = req.query;
  try {
    const ags = await Agendamento.findAll({
      where: {
        status: 'concluido',
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    const receitaServicos = ags.reduce((acc, a) => acc + a.valor_pago, 0);
    
    const vendas = await VendaDireta.findAll({
      where: {
        status: 'pago',
        data_venda: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    const receitaVendas = vendas.reduce((acc, v) => acc + v.valor_pago, 0);

    let custoProdutos = 0;
    for (const v of vendas) {
      const prod = await Produto.findByPk(v.produto_id);
      if (prod) {
        custoProdutos += v.quantidade * (prod.custo_unitario || 0);
      }
    }

    const oReceitas = await OutrasReceitas.findAll({
      where: {
        data_recebimento: { [Op.between]: [data_inicio, data_fim] },
        deletado: 'N'
      }
    });
    const outrasReceitas = oReceitas.reduce((acc, r) => acc + r.valor, 0);
    const receitaBruta = receitaServicos + receitaVendas + outrasReceitas;

    // Despesas do período
    const despesas = await Despesa.findAll({
      where: {
        data_vencimento: { [Op.between]: [data_inicio, data_fim] },
        deletado: 'N'
      }
    });
    const despesasFixas = despesas.filter(d => d.tipo === 'fixo').reduce((acc, d) => acc + d.valor, 0);
    const despesasVariaveis = despesas.filter(d => d.tipo === 'variavel').reduce((acc, d) => acc + d.valor, 0);

    // Taxas de Cartão
    let rates = await TaxaCartao.findAll();
    if (rates.length === 0) {
      await TaxaCartao.bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true }
      ]);
      rates = await TaxaCartao.findAll();
    }
    const creditoRate = rates.find(r => r.forma_pagamento === 'cartao_credito' && r.ativo)?.percentual || 0;
    const debitoRate = rates.find(r => r.forma_pagamento === 'cartao_debito' && r.ativo)?.percentual || 0;

    const payments = await Pagamento.findAll({
      where: {
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    const creditoTotalVal = payments.filter(p => p.forma_pagamento === 'cartao_credito').reduce((acc, p) => acc + p.valor, 0);
    const debitoTotalVal = payments.filter(p => p.forma_pagamento === 'cartao_debito').reduce((acc, p) => acc + p.valor, 0);

    const taxasCredito = creditoTotalVal * (creditoRate / 100);
    const taxasDebito = debitoTotalVal * (debitoRate / 100);
    const taxasTotal = taxasCredito + taxasDebito;

    const despesasOperacionais = despesasFixas + despesasVariaveis + taxasTotal;
    const lucroBruto = receitaBruta - custoProdutos;
    const lucroLiquido = lucroBruto - despesasOperacionais;

    res.json({
      data_inicio,
      data_fim,
      receita_servicos: receitaServicos,
      receita_vendas_diretas: receitaVendas,
      outras_receitas: outrasReceitas,
      receita_bruta: receitaBruta,
      custo_produtos: custoProdutos,
      lucro_bruto: lucroBruto,
      despesas: {
        bold: false,
        fixas: despesasFixas,
        variaveis: despesasVariaveis
      },
      taxas_cartao: {
        credito: taxasCredito,
        debito: taxasDebito,
        total: taxasTotal
      },
      despesas_operacionais: despesasOperacionais,
      lucro_liquido: lucroLiquido,
      total_atendimentos: ags.length,
      total_vendas_diretas: vendas.length
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const relatorioCaixa = async (req, res) => {
  const { data_inicio, data_fim, colaborador_id } = req.query;
  try {
    const pagsAg = await Pagamento.findAll({
      where: {
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    
    let filteredPags = pagsAg;

    if (colaborador_id && colaborador_id !== 'todos') {
      const agendamentos = await Agendamento.findAll({ where: { deletado: 'N' } });
      const vendas = await VendaDireta.findAll({ where: { deletado: 'N' } });

      filteredPags = pagsAg.filter(p => {
        if (p.agendamento_id) {
          const ag = agendamentos.find(a => a.id === p.agendamento_id);
          if (ag) {
            let itens = [];
            try {
              itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
            } catch (e) {
              itens = ag.itens || [];
            }
            if (Array.isArray(itens)) {
              return itens.some(item => item.colaborador_id === colaborador_id || item.auxiliar_id === colaborador_id);
            }
          }
        } else if (p.venda_direta_id) {
          const v = vendas.find(x => x.id === p.venda_direta_id);
          if (v) {
            return v.colaborador_id === colaborador_id;
          }
        }
        return false;
      });
    }

    const totais = { dinheiro: 0, pix: 0, cartao_credito: 0, cartao_debito: 0, vale: 0, geral: 0 };
    filteredPags.forEach(p => {
      totais.geral += p.valor;
      if (totais.hasOwnProperty(p.forma_pagamento)) {
        totais[p.forma_pagamento] += p.valor;
      }
    });

    res.json({
      data_inicio,
      data_fim,
      totais,
      total_pagamentos: filteredPags.length
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const relatorioProdutos = async (req, res) => {
  const { data_inicio, data_fim, colaborador_id, produto_id, categoria, forma_pagamento, cliente_id, status } = req.query;

  try {
    const where = { deletado: 'N' };
    if (data_inicio && data_fim) {
      where.data_venda = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    if (colaborador_id && colaborador_id !== 'todos') {
      where.colaborador_id = colaborador_id;
    }

    if (produto_id && produto_id !== 'todos') {
      where.produto_id = produto_id;
    }

    if (cliente_id && cliente_id !== 'todos') {
      where.cliente_id = cliente_id;
    }

    if (status && status !== 'todos') {
      where.status = status;
    }

    // Buscamos todas as vendas diretas no período/filtros básicos
    const vendas = await VendaDireta.findAll({ where, order: [['data_venda', 'DESC']] });

    // Precisamos buscar os produtos para filtrar por categoria e obter custo unitário
    const produtosIds = [...new Set(vendas.map(v => v.produto_id))];
    const produtosList = await Produto.findAll({
      where: {
        id: { [Op.in]: produtosIds }
      }
    });
    const produtosMap = new Map(produtosList.map(p => [p.id, p]));

    // Precisamos buscar os pagamentos associados a essas vendas
    const vendasIds = vendas.map(v => v.id);
    const pagamentosList = await Pagamento.findAll({
      where: {
        venda_direta_id: { [Op.in]: vendasIds },
        deletado: 'N'
      }
    });

    // Agrupar pagamentos por venda_direta_id
    const pagamentosMap = new Map();
    pagamentosList.forEach(p => {
      if (!pagamentosMap.has(p.venda_direta_id)) {
        pagamentosMap.set(p.venda_direta_id, []);
      }
      pagamentosMap.get(p.venda_direta_id).push(p);
    });

    // Mapear cada venda direta com as informações adicionadas
    let mappedVendas = vendas.map(v => {
      const prod = produtosMap.get(v.produto_id);
      const categoriaProd = prod?.categoria || 'Nenhuma';
      const custoUnitario = prod?.custo_unitario || 0;
      
      const pags = pagamentosMap.get(v.id) || [];
      const formas = [...new Set(pags.map(p => p.forma_pagamento))];

      return {
        id: v.id,
        numero_venda: v.numero_venda,
        data_venda: v.data_venda,
        produto_id: v.produto_id,
        produto_nome: v.produto_nome,
        quantidade: v.quantidade,
        valor_unitario: v.quantidade > 0 ? (v.valor_total / v.quantidade) : 0,
        valor_total: v.valor_total,
        valor_pago: v.valor_pago,
        status: v.status,
        colaborador_id: v.colaborador_id,
        colaborador_nome: v.colaborador_nome || 'Nenhum',
        cliente_id: v.cliente_id,
        cliente_nome: v.cliente_nome || 'Consumidor',
        categoria: categoriaProd,
        custo_total: v.quantidade * custoUnitario,
        formas_pagamento: formas,
        pagamentos: pags
      };
    });

    // Filtrar por Categoria no JavaScript (caso seja passado e não seja 'todos')
    if (categoria && categoria !== 'todos') {
      mappedVendas = mappedVendas.filter(v => v.categoria.toLowerCase() === categoria.toLowerCase());
    }

    // Filtrar por Forma de Pagamento no JavaScript (caso seja passado e não seja 'todos')
    if (forma_pagamento && forma_pagamento !== 'todos') {
      mappedVendas = mappedVendas.filter(v => v.formas_pagamento.includes(forma_pagamento));
    }

    // Totalizadores gerais
    let totalFaturamento = 0;
    let totalQuantidade = 0;
    let totalCusto = 0;
    let totalLucro = 0;

    const porColaborador = {};
    const porProduto = {};
    const porFormaPagamento = {};

    mappedVendas.forEach(v => {
      if (v.status === 'pago') {
        totalFaturamento += v.valor_total;
        totalQuantidade += v.quantidade;
        totalCusto += v.custo_total;

        // Por colaborador
        const colabName = v.colaborador_nome;
        porColaborador[colabName] = (porColaborador[colabName] || 0) + v.valor_total;

        // Por produto
        const prodName = v.produto_nome;
        porProduto[prodName] = (porProduto[prodName] || 0) + v.valor_total;
      }

      // Por forma de pagamento (distribuir o valor de cada pagamento se houver)
      if (v.pagamentos && v.pagamentos.length > 0) {
        v.pagamentos.forEach(p => {
          porFormaPagamento[p.forma_pagamento] = (porFormaPagamento[p.forma_pagamento] || 0) + p.valor;
        });
      }
    });

    totalLucro = totalFaturamento - totalCusto;

    res.json({
      vendas: mappedVendas,
      totais: {
        total_faturamento: totalFaturamento,
        total_quantidade: totalQuantidade,
        total_custo: totalCusto,
        total_lucro: totalLucro,
        por_colaborador: porColaborador,
        por_produto: porProduto,
        por_forma_pagamento: porFormaPagamento
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const relatorioServicos = async (req, res) => {
  const { data_inicio, data_fim, colaborador_id, servico_id, forma_pagamento, cliente_id, status } = req.query;

  try {
    const where = { deletado: 'N' };
    if (data_inicio && data_fim) {
      where.data_hora = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    if (cliente_id && cliente_id !== 'todos') {
      where.cliente_id = cliente_id;
    }

    if (status && status !== 'todos') {
      where.status = status;
    }

    // Buscamos os agendamentos no período/filtros básicos
    const agendamentos = await Agendamento.findAll({ where, order: [['data_hora', 'DESC']] });

    // Colaboradores para mapear nomes
    const colaboradores = await Colaborador.findAll({ where: { deletado: 'N' } });
    const colabMap = new Map(colaboradores.map(c => [c.id, c.nome]));

    // Pagamentos associados a estes agendamentos
    const agendsIds = agendamentos.map(a => a.id);
    const pagamentosList = await Pagamento.findAll({
      where: {
        agendamento_id: { [Op.in]: agendsIds },
        deletado: 'N'
      }
    });

    const pagamentosMap = new Map();
    pagamentosList.forEach(p => {
      if (!pagamentosMap.has(p.agendamento_id)) {
        pagamentosMap.set(p.agendamento_id, []);
      }
      pagamentosMap.get(p.agendamento_id).push(p);
    });

    let mappedServicos = [];

    agendamentos.forEach(ag => {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }

      const pags = pagamentosMap.get(ag.id) || [];
      const formas = [...new Set(pags.map(p => p.forma_pagamento))];

      if (Array.isArray(itens)) {
        itens.forEach(item => {
          mappedServicos.push({
            id: `${ag.id}-${item.servico_id}`,
            agendamento_id: ag.id,
            agendamento_numero: ag.numero,
            data_hora: ag.data_hora,
            cliente_id: ag.cliente_id,
            cliente_nome: ag.cliente_nome || 'Nenhum',
            servico_id: item.servico_id,
            servico_nome: item.nome,
            valor: item.valor,
            duracao: item.duracao || 0,
            colaborador_id: item.colaborador_id,
            colaborador_nome: colabMap.get(item.colaborador_id) || 'Nenhum',
            auxiliar_id: item.auxiliar_id,
            auxiliar_nome: colabMap.get(item.auxiliar_id) || '',
            status: ag.status,
            formas_pagamento: formas,
            pagamentos: pags
          });
        });
      }
    });

    // Filtros no JS
    if (colaborador_id && colaborador_id !== 'todos') {
      mappedServicos = mappedServicos.filter(s => s.colaborador_id === colaborador_id || s.auxiliar_id === colaborador_id);
    }

    if (servico_id && servico_id !== 'todos') {
      mappedServicos = mappedServicos.filter(s => s.servico_id === servico_id);
    }

    if (forma_pagamento && forma_pagamento !== 'todos') {
      mappedServicos = mappedServicos.filter(s => s.formas_pagamento.includes(forma_pagamento));
    }

    // Totalizadores gerais
    let totalFaturamento = 0;
    let totalQuantidade = 0;
    let totalDuracao = 0;

    const porColaborador = {};
    const porServico = {};
    const porFormaPagamento = {};

    mappedServicos.forEach(s => {
      if (s.status === 'concluido') {
        totalFaturamento += s.valor;
        totalQuantidade += 1;
        totalDuracao += s.duracao || 0;

        // Por colaborador
        const colabName = s.colaborador_nome;
        porColaborador[colabName] = (porColaborador[colabName] || 0) + s.valor;

        // Por serviço
        const servName = s.servico_nome;
        porServico[servName] = (porServico[servName] || 0) + s.valor;
      }

      // Por forma de pagamento (se existirem pagamentos, distribuímos proporcionalmente ou agrupamos)
      if (s.status === 'concluido' && s.formas_pagamento && s.formas_pagamento.length > 0) {
        s.formas_pagamento.forEach(forma => {
          porFormaPagamento[forma] = (porFormaPagamento[forma] || 0) + (s.valor / s.formas_pagamento.length);
        });
      }
    });

    res.json({
      servicos: mappedServicos,
      totais: {
        total_faturamento: totalFaturamento,
        total_quantidade: totalQuantidade,
        total_duracao: totalDuracao,
        por_colaborador: porColaborador,
        por_servico: porServico,
        por_forma_pagamento: porFormaPagamento
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { dashboard, relatorioDre, relatorioCaixa, relatorioProdutos, relatorioServicos };
