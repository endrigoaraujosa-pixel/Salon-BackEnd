import Agendamento from '../models/Agendamento.js';
import Pagamento from '../models/Pagamento.js';
import Cliente from '../models/Cliente.js';
import Colaborador from '../models/Colaborador.js';
import Produto from '../models/Produto.js';
import Despesa from '../models/Despesa.js';
import TaxaCartao from '../models/TaxaCartao.js';
import VendaDireta from '../models/VendaDireta.js';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';

const dashboard = async (req, res) => {
  try {
    const totalClientes = await Cliente.count();
    const totalColaboradores = await Colaborador.count({ where: { ativo: true } });
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59`;
    
    const agHoje = await Agendamento.count({ 
      where: { 
        data_hora: { [Op.between]: [todayStart, todayEnd] } 
      } 
    });
    
    const mesPrefix = todayStr.substring(0, 7); // YYYY-MM
    const dataInicioMes = `${mesPrefix}-01T00:00:00`;
    const dataFimMes = `${mesPrefix}-31T23:59:59`;

    const pagamentosMes = await Pagamento.findAll({ 
      where: { 
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] } 
      } 
    });
    const faturamentoMes = pagamentosMes.reduce((acc, p) => acc + p.valor, 0);
    
    const concluidos = await Agendamento.count({
      where: {
        status: 'concluido',
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] }
      }
    });
    
    const ticketMedio = concluidos ? (faturamentoMes / concluidos) : 0;
    const estoqueBaixo = await Produto.count({
      where: {
        ativo: true,
        quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
      }
    });

    res.json({
      total_clientes: totalClientes,
      total_colaboradores: totalColaboradores,
      agendamentos_hoje: agHoje,
      faturamento_mes: faturamentoMes,
      ticket_medio: ticketMedio,
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
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] }
      }
    });
    const receitaServicos = ags.reduce((acc, a) => acc + a.valor_total, 0);
    
    const vendas = await VendaDireta.findAll({
      where: {
        status: 'pago',
        data_venda: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] }
      }
    });
    const receitaVendas = vendas.reduce((acc, v) => acc + v.valor_total, 0);

    let custoProdutos = 0;
    for (const v of vendas) {
      const prod = await Produto.findByPk(v.produto_id);
      if (prod) {
        custoProdutos += v.quantidade * (prod.custo_unitario || 0);
      }
    }

    const outrasReceitas = 0;
    const receitaBruta = receitaServicos + receitaVendas + outrasReceitas;

    // Despesas do período
    const despesas = await Despesa.findAll({
      where: {
        data_vencimento: { [Op.between]: [data_inicio, data_fim] }
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
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] }
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
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] }
      }
    });
    
    let filteredPags = pagsAg;

    if (colaborador_id && colaborador_id !== 'todos') {
      const agendamentos = await Agendamento.findAll();
      const vendas = await VendaDireta.findAll();

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
  try {
    res.json({ produtos: [] });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { dashboard, relatorioDre, relatorioCaixa, relatorioProdutos };
