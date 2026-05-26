import Agendamento from '../models/Agendamento.js';
import Pagamento from '../models/Pagamento.js';
import Cliente from '../models/Cliente.js';
import Colaborador from '../models/Colaborador.js';
import Produto from '../models/Produto.js';
import Despesa from '../models/Despesa.js';
import TaxaCartao from '../models/TaxaCartao.js';
import VendaDireta from '../models/VendaDireta.js';
import OutrasReceitas from '../models/OutrasReceitas.js';
import Categoria from '../models/Categoria.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';

const dashboard = async (req, res) => {
  try {
    let colabId = null;
    if (req.user && req.user.role === 'funcionario') {
      const colab = await Colaborador.findOne({
        where: { nome: req.user.name, deletado: 'N' }
      });
      if (colab) {
        colabId = colab.id;
      }
    }

    let totalClientes = 0;
    if (colabId) {
      // Find agendamentos belonging to this professional to identify their unique clients
      const colabAgs = await Agendamento.findAll({ where: { deletado: 'N' } });
      const clientNames = new Set();
      colabAgs.forEach(ag => {
        let itens = [];
        try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
        if (Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId)) {
          if (ag.cliente_nome) clientNames.add(ag.cliente_nome.toLowerCase().trim());
        }
      });
      totalClientes = clientNames.size;
    } else {
      totalClientes = await Cliente.count({ where: { deletado: 'N' } });
    }

    const totalColaboradores = colabId ? 1 : await Colaborador.count({ where: { ativo: true, deletado: 'N' } });
    
    const { data_inicio, data_fim } = req.query;
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59`;
    
    const mesPrefix = todayStr.substring(0, 7); // YYYY-MM
    let dataInicioMes = data_inicio ? `${data_inicio}T00:00:00` : `${mesPrefix}-01T00:00:00`;
    let dataFimMes = data_fim ? `${data_fim}T23:59:59` : `${mesPrefix}-31T23:59:59`;
    
    // For agendamentos_hoje / no período
    const allAgsPeriod = await Agendamento.findAll({
      where: {
        data_hora: { [Op.between]: [data_inicio ? dataInicioMes : todayStart, data_fim ? dataFimMes : todayEnd] },
        deletado: 'N'
      }
    });

    let agHoje;
    if (colabId) {
      agHoje = allAgsPeriod.filter(ag => {
        let itens = [];
        try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
        return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
      }).length;
    } else {
      agHoje = allAgsPeriod.length;
    }
    const concluidosAgs = await Agendamento.findAll({
      where: {
        status: 'concluido',
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      }
    });

    const isAdmin = req.user && req.user.role === 'admin';
    let faturamentoMes = 0;

    if (isAdmin) {
      const receitaServicos = concluidosAgs.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);

      const vendas = await VendaDireta.findAll({
        where: {
          status: 'pago',
          data_venda: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        }
      });
      const receitaVendas = vendas.reduce((acc, v) => acc + (v.valor_pago || v.valor_total || 0), 0);

      const inicioMesDate = dataInicioMes.split('T')[0];
      const fimMesDate = dataFimMes.split('T')[0];
      const oReceitas = await OutrasReceitas.findAll({
        where: {
          deletado: 'N',
          [Op.or]: [
            { data_vencimento: { [Op.between]: [inicioMesDate, fimMesDate] } },
            { data_recebimento: { [Op.between]: [inicioMesDate, fimMesDate] } }
          ]
        }
      });
      const outrasReceitas = oReceitas.reduce((acc, r) => acc + (r.valor || 0), 0);

      faturamentoMes = receitaServicos + receitaVendas + outrasReceitas;
    }

    let filteredConcluidos = concluidosAgs;
    if (colabId) {
      filteredConcluidos = concluidosAgs.filter(ag => {
        let itens = [];
        try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
        return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
      });
    }
    const concluidos = filteredConcluidos.length;
    
    const ticketMedio = concluidos ? (faturamentoMes / concluidos) : 0;
    const estoqueBaixo = await Produto.count({
      where: {
        ativo: true,
        quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
      }
    });
    
    const servicosContagem = {};
    filteredConcluidos.forEach(ag => {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }
      if (Array.isArray(itens)) {
        itens.forEach(item => {
          if (!colabId || item.colaborador_id === colabId || item.auxiliar_id === colabId) {
            if (!servicosContagem[item.nome]) {
              servicosContagem[item.nome] = { nome: item.nome, qtd: 0, total: 0 };
            }
            servicosContagem[item.nome].qtd += 1;
            servicosContagem[item.nome].total += (item.valor || 0);
          }
        });
      }
    });
    const topServicos = Object.values(servicosContagem)
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 5);

    res.json({
      total_clientes: totalClientes,
      total_colaboradores: totalColaboradores,
      agendamentos_hoje: agHoje,
      faturamento_mes: isAdmin ? faturamentoMes : 0,
      ticket_medio: isAdmin ? ticketMedio : 0,
      atendimentos_mes: concluidos,
      estoque_baixo: estoqueBaixo,
      top_servicos: topServicos
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const dashboardDetail = async (req, res) => {
  const { metric, data_inicio, data_fim, service_name } = req.query;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const mesPrefix = todayStr.substring(0, 7);
  
  let dataInicioMes = data_inicio ? `${data_inicio}T00:00:00` : `${mesPrefix}-01T00:00:00`;
  let dataFimMes = data_fim ? `${data_fim}T23:59:59` : `${mesPrefix}-31T23:59:59`;
  
  try {
    const isAdmin = req.user && req.user.role === 'admin';

    let colabId = null;
    if (req.user && req.user.role === 'funcionario') {
      const colab = await Colaborador.findOne({
        where: { nome: req.user.name, deletado: 'N' }
      });
      if (colab) {
        colabId = colab.id;
      }
    }

    if (metric === 'faturamento') {
      if (!isAdmin) {
        return res.status(403).json({ detail: 'Acesso negado' });
      }

      // Load completed appointments
      const ags = await Agendamento.findAll({
        where: {
          status: 'concluido',
          data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        },
        order: [['data_hora', 'DESC']]
      });

      // Load paid sales
      const vendas = await VendaDireta.findAll({
        where: {
          status: 'pago',
          data_venda: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        },
        order: [['data_venda', 'DESC']]
      });

      // Load other revenues
      const inicioMesDate = dataInicioMes.split('T')[0];
      const fimMesDate = dataFimMes.split('T')[0];
      const oReceitas = await OutrasReceitas.findAll({
        where: {
          deletado: 'N',
          [Op.or]: [
            { data_vencimento: { [Op.between]: [inicioMesDate, fimMesDate] } },
            { data_recebimento: { [Op.between]: [inicioMesDate, fimMesDate] } }
          ]
        }
      });

      const details = [];

      // Map services
      ags.forEach(ag => {
        let itemsStr = '-';
        let parsed = [];
        try {
          parsed = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
        } catch (e) {
          parsed = ag.itens || [];
        }
        if (Array.isArray(parsed) && parsed.length > 0) {
          itemsStr = parsed.map(item => item.nome).join(', ');
        }
        details.push({
          id: ag.id,
          numero: ag.numero ? `${String(ag.numero).padStart(6, '0')} | S` : '-',
          cliente: ag.cliente_nome || 'Consumidor',
          itens: itemsStr,
          valor: ag.valor_pago || ag.valor_total || 0,
          data_hora: ag.data_hora,
          forma_pagamento: ag.forma_pagamento || 'N/A',
          tipo: 'servico'
        });
      });

      // Map product sales
      vendas.forEach(v => {
        details.push({
          id: v.id,
          numero: v.numero_venda ? `${String(v.numero_venda).padStart(6, '0')} | V` : '-',
          cliente: v.cliente_nome || 'Consumidor',
          itens: v.produto_nome || '-',
          valor: v.valor_pago || v.valor_total || 0,
          data_hora: v.data_venda,
          forma_pagamento: v.forma_pagamento || 'N/A',
          tipo: 'venda'
        });
      });

      // Map other revenues
      oReceitas.forEach(r => {
        details.push({
          id: r.id,
          numero: r.numero_documento || '-',
          cliente: r.cliente || 'Outros',
          itens: r.descricao || 'Outra Receita',
          valor: r.valor || 0,
          data_hora: r.data_recebimento || r.data_vencimento || r.data_documento || '',
          forma_pagamento: r.forma_pagamento || 'N/A',
          tipo: 'outro'
        });
      });

      // Sort details by date/time descending
      details.sort((a, b) => new Date(b.data_hora) - new Date(a.data_hora));

      return res.json({ details });
    }

    if (metric === 'agendamentos' || metric === 'atendimentos' || metric === 'ticket_medio') {
      const where = {
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      };

      if (metric === 'atendimentos' || metric === 'ticket_medio') {
        where.status = 'concluido';
      }

      const ags = await Agendamento.findAll({
        where,
        order: [['data_hora', 'DESC']]
      });

      if (colabId) {
        const filtered = ags.filter(ag => {
          let itens = [];
          try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
          return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
        });
        return res.json({ details: filtered });
      }

      return res.json({ details: ags });
    }

    if (metric === 'clientes') {
      const clientes = await Cliente.findAll({
        where: { deletado: 'N' },
        order: [['nome', 'ASC']]
      });

      if (colabId) {
        const colabAgs = await Agendamento.findAll({ where: { deletado: 'N' } });
        const clientNames = new Set();
        colabAgs.forEach(ag => {
          let itens = [];
          try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
          if (Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId)) {
            if (ag.cliente_nome) clientNames.add(ag.cliente_nome.toLowerCase().trim());
          }
        });
        const filteredClientes = clientes.filter(c => c.nome && clientNames.has(c.nome.toLowerCase().trim()));
        return res.json({ details: filteredClientes });
      }

      return res.json({ details: clientes });
    }

    if (metric === 'estoque') {
      const produtos = await Produto.findAll({
        where: {
          ativo: true,
          quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
        },
        order: [['nome', 'ASC']]
      });
      return res.json({ details: produtos });
    }

    if (metric === 'top_servico') {
      const ags = await Agendamento.findAll({
        where: {
          status: 'concluido',
          data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        },
        order: [['data_hora', 'DESC']]
      });

      const details = [];
      ags.forEach(ag => {
        let itens = [];
        try {
          itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
        } catch (e) {
          itens = ag.itens || [];
        }
        if (Array.isArray(itens)) {
          itens.forEach(item => {
            if (item.nome === service_name) {
              if (!colabId || item.colaborador_id === colabId || item.auxiliar_id === colabId) {
                details.push({
                  id: `${ag.id}-${item.servico_id}`,
                  agendamento_id: ag.id,
                  numero: ag.numero,
                  data_hora: ag.data_hora,
                  cliente_nome: ag.cliente_nome || 'Consumidor',
                  servico_nome: item.nome,
                  valor: item.valor,
                  status: ag.status
                });
              }
            }
          });
        }
      });

      return res.json({ details });
    }

    return res.status(400).json({ detail: 'Métrica inválida' });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};


const relatorioDre = async (req, res) => {
  const { data_inicio, data_fim, categoria, status } = req.query;
  const todayStr = new Date().toLocaleDateString('en-CA');
  const now = new Date();

  try {
    // Resolve dynamic categories mapping
    const categories = await Categoria.findAll({ where: { deletado: 'N' } });
    const categoryMap = {}; // id -> name
    const categoryMapByName = {}; // name -> id
    categories.forEach(c => {
      categoryMap[c.id] = c.nome;
      categoryMapByName[c.nome.toLowerCase()] = c.id;
    });

    let targetCatId = null;
    let targetCatName = null;
    if (categoria && categoria !== 'todos') {
      if (categoryMap[categoria]) {
        targetCatId = categoria;
        targetCatName = categoryMap[categoria];
      } else if (categoryMapByName[categoria.toLowerCase()]) {
        targetCatId = categoryMapByName[categoria.toLowerCase()];
        targetCatName = categoria;
      } else {
        targetCatName = categoria;
      }
    }

    // ---------------------------------------------
    // 1. REVENUE: SERVICES (AGENDAMENTOS)
    // ---------------------------------------------
    const agsWhere = {
      data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
      deletado: 'N'
    };

    if (status && status !== 'todos') {
      if (status === 'pago') {
        agsWhere.status = 'concluido';
      } else if (status === 'pendente') {
        agsWhere.status = { [Op.in]: ['agendado', 'confirmado'] };
        agsWhere.data_hora = { [Op.gte]: now };
      } else if (status === 'vencido') {
        agsWhere.status = { [Op.in]: ['agendado', 'confirmado'] };
        agsWhere.data_hora = { [Op.lt]: now };
      } else if (status === 'cancelado') {
        agsWhere.status = 'cancelado';
      }
    } else {
      // Default to completed services for actual standard DRE faturamento
      agsWhere.status = 'concluido';
    }

    let ags = await Agendamento.findAll({ where: agsWhere });

    // Category filter for Agendamento services
    if (targetCatId || targetCatName) {
      ags = ags.filter(a => {
        let items = [];
        try {
          items = typeof a.itens === 'string' ? JSON.parse(a.itens) : a.itens;
        } catch (e) {
          items = a.itens || [];
        }
        return Array.isArray(items) && items.some(item => {
          const itemCatId = item.categoria_id;
          const itemCatName = categoryMap[itemCatId];
          if (targetCatId && String(itemCatId) === String(targetCatId)) return true;
          if (targetCatName && itemCatName && itemCatName.toLowerCase() === targetCatName.toLowerCase()) return true;
          return false;
        });
      });
    }

    const receitaServicos = ags.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);

    // ---------------------------------------------
    // 2. REVENUE: DIRECT SALES (VENDAS DIRETAS)
    // ---------------------------------------------
    const vendasWhere = {
      data_venda: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
      deletado: 'N'
    };

    if (status && status !== 'todos') {
      if (status === 'pago') {
        vendasWhere.status = 'pago';
      } else if (status === 'pendente') {
        vendasWhere.status = { [Op.in]: ['aberto', 'pendente'] };
        vendasWhere.data_venda = { [Op.gte]: todayStr };
      } else if (status === 'vencido') {
        vendasWhere.status = { [Op.in]: ['aberto', 'pendente'] };
        vendasWhere.data_venda = { [Op.lt]: todayStr };
      } else if (status === 'cancelado') {
        vendasWhere.status = 'cancelado';
      }
    } else {
      vendasWhere.status = 'pago';
    }

    let vendas = await VendaDireta.findAll({ where: vendasWhere });

    // Fetch and filter by product category in memory if requested
    const productIds = [...new Set(vendas.map(v => v.produto_id))];
    const products = productIds.length > 0 ? await Produto.findAll({ where: { id: { [Op.in]: productIds } } }) : [];
    const productsMap = new Map(products.map(p => [p.id, p]));

    if (targetCatId || targetCatName) {
      vendas = vendas.filter(v => {
        const prod = productsMap.get(v.produto_id);
        if (!prod) return false;
        const prodCatId = prod.categoria_id;
        const prodCatName = prod.categoria || categoryMap[prodCatId];
        if (targetCatId && String(prodCatId) === String(targetCatId)) return true;
        if (targetCatName && prodCatName && prodCatName.toLowerCase() === targetCatName.toLowerCase()) return true;
        return false;
      });
    }

    const receitaVendas = vendas.reduce((acc, v) => acc + (v.valor_pago || v.valor_total || 0), 0);

    let custoProdutos = 0;
    for (const v of vendas) {
      const prod = productsMap.get(v.produto_id);
      if (prod) {
        custoProdutos += v.quantidade * (prod.custo_unitario || 0);
      }
    }

    // ---------------------------------------------
    // 3. REVENUE: OTHER REVENUES (OUTRAS RECEITAS)
    // ---------------------------------------------
    const oReceitasWhere = {
      deletado: 'N'
    };

    // If filter status is 'pago' / 'recebido', we look at data_recebimento. Otherwise data_vencimento
    if (status === 'pago') {
      oReceitasWhere.recebido = true;
      oReceitasWhere.data_recebimento = { [Op.between]: [data_inicio, data_fim] };
    } else if (status === 'pendente') {
      oReceitasWhere.recebido = false;
      oReceitasWhere.status = 'Aberto';
      oReceitasWhere[Op.and] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_vencimento: { [Op.gte]: todayStr } }
      ];
    } else if (status === 'vencido') {
      oReceitasWhere.recebido = false;
      oReceitasWhere.status = 'Aberto';
      oReceitasWhere[Op.and] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_vencimento: { [Op.lt]: todayStr } }
      ];
    } else if (status === 'cancelado') {
      oReceitasWhere.status = 'Cancelado';
      oReceitasWhere.data_vencimento = { [Op.between]: [data_inicio, data_fim] };
    } else {
      // All statuses — match by vencimento OR recebimento in period
      oReceitasWhere[Op.or] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_recebimento: { [Op.between]: [data_inicio, data_fim] } }
      ];
    }

    if (targetCatName) {
      oReceitasWhere.categoria = targetCatName;
    }

    const oReceitas = await OutrasReceitas.findAll({ where: oReceitasWhere });
    const outrasReceitas = oReceitas.reduce((acc, r) => acc + (r.valor || 0), 0);

    const receitaBruta = receitaServicos + receitaVendas + outrasReceitas;

    // ---------------------------------------------
    // 4. EXPENSES: PAYABLES (DESPESAS)
    // ---------------------------------------------
    const despesasWhere = {
      deletado: 'N'
    };

    if (status === 'pago') {
      despesasWhere.pago = true;
      despesasWhere.data_pagamento = { [Op.between]: [data_inicio, data_fim] };
    } else if (status === 'pendente') {
      despesasWhere.pago = false;
      despesasWhere.status = 'Aberto';
      despesasWhere[Op.and] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_vencimento: { [Op.gte]: todayStr } }
      ];
    } else if (status === 'vencido') {
      despesasWhere.pago = false;
      despesasWhere.status = 'Aberto';
      despesasWhere[Op.and] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_vencimento: { [Op.lt]: todayStr } }
      ];
    } else if (status === 'cancelado') {
      despesasWhere.status = 'Cancelado';
      despesasWhere.data_vencimento = { [Op.between]: [data_inicio, data_fim] };
    } else {
      // All — match by vencimento OR pagamento in period
      despesasWhere[Op.or] = [
        { data_vencimento: { [Op.between]: [data_inicio, data_fim] } },
        { data_pagamento: { [Op.between]: [data_inicio, data_fim] } }
      ];
    }

    if (targetCatName) {
      despesasWhere.categoria = targetCatName;
    }

    const despesas = await Despesa.findAll({ where: despesasWhere });
    const despesasFixas = despesas.filter(d => d.tipo === 'fixo').reduce((acc, d) => acc + (d.valor || 0), 0);
    const despesasVariaveis = despesas.filter(d => d.tipo === 'variavel').reduce((acc, d) => acc + (d.valor || 0), 0);

    // Grouping category breakdown list for Despesas & Outras Receitas
    const despesasPorCategoria = {};
    const receitasPorCategoria = {};

    despesas.forEach(d => {
      const cat = d.categoria || 'Geral';
      despesasPorCategoria[cat] = (despesasPorCategoria[cat] || 0) + (d.valor || 0);
    });

    oReceitas.forEach(r => {
      const cat = r.categoria || 'Geral';
      receitasPorCategoria[cat] = (receitasPorCategoria[cat] || 0) + (r.valor || 0);
    });

    // ---------------------------------------------
    // 5. TRANSACTION FEES (TAXAS DE CARTÃO)
    // ---------------------------------------------
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

    // Standardized DRE output structure
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
      total_vendas_diretas: vendas.length,
      detalhes: {
        agendamentos: ags.map(a => ({
          id: a.id,
          descricao: `Serviço: ${a.cliente_nome || 'Consumidor'} (#${a.numero || 'N/A'})`,
          valor: a.valor_pago || a.valor_total || 0,
          data: a.data_hora ? (a.data_hora instanceof Date ? a.data_hora.toISOString() : String(a.data_hora)).split('T')[0] : '',
          categoria: 'Serviço',
          status: a.status
        })),
        vendas: vendas.map(v => ({
          id: v.id,
          descricao: `Venda Direta: ${v.produto_nome} (#${v.numero_venda || 'N/A'})`,
          valor: v.valor_pago || v.valor_total || 0,
          data: v.data_venda ? (v.data_venda instanceof Date ? v.data_venda.toISOString() : String(v.data_venda)).split('T')[0] : '',
          categoria: 'Venda de Produto',
          status: v.status
        })),
        outras_receitas: oReceitas.map(r => ({
          id: r.id,
          descricao: r.descricao,
          valor: r.valor,
          data: r.data_recebimento || r.data_vencimento || r.data_documento || '',
          categoria: r.categoria || 'Outros',
          status: r.status
        })),
        despesas: despesas.map(d => ({
          id: d.id,
          descricao: d.descricao,
          valor: d.valor,
          data: d.data_pagamento || d.data_vencimento || d.data_documento || '',
          categoria: d.categoria || 'Geral',
          tipo: d.tipo,
          status: d.status
        }))
      },
      despesas_por_categoria: despesasPorCategoria,
      receitas_por_categoria: receitasPorCategoria
    });
  } catch (error) {
    console.error('DRE ERROR:', error.message, error.stack);
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

    const agendamentoIds = [...new Set(pagsAg.map(p => p.agendamento_id).filter(Boolean))];
    const vendaDiretaIds = [...new Set(pagsAg.map(p => p.venda_direta_id).filter(Boolean))];

    const agendamentos = agendamentoIds.length > 0 
      ? await Agendamento.findAll({ where: { id: { [Op.in]: agendamentoIds }, deletado: 'N' } })
      : [];
      
    const vendas = vendaDiretaIds.length > 0
      ? await VendaDireta.findAll({ where: { id: { [Op.in]: vendaDiretaIds }, deletado: 'N' } })
      : [];

    const agMap = new Map(agendamentos.map(a => [a.id, a]));
    const vMap = new Map(vendas.map(v => [v.id, v]));
    
    let filteredPags = pagsAg;

    if (colaborador_id && colaborador_id !== 'todos') {
      filteredPags = pagsAg.filter(p => {
        if (p.agendamento_id) {
          const ag = agMap.get(p.agendamento_id);
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
          const v = vMap.get(p.venda_direta_id);
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

    const pagamentosDetalhes = filteredPags.map(p => {
      let numero = '-';
      let cliente = 'Consumidor';
      let itens = '-';
      
      if (p.agendamento_id) {
        const ag = agMap.get(p.agendamento_id);
        if (ag) {
          numero = ag.numero ? `${String(ag.numero).padStart(6, '0')} | S` : '-';
          cliente = ag.cliente_nome || 'Consumidor';
          
          let parsedItens = [];
          try {
            parsedItens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
          } catch (e) {
            parsedItens = ag.itens || [];
          }
          if (Array.isArray(parsedItens) && parsedItens.length > 0) {
            itens = parsedItens.map(item => item.nome).join(', ');
          }
        }
      } else if (p.venda_direta_id) {
        const v = vMap.get(p.venda_direta_id);
        if (v) {
          numero = v.numero_venda ? `${String(v.numero_venda).padStart(6, '0')} | V` : '-';
          cliente = v.cliente_nome || 'Consumidor';
          itens = v.produto_nome || '-';
        }
      }

      return {
        id: p.id,
        numero,
        cliente,
        itens,
        valor: p.valor,
        data_hora: p.data_hora,
        forma_pagamento: p.forma_pagamento
      };
    });

    res.json({
      data_inicio,
      data_fim,
      totais,
      total_pagamentos: filteredPags.length,
      pagamentos: pagamentosDetalhes
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
            valor_original: item.valor_original !== undefined ? item.valor_original : item.valor,
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

export { dashboard, dashboardDetail, relatorioDre, relatorioCaixa, relatorioProdutos, relatorioServicos };
