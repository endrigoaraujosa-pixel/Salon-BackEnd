import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getClienteModel } from '../models/Cliente.js';
import { getVendaDiretaModel } from '../models/VendaDireta.js';
import { getOutrasReceitasModel } from '../models/OutrasReceitas.js';
import { getProdutoModel } from '../models/Produto.js';
import { getPagamentoModel } from '../models/Pagamento.js';
import { getCategoriaModel } from '../models/Categoria.js';
import { getDespesaModel } from '../models/Despesa.js';
import { getTaxaCartaoModel } from '../models/TaxaCartao.js';
import { getServicoModel } from '../models/Servico.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';
import { getColaboradorComissaoServicoModel } from '../models/ColaboradorComissaoServico.js';

const normalizeName = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const getQuantidadeCustoEstoque = (produto, quantidade = produto?.quantidade_estoque) => {
  const qtd = Number(quantidade || 0);
  const qtdPorUnidade = Number(produto?.quantidade_por_unidade || 0);
  return qtdPorUnidade > 0 ? qtd / qtdPorUnidade : qtd;
};

const isCardPayment = (p, ratesList) => {
  return p.cartao_tipo !== null || ratesList.some(r => r.forma_pagamento === p.forma_pagamento);
};

const calculatePaymentFee = (p, rates) => {
  if (p.cartao_taxa_valor !== null && p.cartao_taxa_valor !== undefined) {
    return {
      taxa_valor: Number(p.cartao_taxa_valor),
      taxa_percentual: p.cartao_taxa_percentual !== null && p.cartao_taxa_percentual !== undefined ? Number(p.cartao_taxa_percentual) : null
    };
  }

  // Fallback calculation for legacy payments or missing metadata
  const rate = rates.find(r => r.forma_pagamento === p.forma_pagamento);
  if (rate) {
    const tipo = rate.tipo_cartao || (p.forma_pagamento === 'cartao_credito' ? 'credito' : p.forma_pagamento === 'cartao_debito' ? 'debito' : null);
    let percentual = 0;
    if (tipo === 'credito') {
      const selectedParcela = Math.min(12, Math.max(1, parseInt(p.cartao_parcelas) || 1));
      const taxaField = `taxa_${selectedParcela}x`;
      percentual = rate[taxaField] !== undefined && rate[taxaField] !== null ? Number(rate[taxaField]) : Number(rate.percentual || 0);
    } else {
      percentual = Number(rate.percentual || 0);
    }
    const taxa_valor = Number(((p.valor * percentual) / 100).toFixed(2));
    return {
      taxa_valor,
      taxa_percentual: percentual
    };
  }

  // If no rate is configured, fall back to defaults
  const tipo = p.cartao_tipo || (p.forma_pagamento === 'cartao_credito' ? 'credito' : p.forma_pagamento === 'cartao_debito' ? 'debito' : null);
  const percentual = tipo === 'credito' ? 2.5 : 1.5;
  const taxa_valor = Number(((p.valor * percentual) / 100).toFixed(2));
  return {
    taxa_valor,
    taxa_percentual: percentual
  };
};

const dashboard = async (req, res) => {
  try {
    const { data_inicio, data_fim, colaborador_id } = req.query;

    const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' }, order: [['nome', 'ASC']] });

    let userMappedColabId = null;
    if (req.user) {
      if (req.user.colaborador_id) {
        userMappedColabId = req.user.colaborador_id;
      } else if (req.user.role === 'funcionario') {
        const normalizedUserName = normalizeName(req.user.name);
        const colab = colaboradores.find(c => normalizeName(c.nome) === normalizedUserName);
        if (colab) {
          userMappedColabId = colab.id;
        }
      }
    }

    let colabId = null;
    if (colaborador_id === 'todos') {
      colabId = null;
    } else if (colaborador_id) {
      colabId = colaborador_id;
    }

    // Total de clientes sempre reflete o total geral do sistema (independente do filtro de colaborador)
    const totalClientes = await getClienteModel().count({ where: { deletado: 'N' } });

    const totalColaboradores = await getColaboradorModel().count({ where: { ativo: true, deletado: 'N' } });
    
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const todayStart = `${todayStr}T00:00:00`;
    const todayEnd = `${todayStr}T23:59:59`;
    
    const mesPrefix = todayStr.substring(0, 7); // YYYY-MM
    const [year, month] = mesPrefix.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    let dataInicioMes = data_inicio ? `${data_inicio}T00:00:00` : `${mesPrefix}-01T00:00:00`;
    let dataFimMes = data_fim ? `${data_fim}T23:59:59` : `${mesPrefix}-${String(lastDay).padStart(2, '0')}T23:59:59`;
    
    // For agendamentos_hoje / no período
    const allAgsPeriod = await getAgendamentoModel().findAll({
      attributes: ['id', 'itens'],
      where: {
        data_hora: { [Op.between]: [data_inicio ? dataInicioMes : todayStart, data_fim ? dataFimMes : todayEnd] },
        deletado: 'N',
        status: { [Op.ne]: 'cancelado' }
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
    const concluidosAgs = await getAgendamentoModel().findAll({
      attributes: ['id', 'itens', 'valor_pago', 'valor_total'],
      where: {
        status: 'concluido',
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      }
    });

    const isAdmin = req.user && (req.user.role === 'admin' || req.user.perfil?.permissoes?.['dashboard.faturamento'] === true);
    let faturamentoMes = 0;

    if (isAdmin) {
      const receitaServicos = concluidosAgs.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);

      const vendas = await getVendaDiretaModel().findAll({
        where: {
          status: 'pago',
          data_venda: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        }
      });
      const receitaVendas = vendas.reduce((acc, v) => acc + (v.valor_pago || v.valor_total || 0), 0);

      const inicioMesDate = dataInicioMes.split('T')[0];
      const fimMesDate = dataFimMes.split('T')[0];
      const oReceitas = await getOutrasReceitasModel().findAll({
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
    const estoqueBaixo = await getProdutoModel().count({
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

    // Get all scheduled/confirmed appointments in the period
    const agendadosAgs = await getAgendamentoModel().findAll({
      attributes: ['id', 'itens'],
      where: {
        status: { [Op.in]: ['agendado', 'confirmado'] },
        data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
        deletado: 'N'
      }
    });

    let filteredAgendados = agendadosAgs;
    if (colabId) {
      filteredAgendados = agendadosAgs.filter(ag => {
        let itens = [];
        try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
        return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
      });
    }

    const agendadosContagem = {};
    filteredAgendados.forEach(ag => {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }
      if (Array.isArray(itens)) {
        itens.forEach(item => {
          if (!colabId || item.colaborador_id === colabId || item.auxiliar_id === colabId) {
            if (!agendadosContagem[item.nome]) {
              agendadosContagem[item.nome] = { nome: item.nome, qtd: 0, total: 0 };
            }
            agendadosContagem[item.nome].qtd += 1;
            agendadosContagem[item.nome].total += (item.valor || 0);
          }
        });
      }
    });

    const servicosAgendadosResumo = Object.values(agendadosContagem)
      .sort((a, b) => b.qtd - a.qtd);

    const totalServicosAgendados = servicosAgendadosResumo.reduce((acc, s) => acc + s.qtd, 0);

    res.json({
      total_clientes: totalClientes,
      total_colaboradores: totalColaboradores,
      agendamentos_hoje: agHoje,
      faturamento_mes: isAdmin ? faturamentoMes : 0,
      ticket_medio: isAdmin ? ticketMedio : 0,
      atendimentos_mes: concluidos,
      estoque_baixo: estoqueBaixo,
      top_servicos: topServicos,
      servicos_agendados: servicosAgendadosResumo,
      total_servicos_agendados: totalServicosAgendados,
      colaboradores: colaboradores.map(c => ({ id: c.id, nome: c.nome }))
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const dashboardDetail = async (req, res) => {
  const { metric, data_inicio, data_fim, service_name, colaborador_id } = req.query;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const mesPrefix = todayStr.substring(0, 7);
    const [year, month] = mesPrefix.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    
    let dataInicioMes = data_inicio ? `${data_inicio}T00:00:00` : `${mesPrefix}-01T00:00:00`;
    let dataFimMes = data_fim ? `${data_fim}T23:59:59` : `${mesPrefix}-${String(lastDay).padStart(2, '0')}T23:59:59`;
    
    try {
      const isAdmin = req.user && (req.user.role === 'admin' || req.user.perfil?.permissoes?.['dashboard.faturamento'] === true);

      const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' } });

      let userMappedColabId = null;
      if (req.user) {
        if (req.user.colaborador_id) {
          userMappedColabId = req.user.colaborador_id;
        } else if (req.user.role === 'funcionario') {
          const normalizedUserName = normalizeName(req.user.name);
          const colab = colaboradores.find(c => normalizeName(c.nome) === normalizedUserName);
          if (colab) {
            userMappedColabId = colab.id;
          }
        }
      }

      let colabId = null;
      if (colaborador_id === 'todos') {
        colabId = null;
      } else if (colaborador_id) {
        colabId = colaborador_id;
      }

    if (metric === 'faturamento') {
      if (!isAdmin) {
        return res.status(403).json({ detail: 'Acesso negado' });
      }

      // Load completed appointments
      const ags = await getAgendamentoModel().findAll({
        where: {
          status: 'concluido',
          data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        },
        order: [['data_hora', 'DESC']]
      });

      // Load paid sales
      const vendas = await getVendaDiretaModel().findAll({
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
      const oReceitas = await getOutrasReceitasModel().findAll({
        where: {
          deletado: 'N',
          [Op.or]: [
            { data_vencimento: { [Op.between]: [inicioMesDate, fimMesDate] } },
            { data_recebimento: { [Op.between]: [inicioMesDate, fimMesDate] } }
          ]
        }
      });

      // Fetch associated payments to resolve split payment methods
      const agendamentoIds = ags.map(a => a.id).filter(Boolean);
      const vendaIds = vendas.map(v => v.id).filter(Boolean);

      const orClauses = [];
      if (agendamentoIds.length > 0) {
        orClauses.push({ agendamento_id: { [Op.in]: agendamentoIds } });
      }
      if (vendaIds.length > 0) {
        orClauses.push({ venda_direta_id: { [Op.in]: vendaIds } });
      }

      let payments = [];
      if (orClauses.length > 0) {
        payments = await getPagamentoModel().findAll({
          where: {
            deletado: 'N',
            [Op.or]: orClauses
          }
        });
      }

      const agPaymentsMap = {};
      const vdPaymentsMap = {};

      payments.forEach(p => {
        if (p.agendamento_id) {
          if (!agPaymentsMap[p.agendamento_id]) agPaymentsMap[p.agendamento_id] = [];
          agPaymentsMap[p.agendamento_id].push(p);
        }
        if (p.venda_direta_id) {
          if (!vdPaymentsMap[p.venda_direta_id]) vdPaymentsMap[p.venda_direta_id] = [];
          vdPaymentsMap[p.venda_direta_id].push(p);
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

        const agPayments = agPaymentsMap[ag.id] || [];
        const forms = [...new Set(agPayments.map(p => p.forma_pagamento).filter(Boolean))];
        const formaPagamento = forms.length > 0 ? forms.join(' / ') : (ag.forma_pagamento || 'N/A');

        details.push({
          id: ag.id,
          numero: ag.numero ? `${String(ag.numero).padStart(6, '0')} | S` : '-',
          cliente: ag.cliente_nome || 'Consumidor',
          itens: itemsStr,
          valor: ag.valor_pago || ag.valor_total || 0,
          data_hora: ag.data_hora,
          forma_pagamento: formaPagamento,
          tipo: 'servico'
        });
      });

      // Map product sales
      vendas.forEach(v => {
        const vdPayments = vdPaymentsMap[v.id] || [];
        const forms = [...new Set(vdPayments.map(p => p.forma_pagamento).filter(Boolean))];
        const formaPagamento = forms.length > 0 ? forms.join(' / ') : (v.forma_pagamento || 'N/A');

        details.push({
          id: v.id,
          numero: v.numero_venda ? `${String(v.numero_venda).padStart(6, '0')} | V` : '-',
          cliente: v.cliente_nome || 'Consumidor',
          itens: v.produto_nome || '-',
          valor: v.valor_pago || v.valor_total || 0,
          data_hora: v.data_venda,
          forma_pagamento: formaPagamento,
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
      } else {
        where.status = { [Op.ne]: 'cancelado' };
      }

      const ags = await getAgendamentoModel().findAll({
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
      const clientes = await getClienteModel().findAll({
        where: { deletado: 'N' },
        order: [['nome', 'ASC']]
      });

      if (colabId) {
        const colabAgs = await getAgendamentoModel().findAll({
          attributes: ['itens', 'cliente_nome'],
          where: { deletado: 'N' }
        });
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
      const produtos = await getProdutoModel().findAll({
        where: {
          ativo: true,
          quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
        },
        order: [['nome', 'ASC']]
      });
      return res.json({ details: produtos });
    }

    if (metric === 'top_servico') {
      const ags = await getAgendamentoModel().findAll({
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

    if (metric === 'servicos_agendados') {
      const ags = await getAgendamentoModel().findAll({
        attributes: ['id', 'itens'],
        where: {
          status: { [Op.in]: ['agendado', 'confirmado'] },
          data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        }
      });

      let filtered = ags;
      if (colabId) {
        filtered = ags.filter(ag => {
          let itens = [];
          try { itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens; } catch(e) {}
          return Array.isArray(itens) && itens.some(item => item.colaborador_id === colabId || item.auxiliar_id === colabId);
        });
      }

      const contagem = {};
      filtered.forEach(ag => {
        let itens = [];
        try {
          itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
        } catch (e) {
          itens = ag.itens || [];
        }
        if (Array.isArray(itens)) {
          itens.forEach(item => {
            if (!colabId || item.colaborador_id === colabId || item.auxiliar_id === colabId) {
              if (!contagem[item.nome]) {
                contagem[item.nome] = { nome: item.nome, qtd: 0, total: 0 };
              }
              contagem[item.nome].qtd += 1;
              contagem[item.nome].total += (item.valor || 0);
            }
          });
        }
      });

      const details = Object.values(contagem).sort((a, b) => b.qtd - a.qtd);
      return res.json({ details });
    }

    if (metric === 'servicos_agendados_detalhe') {
      const ags = await getAgendamentoModel().findAll({
        where: {
          status: { [Op.in]: ['agendado', 'confirmado'] },
          data_hora: { [Op.between]: [dataInicioMes, dataFimMes] },
          deletado: 'N'
        },
        order: [['data_hora', 'ASC']]
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
                const colab = colaboradores.find(c => c.id === item.colaborador_id);
                const colabNome = colab ? colab.nome : '—';
                details.push({
                  id: `${ag.id}-${item.servico_id}`,
                  agendamento_id: ag.id,
                  numero: ag.numero,
                  data_hora: ag.data_hora,
                  cliente_nome: ag.cliente_nome || 'Consumidor',
                  servico_nome: item.nome,
                  colaborador_nome: colabNome,
                  valor: item.valor || 0,
                  status: ag.status
                });
              }
            }
          });
        }
      });

      // Sort details chronologically ascending (data crescente, horário crescente)
      details.sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

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
    const categories = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
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

    let ags = await getAgendamentoModel().findAll({ where: agsWhere });

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

    let vendas = await getVendaDiretaModel().findAll({ where: vendasWhere });

    // Fetch and filter by product category in memory if requested
    const productIds = [...new Set(vendas.map(v => v.produto_id))];
    const products = productIds.length > 0 ? await getProdutoModel().findAll({ where: { id: { [Op.in]: productIds } } }) : [];
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
      let saleCost = 0;
      const itens = Array.isArray(v.itens) && v.itens.length > 0 ? v.itens : [];
      if (itens.length > 0) {
        for (const item of itens) {
          if (item.custo_unitario !== undefined && item.custo_unitario !== null) {
            saleCost += Number(item.quantidade) * Number(item.custo_unitario);
          } else {
            const prod = productsMap.get(item.produto_id);
            saleCost += Number(item.quantidade) * (prod ? Number(prod.custo_unitario || 0) : 0);
          }
        }
      } else {
        const prod = productsMap.get(v.produto_id);
        saleCost += Number(v.quantidade || 0) * (prod ? Number(prod.custo_unitario || 0) : 0);
      }
      custoProdutos += saleCost;
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

    const oReceitas = await getOutrasReceitasModel().findAll({ where: oReceitasWhere });
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

    const despesas = await getDespesaModel().findAll({ where: despesasWhere });
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
    let rates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' } });
    if (rates.length === 0) {
      await getTaxaCartaoModel().bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true }
      ]);
      rates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' } });
    }
    const defaultCreditoRate = rates.find(r => r.forma_pagamento === 'cartao_credito');
    const defaultDebitoRate = rates.find(r => r.forma_pagamento === 'cartao_debito');
    const creditoDias = defaultCreditoRate ? (defaultCreditoRate.dias_recebimento || 0) : 30;
    const debitoDias = defaultDebitoRate ? (defaultDebitoRate.dias_recebimento || 0) : 1;

    const payments = await getPagamentoModel().findAll({
      where: {
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });

    const cardPayments = payments.filter(p => isCardPayment(p, rates));

    const taxasCredito = cardPayments
      .filter(p => {
        const rate = rates.find(r => r.forma_pagamento === p.forma_pagamento);
        const tipo = rate?.tipo_cartao || p.cartao_tipo || (p.forma_pagamento === 'cartao_credito' ? 'credito' : 'debito');
        return tipo === 'credito';
      })
      .reduce((acc, p) => acc + calculatePaymentFee(p, rates).taxa_valor, 0);

    const taxasDebito = cardPayments
      .filter(p => {
        const rate = rates.find(r => r.forma_pagamento === p.forma_pagamento);
        const tipo = rate?.tipo_cartao || p.cartao_tipo || (p.forma_pagamento === 'cartao_debito' ? 'debito' : null);
        return tipo === 'debito';
      })
      .reduce((acc, p) => acc + calculatePaymentFee(p, rates).taxa_valor, 0);

    const taxasTotal = taxasCredito + taxasDebito;

    // Calcular Prazo Médio de Recebimento (PMR) ponderado
    let totalWeightedDays = 0;
    let totalPaymentVolume = 0;
    payments.forEach(p => {
      let dias = 0;
      if (isCardPayment(p, rates)) {
        const rate = rates.find(r => r.forma_pagamento === p.forma_pagamento);
        const tipo = rate?.tipo_cartao || p.cartao_tipo || (p.forma_pagamento === 'cartao_credito' ? 'credito' : 'debito');
        if (tipo === 'credito') {
          dias = rate ? (rate.dias_recebimento !== null && rate.dias_recebimento !== undefined ? rate.dias_recebimento : 30) : creditoDias;
        } else {
          dias = rate ? (rate.dias_recebimento !== null && rate.dias_recebimento !== undefined ? rate.dias_recebimento : 1) : debitoDias;
        }
      }
      totalWeightedDays += p.valor * dias;
      totalPaymentVolume += p.valor;
    });
    const pmr = totalPaymentVolume > 0 ? Math.round(totalWeightedDays / totalPaymentVolume) : 0;

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
        total: taxasTotal,
        credito_dias: creditoDias,
        debito_dias: debitoDias,
        pmr: pmr
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
    // Buscar agendamentos cujas datas/horas estão no período selecionado
    const agendamentosNoPeriodo = await getAgendamentoModel().findAll({
      where: {
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    const agendamentoIds = agendamentosNoPeriodo.map(a => a.id);

    // Buscar vendas diretas cujas datas estão no período selecionado
    const vendasNoPeriodo = await getVendaDiretaModel().findAll({
      where: {
        data_venda: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N'
      }
    });
    const vendaDiretaIds = vendasNoPeriodo.map(v => v.id);

    // Buscar pagamentos correspondentes a esses agendamentos ou vendas diretas, ou sem vínculo mas no período
    const orConditions = [];
    if (agendamentoIds.length > 0) {
      orConditions.push({ agendamento_id: { [Op.in]: agendamentoIds } });
    }
    if (vendaDiretaIds.length > 0) {
      orConditions.push({ venda_direta_id: { [Op.in]: vendaDiretaIds } });
    }
    orConditions.push({
      agendamento_id: null,
      venda_direta_id: null,
      data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] }
    });

    const pagsAg = await getPagamentoModel().findAll({
      where: {
        deletado: 'N',
        [Op.or]: orConditions
      }
    });

    const allAgendamentoIds = [...new Set(pagsAg.map(p => p.agendamento_id).filter(Boolean))];
    const allVendaDiretaIds = [...new Set(pagsAg.map(p => p.venda_direta_id).filter(Boolean))];

    const agendamentos = allAgendamentoIds.length > 0 
      ? await getAgendamentoModel().findAll({ where: { id: { [Op.in]: allAgendamentoIds }, deletado: 'N' } })
      : [];
      
    const vendas = allVendaDiretaIds.length > 0
      ? await getVendaDiretaModel().findAll({ where: { id: { [Op.in]: allVendaDiretaIds }, deletado: 'N' } })
      : [];

    const agMap = new Map(agendamentos.map(a => [a.id, a]));
    const vMap = new Map(vendas.map(v => [v.id, v]));
    
    // Fetch all active colaboradores to resolve names for agendamentos/vendas
    const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' } });
    const colabMap = new Map(colaboradores.map(c => [c.id, c.nome]));
    
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

    const totais = { dinheiro: 0, pix: 0, cartao_credito: 0, cartao_debito: 0, vale: 0, credito_cliente: 0, geral: 0, troco: 0, bruto: 0 };
    filteredPags.forEach(p => {
      const pValor = Number(p.valor || 0);
      const pTroco = Number(p.troco || 0);
      const pRecebido = Number(p.valor_recebido || 0);

      totais.geral += pValor;
      totais.troco += pTroco;
      totais.bruto += pRecebido;

      if (p.forma_pagamento === 'cartao_credito' || p.cartao_tipo === 'credito') {
        totais.cartao_credito += pValor;
      } else if (p.forma_pagamento === 'cartao_debito' || p.cartao_tipo === 'debito') {
        totais.cartao_debito += pValor;
      } else if (totais.hasOwnProperty(p.forma_pagamento)) {
        totais[p.forma_pagamento] += pValor;
      }
    });

    // Rounding to avoid float precision issues
    totais.geral = Number(totais.geral.toFixed(2));
    totais.troco = Number(totais.troco.toFixed(2));
    totais.bruto = Number(totais.bruto.toFixed(2));
    totais.dinheiro = Number(totais.dinheiro.toFixed(2));
    totais.pix = Number(totais.pix.toFixed(2));
    totais.cartao_credito = Number(totais.cartao_credito.toFixed(2));
    totais.cartao_debito = Number(totais.cartao_debito.toFixed(2));
    totais.vale = Number(totais.vale.toFixed(2));
    totais.credito_cliente = Number(totais.credito_cliente.toFixed(2));

    const pagamentosDetalhes = filteredPags.map(p => {
      let numero = '-';
      let cliente = 'Consumidor';
      let itens = '-';
      let tipo = 'outro';
      let profissional = '-';
      let usuario_recebimento = 'Sistema';
      let valor_total_operacao = 0;
      let status_operacao = '-';
      let data_hora = p.data_hora;
      
      if (p.agendamento_id) {
        const ag = agMap.get(p.agendamento_id);
        if (ag) {
          numero = ag.numero ? `${String(ag.numero).padStart(6, '0')} | S` : '-';
          cliente = ag.cliente_nome || 'Consumidor';
          tipo = 'servico';
          valor_total_operacao = ag.valor_total || 0;
          status_operacao = ag.status || '-';
          usuario_recebimento = ag.criado_por_nome || 'Sistema';
          data_hora = ag.data_hora;
          
          let parsedItens = [];
          try {
            parsedItens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
          } catch (e) {
            parsedItens = ag.itens || [];
          }
          if (Array.isArray(parsedItens) && parsedItens.length > 0) {
            itens = parsedItens.map(item => item.nome).join(', ');
          }

          // Resolve professionals involved in service items or from ag.profissionais
          const profNamesSet = new Set();
          if (ag.profissionais) {
            let parsedProfs = [];
            try {
              parsedProfs = typeof ag.profissionais === 'string' ? JSON.parse(ag.profissionais) : ag.profissionais;
            } catch (e) {}
            if (Array.isArray(parsedProfs)) {
              parsedProfs.forEach(pr => { if (pr.nome) profNamesSet.add(pr.nome); });
            }
          }
          if (profNamesSet.size === 0 && Array.isArray(parsedItens)) {
            parsedItens.forEach(item => {
              if (item.colaborador_id && colabMap.has(item.colaborador_id)) profNamesSet.add(colabMap.get(item.colaborador_id));
              if (item.auxiliar_id && colabMap.has(item.auxiliar_id)) profNamesSet.add(colabMap.get(item.auxiliar_id));
            });
          }
          profissional = [...profNamesSet].join(', ') || '-';
        }
      } else if (p.venda_direta_id) {
        const v = vMap.get(p.venda_direta_id);
        if (v) {
          numero = v.numero_venda ? `${String(v.numero_venda).padStart(6, '0')} | V` : '-';
          cliente = v.cliente_nome || 'Consumidor';
          itens = v.produto_nome || '-';
          tipo = 'venda';
          valor_total_operacao = v.valor_total || 0;
          status_operacao = v.status || '-';
          usuario_recebimento = v.criado_por_nome || 'Sistema';
          profissional = v.colaborador_nome || (v.colaborador_id && colabMap.get(v.colaborador_id)) || '-';
          data_hora = v.data_venda;
        }
      }

      return {
        id: p.id,
        numero,
        cliente,
        itens,
        valor: p.valor,
        valor_recebido: p.valor_recebido,
        troco: p.troco,
        data_hora,
        forma_pagamento: p.forma_pagamento,
        cartao_tipo: p.cartao_tipo || (p.forma_pagamento === 'cartao_credito' ? 'credito' : p.forma_pagamento === 'cartao_debito' ? 'debito' : null),
        tipo,
        profissional,
        usuario_recebimento,
        valor_total_operacao,
        status_operacao
      };
    });

    // Ordenar pagamentos cronologicamente pela data do agendamento/venda correspondente
    pagamentosDetalhes.sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

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
  const {
    data_inicio,
    data_fim,
    colaborador_id,
    produto_id,
    categoria,
    forma_pagamento,
    cliente_id,
    status,
    page = 1,
    limit = 50,
    search = '',
    sort_field = 'data_venda',
    sort_direction = 'desc'
  } = req.query;

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
    const vendas = await getVendaDiretaModel().findAll({ where, order: [['data_venda', 'DESC']] });

    // Precisamos buscar os produtos para filtrar por categoria e obter custo unitário
    const produtosIds = [...new Set(vendas.map(v => v.produto_id))];
    const produtosList = await getProdutoModel().findAll({
      where: {
        id: { [Op.in]: produtosIds }
      }
    });
    const produtosMap = new Map(produtosList.map(p => [p.id, p]));

    // Precisamos buscar os pagamentos associados a essas vendas
    const vendasIds = vendas.map(v => v.id);
    const pagamentosList = await getPagamentoModel().findAll({
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

      let custoTotal = 0;
      const itens = Array.isArray(v.itens) && v.itens.length > 0 ? v.itens : [];
      if (itens.length > 0) {
        for (const item of itens) {
          if (item.custo_unitario !== undefined && item.custo_unitario !== null) {
            custoTotal += Number(item.quantidade) * Number(item.custo_unitario);
          } else {
            const itemProd = produtosMap.get(item.produto_id);
            custoTotal += Number(item.quantidade) * (itemProd ? Number(itemProd.custo_unitario || 0) : 0);
          }
        }
      } else {
        custoTotal = v.quantidade * custoUnitario;
      }

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
        custo_total: custoTotal,
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

    const normalizedSearch = String(search || '').trim().toLowerCase();
    if (normalizedSearch) {
      mappedVendas = mappedVendas.filter(v => {
        const numStr = v.numero_venda ? String(v.numero_venda).padStart(6, '0') : '';
        const formattedNum = v.numero_venda ? `${numStr} | V`.toLowerCase() : '';
        return (
          String(v.produto_nome || '').toLowerCase().includes(normalizedSearch) ||
          String(v.colaborador_nome || '').toLowerCase().includes(normalizedSearch) ||
          String(v.cliente_nome || '').toLowerCase().includes(normalizedSearch) ||
          String(v.categoria || '').toLowerCase().includes(normalizedSearch) ||
          numStr.includes(normalizedSearch) ||
          formattedNum.includes(normalizedSearch)
        );
      });
    }

    const sortField = String(sort_field || 'data_venda');
    const sortDirection = sort_direction === 'asc' ? 'asc' : 'desc';
    mappedVendas.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

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

    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 50);
    const totalRecords = mappedVendas.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
    const currentPage = Math.min(Math.max(parseInt(page, 10) || 1, 1), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedVendas = mappedVendas.slice(startIndex, startIndex + pageSize);

    res.json({
      vendas: paginatedVendas,
      pagination: {
        page: currentPage,
        limit: pageSize,
        total: totalRecords,
        pages: totalPages
      },
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
    } else {
      where.status = { [Op.ne]: 'cancelado' };
    }

    // Buscamos os agendamentos no período/filtros básicos
    const agendamentos = await getAgendamentoModel().findAll({ where, order: [['data_hora', 'DESC']] });

    // Colaboradores para mapear nomes
    const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' } });
    const colabMap = new Map(colaboradores.map(c => [c.id, c.nome]));

    // Pagamentos associados a estes agendamentos
    const agendsIds = agendamentos.map(a => a.id);
    const pagamentosList = await getPagamentoModel().findAll({
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

const relatorioResultadoOperacional = async (req, res) => {
  const { data_inicio, data_fim, colaborador_id, categoria_servico, categoria_produto } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ detail: 'Defina o período de datas (data_inicio e data_fim)' });
  }

  try {
    const systemConfig = await getConfiguracaoSistemaModel().findOne();
    const descontar_taxa_cartao_comissao = systemConfig ? !!systemConfig.descontar_taxa_cartao_comissao : false;

    // 1. Fetch auxiliary catalogs
    const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' } });
    const colabMap = new Map(colaboradores.map(c => [c.id, c]));
    const colabNameMap = new Map(colaboradores.map(c => [c.id, c.nome]));

    const ColabComissaoServicoModel = getColaboradorComissaoServicoModel();
    const comissoesAvancadas = await ColabComissaoServicoModel.findAll();
    const comissoesAvancadasMap = new Map();
    for (const c of comissoesAvancadas) {
      comissoesAvancadasMap.set(`${c.colaborador_id}_${c.servico_id}`, c);
    }

    const produtos = await getProdutoModel().findAll({ where: { deletado: 'N' } });
    const produtosMap = new Map(produtos.map(p => [p.id, p]));

    const servicos = await getServicoModel().findAll({ where: { deletado: 'N' } });
    const servicosMap = new Map(servicos.map(s => [s.id, s]));

    const categories = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoryMap = new Map(categories.map(c => [c.id, c.nome]));

    // 2. Fetch rates
    let rates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' } });
    if (rates.length === 0) {
      await getTaxaCartaoModel().bulkCreate([
        { forma_pagamento: 'cartao_credito', percentual: 2.5, ativo: true },
        { forma_pagamento: 'cartao_debito', percentual: 1.5, ativo: true }
      ]);
      rates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' } });
    }

    // 3. Fetch completed agendamentos in period
    const ags = await getAgendamentoModel().findAll({
      where: {
        status: 'concluido',
        deletado: 'N',
        data_hora: {
          [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
        }
      }
    });

    // 4. Fetch paid product sales in period
    const vendas = await getVendaDiretaModel().findAll({
      where: {
        status: 'pago',
        deletado: 'N',
        data_venda: {
          [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
        }
      }
    });

    // 5. Fetch associated payments
    const agIds = ags.map(a => a.id);
    const vIds = vendas.map(v => v.id);
    const payments = (agIds.length > 0 || vIds.length > 0)
      ? await getPagamentoModel().findAll({
          where: {
            [Op.or]: [
              { agendamento_id: { [Op.in]: agIds } },
              { venda_direta_id: { [Op.in]: vIds } }
            ],
            deletado: 'N'
          }
        })
      : [];

    const paymentsByAgId = {};
    const paymentsByVendaId = {};
    payments.forEach(p => {
      if (p.agendamento_id) {
        if (!paymentsByAgId[p.agendamento_id]) paymentsByAgId[p.agendamento_id] = [];
        paymentsByAgId[p.agendamento_id].push(p);
      }
      if (p.venda_direta_id) {
        if (!paymentsByVendaId[p.venda_direta_id]) paymentsByVendaId[p.venda_direta_id] = [];
        paymentsByVendaId[p.venda_direta_id].push(p);
      }
    });

    // Helper: calculate total transaction fee for a list of payments
    const getTxFee = (pags) => {
      if (!pags) return 0;
      return pags.reduce((acc, p) => {
        if (!isCardPayment(p, rates)) return acc;
        return acc + calculatePaymentFee(p, rates).taxa_valor;
      }, 0);
    };

    // Helper: get proportional cost of an insumo item
    const getCustoProp = (pu) => {
      if (pu.custo_proporcional !== undefined && Number(pu.custo_proporcional) > 0) {
        return Number(pu.custo_proporcional);
      }
      let custoUnitario = Number(pu.custo_unitario || 0);
      let qtyPorUnidade = Number(pu.quantidade_por_unidade || 0);
      if (custoUnitario === 0 || qtyPorUnidade === 0) {
        const prod = produtosMap.get(pu.produto_id);
        if (prod) {
          if (custoUnitario === 0) custoUnitario = Number(prod.custo_unitario || 0);
          if (qtyPorUnidade === 0) qtyPorUnidade = Number(prod.quantidade_por_unidade || 0);
        }
      }
      if (qtyPorUnidade > 0) {
        return custoUnitario / qtyPorUnidade;
      }
      return custoUnitario;
    };

    // ----------------------------------------------------
    // PROCESS SERVICES DATA
    // ----------------------------------------------------
    const listServicesFiltered = [];
    ags.forEach(ag => {
      let items = [];
      try {
        items = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        items = ag.itens || [];
      }
      if (!Array.isArray(items)) return;

      const agPayments = paymentsByAgId[ag.id] || [];
      const totalTxFee = getTxFee(agPayments);

      items.forEach(item => {
        // Filter by collaborator if requested
        if (colaborador_id && colaborador_id !== 'todos') {
          if (item.colaborador_id !== colaborador_id && item.auxiliar_id !== colaborador_id) {
            return;
          }
        }

        // Fetch category name
        const s_model = servicosMap.get(item.servico_id);
        const catId = s_model ? s_model.categoria_id : null;
        const catName = categoryMap.get(catId) || 'Outros';

        // Filter by service category if requested
        if (categoria_servico && categoria_servico !== 'todos') {
          if (String(catId) !== String(categoria_servico) && catName.toLowerCase() !== categoria_servico.toLowerCase()) {
            return;
          }
        }

        // Calculate insumos (cost of products utilized)
        let insumoCost = 0;
        const prodUtils = item.produtos_utilizados || [];
        prodUtils.forEach(pu => {
          const c_prop = getCustoProp(pu);
          insumoCost += Number(pu.quantidade || 0) * c_prop;
        });

        // Determine base commission
        let val_serv_comissao = Number(item.valor || 0);
        if (item.valor_original !== undefined && item.valor_original !== item.valor) {
          let descApplied = ag.desconto_aplicado;
          if (typeof descApplied === 'string') {
            try { descApplied = JSON.parse(descApplied); } catch (e) {}
          }
          if (descApplied && descApplied.incide_comissao === false) {
            val_serv_comissao = Number(item.valor_original || item.valor);
          }
        }

        const baseComOriginal = item.base_comissao_original !== undefined
          ? Number(item.base_comissao_original)
          : Math.max(0, val_serv_comissao - insumoCost);

        const taxa_cartao_descontada = item.taxa_cartao_descontada !== undefined
          ? Number(item.taxa_cartao_descontada)
          : 0;

        let baseCom = baseComOriginal;
        if (descontar_taxa_cartao_comissao) {
          baseCom = Math.max(0, baseComOriginal - taxa_cartao_descontada);
        }

        // Calculate principal collaborator commission
        let comissaoVal = 0;
        const colabPrincipal = colabMap.get(item.colaborador_id);
        if (colabPrincipal) {
          if (!colaborador_id || colaborador_id === 'todos' || String(item.colaborador_id) === String(colaborador_id)) {
            const temAuxiliar = !!(item.auxiliar_id && String(item.auxiliar_id).trim() !== "" && String(item.auxiliar_id).trim() !== "null");
            if (item.comissao_valor_calculado !== undefined && item.comissao_valor_calculado !== null) {
              comissaoVal += Number(item.comissao_valor_calculado);
            } else {
              let pct;
              if (colabPrincipal.usar_comissao_avancada) {
                const key = `${colabPrincipal.id}_${item.servico_id}`;
                const comAvancada = comissoesAvancadasMap.get(key);
                if (comAvancada) {
                  pct = temAuxiliar
                    ? Number(comAvancada.comissao_ajuda !== null && comAvancada.comissao_ajuda !== undefined ? comAvancada.comissao_ajuda : 30)
                    : Number(comAvancada.comissao_sozinho !== null && comAvancada.comissao_sozinho !== undefined ? comAvancada.comissao_sozinho : (comAvancada.comissao_principal || 0));
                } else {
                  pct = temAuxiliar
                    ? Number(colabPrincipal.comissao_ajuda != null ? colabPrincipal.comissao_ajuda : 30)
                    : Number(colabPrincipal.comissao_sozinho != null ? colabPrincipal.comissao_sozinho : (colabPrincipal.comissao_principal || 0));
                }
              } else {
                pct = temAuxiliar
                  ? Number(colabPrincipal.comissao_ajuda != null ? colabPrincipal.comissao_ajuda : 30)
                  : Number(colabPrincipal.comissao_sozinho != null ? colabPrincipal.comissao_sozinho : (colabPrincipal.comissao_principal || 0));
              }
              comissaoVal += baseCom * (pct / 100);
            }
          }
        }

        // Calculate auxiliary collaborator commission
        const colabAuxiliar = colabMap.get(item.auxiliar_id);
        if (colabAuxiliar) {
          if (!colaborador_id || colaborador_id === 'todos' || String(item.auxiliar_id) === String(colaborador_id)) {
            if (item.comissao_valor_calculado_auxiliar !== undefined && item.comissao_valor_calculado_auxiliar !== null) {
              comissaoVal += Number(item.comissao_valor_calculado_auxiliar);
            } else {
              let pct;
              if (colabAuxiliar.usar_comissao_avancada) {
                const key = `${colabAuxiliar.id}_${item.servico_id}`;
                const comAvancada = comissoesAvancadasMap.get(key);
                if (comAvancada) {
                  pct = Number(comAvancada.comissao_auxiliar !== null && comAvancada.comissao_auxiliar !== undefined ? comAvancada.comissao_auxiliar : 0);
                } else {
                  pct = Number(colabAuxiliar.comissao_auxiliar || 0);
                }
              } else {
                pct = Number(colabAuxiliar.comissao_auxiliar || 0);
              }
              comissaoVal += baseCom * (pct / 100);
            }
          }
        }

        // Calculate proportional fee
        const proportion = ag.valor_total > 0 ? (Number(item.valor || 0) / Number(ag.valor_total)) : (1 / items.length);
        const txFee = totalTxFee * proportion;

        listServicesFiltered.push({
          agendamento_id: ag.id,
          numero: ag.numero ? String(ag.numero).padStart(6, '0') + ' | S' : '-',
          data: ag.data_hora,
          cliente: ag.cliente_nome || 'Consumidor',
          profissional: colabNameMap.get(item.colaborador_id) || 'Nenhum',
          servico_nome: item.nome,
          faturamento: Number(item.valor || 0),
          insumos: Number(insumoCost.toFixed(2)),
          comissao: Number(comissaoVal.toFixed(2)),
          taxas: Number(txFee.toFixed(2)),
          resultado_operacional: Number((Number(item.valor || 0) - insumoCost - comissaoVal - txFee).toFixed(2))
        });
      });
    });

    // ----------------------------------------------------
    // PROCESS PRODUCTS DATA
    // ----------------------------------------------------
    const listProductsFiltered = [];
    vendas.forEach(v => {
      // Carrinho support
      const itensVenda = Array.isArray(v.itens) && v.itens.length > 0
        ? v.itens
        : [{ produto_id: v.produto_id, produto_nome: v.produto_nome, quantidade: v.quantidade, subtotal: v.valor_total, comissao_pct: null }];

      const vPayments = paymentsByVendaId[v.id] || [];
      const totalTxFee = getTxFee(vPayments);

      itensVenda.forEach(item => {
        // Filter by collaborator
        if (colaborador_id && colaborador_id !== 'todos') {
          if (v.colaborador_id !== colaborador_id) return;
        }

        // Fetch category
        const prod = produtosMap.get(item.produto_id);
        const catId = prod ? prod.categoria_id : null;
        const catName = prod ? (prod.categoria || categoryMap.get(catId) || 'Nenhuma') : 'Nenhuma';

        // Filter by product category
        if (categoria_produto && categoria_produto !== 'todos') {
          if (String(catId) !== String(categoria_produto) && catName.toLowerCase() !== categoria_produto.toLowerCase()) {
            return;
          }
        }

        // Fetch historical cost at sale or current fallback
        let itemCost = 0;
        if (item.custo_unitario !== undefined && item.custo_unitario !== null) {
          itemCost = Number(item.quantidade) * Number(item.custo_unitario);
        } else {
          itemCost = Number(item.quantidade) * (prod ? Number(prod.custo_unitario || 0) : 0);
        }

        // Calculate commission
        let pct = item.comissao_pct != null ? Number(item.comissao_pct) : null;
        if (pct == null) {
          pct = prod ? Number(prod.comissao || 0) : 0;
        }
        
        let val_item_comissao = Number(item.subtotal || item.preco_unitario * item.quantidade || 0);
        if (item.preco_unitario_original !== undefined) {
          let descApplied = v.desconto_aplicado;
          if (typeof descApplied === 'string') {
            try { descApplied = JSON.parse(descApplied); } catch (e) {}
          }
          if (descApplied && descApplied.incide_comissao === false) {
            val_item_comissao = Number(item.preco_unitario_original) * Number(item.quantidade);
          }
        }
        const comVal = val_item_comissao * (pct / 100);

        // Calculate proportional fee
        const proportion = v.valor_total > 0 ? (Number(item.subtotal || 0) / Number(v.valor_total)) : (1 / itensVenda.length);
        const txFee = totalTxFee * proportion;

        listProductsFiltered.push({
          venda_id: v.id,
          numero: v.numero_venda ? String(v.numero_venda).padStart(6, '0') + ' | V' : '-',
          data: v.data_venda,
          cliente: v.cliente_nome || 'Consumidor',
          profissional: v.colaborador_nome || 'Nenhum',
          produto_nome: item.produto_nome || (prod ? prod.nome : 'Produto Desconhecido'),
          quantidade: Number(item.quantidade || 0),
          faturamento: Number(item.subtotal || 0),
          cmv: Number(itemCost.toFixed(2)),
          comissao: Number(comVal.toFixed(2)),
          taxas: Number(txFee.toFixed(2)),
          resultado_operacional: Number((Number(item.subtotal || 0) - itemCost - comVal - txFee).toFixed(2))
        });
      });
    });

    // ----------------------------------------------------
    // AGGREGATION: RENTABILIDADE POR SERVIÇO
    // ----------------------------------------------------
    const servicesSummaryMap = {};
    listServicesFiltered.forEach(s => {
      const name = s.servico_nome;
      if (!servicesSummaryMap[name]) {
        servicesSummaryMap[name] = {
          servico_nome: name,
          quantidade: 0,
          faturamento: 0,
          comissao: 0,
          taxas: 0,
          insumos: 0,
          resultado_operacional: 0
        };
      }
      servicesSummaryMap[name].quantidade += 1;
      servicesSummaryMap[name].faturamento += s.faturamento;
      servicesSummaryMap[name].comissao += s.comissao;
      servicesSummaryMap[name].taxas += s.taxas;
      servicesSummaryMap[name].insumos += s.insumos;
      servicesSummaryMap[name].resultado_operacional += s.resultado_operacional;
    });

    const servicosSummaryList = Object.values(servicesSummaryMap).map(s => {
      s.faturamento = Number(s.faturamento.toFixed(2));
      s.comissao = Number(s.comissao.toFixed(2));
      s.taxas = Number(s.taxas.toFixed(2));
      s.insumos = Number(s.insumos.toFixed(2));
      s.resultado_operacional = Number(s.resultado_operacional.toFixed(2));
      s.margem = s.faturamento > 0 ? Number(((s.resultado_operacional / s.faturamento) * 100).toFixed(2)) : 0;
      return s;
    });

    // ----------------------------------------------------
    // AGGREGATION: RENTABILIDADE POR PRODUTO
    // ----------------------------------------------------
    const productsSummaryMap = {};
    listProductsFiltered.forEach(p => {
      const name = p.produto_nome;
      if (!productsSummaryMap[name]) {
        productsSummaryMap[name] = {
          produto_nome: name,
          quantidade: 0,
          faturamento: 0,
          cmv: 0,
          taxas: 0,
          comissao: 0,
          resultado_operacional: 0
        };
      }
      productsSummaryMap[name].quantidade += p.quantidade;
      productsSummaryMap[name].faturamento += p.faturamento;
      productsSummaryMap[name].cmv += p.cmv;
      productsSummaryMap[name].taxas += p.taxas;
      productsSummaryMap[name].comissao += p.comissao;
      productsSummaryMap[name].resultado_operacional += p.resultado_operacional;
    });

    const produtosSummaryList = Object.values(productsSummaryMap).map(p => {
      p.faturamento = Number(p.faturamento.toFixed(2));
      p.cmv = Number(p.cmv.toFixed(2));
      p.taxas = Number(p.taxas.toFixed(2));
      p.comissao = Number(p.comissao.toFixed(2));
      p.resultado_operacional = Number(p.resultado_operacional.toFixed(2));
      p.margem = p.faturamento > 0 ? Number(((p.resultado_operacional / p.faturamento) * 100).toFixed(2)) : 0;
      return p;
    });

    // ----------------------------------------------------
    // AGGREGATION: ANALÍTICO POR VENDA
    // ----------------------------------------------------
    const salesAnalyticMap = {};
    
    // Process Services
    listServicesFiltered.forEach(s => {
      const key = `S-${s.agendamento_id}`;
      if (!salesAnalyticMap[key]) {
        salesAnalyticMap[key] = {
          numero: s.numero,
          data: s.data,
          cliente: s.cliente,
          profissional: s.profissional,
          valor_produtos: 0,
          valor_servicos: 0,
          faturamento_total: 0,
          cmv: 0,
          comissao: 0,
          taxas: 0,
          resultado_operacional: 0
        };
      }
      salesAnalyticMap[key].valor_servicos += s.faturamento;
      salesAnalyticMap[key].faturamento_total += s.faturamento;
      salesAnalyticMap[key].cmv += s.insumos;
      salesAnalyticMap[key].comissao += s.comissao;
      salesAnalyticMap[key].taxas += s.taxas;
      salesAnalyticMap[key].resultado_operacional += s.resultado_operacional;
    });

    // Process Products
    listProductsFiltered.forEach(p => {
      const key = `V-${p.venda_id}`;
      if (!salesAnalyticMap[key]) {
        salesAnalyticMap[key] = {
          numero: p.numero,
          data: p.data,
          cliente: p.cliente,
          profissional: p.profissional,
          valor_produtos: 0,
          valor_servicos: 0,
          faturamento_total: 0,
          cmv: 0,
          comissao: 0,
          taxas: 0,
          resultado_operacional: 0
        };
      }
      salesAnalyticMap[key].valor_produtos += p.faturamento;
      salesAnalyticMap[key].faturamento_total += p.faturamento;
      salesAnalyticMap[key].cmv += p.cmv;
      salesAnalyticMap[key].comissao += p.comissao;
      salesAnalyticMap[key].taxas += p.taxas;
      salesAnalyticMap[key].resultado_operacional += p.resultado_operacional;
    });

    const salesAnalyticList = Object.values(salesAnalyticMap).map(sale => {
      sale.valor_produtos = Number(sale.valor_produtos.toFixed(2));
      sale.valor_servicos = Number(sale.valor_servicos.toFixed(2));
      sale.faturamento_total = Number(sale.faturamento_total.toFixed(2));
      sale.cmv = Number(sale.cmv.toFixed(2));
      sale.comissao = Number(sale.comissao.toFixed(2));
      sale.taxas = Number(sale.taxas.toFixed(2));
      sale.resultado_operacional = Number(sale.resultado_operacional.toFixed(2));
      sale.margem = sale.faturamento_total > 0 ? Number(((sale.resultado_operacional / sale.faturamento_total) * 100).toFixed(2)) : 0;
      return sale;
    });

    // ----------------------------------------------------
    // AGGREGATION: CONSOLIDADO
    // ----------------------------------------------------
    let receitaServicos = 0;
    let receitaProdutos = 0;
    let cmvTotal = 0;
    let comissoesTotal = 0;
    let taxasTotal = 0;

    listServicesFiltered.forEach(s => {
      receitaServicos += s.faturamento;
      cmvTotal += s.insumos;
      comissoesTotal += s.comissao;
      taxasTotal += s.taxas;
    });

    listProductsFiltered.forEach(p => {
      receitaProdutos += p.faturamento;
      cmvTotal += p.cmv;
      comissoesTotal += p.comissao;
      taxasTotal += p.taxas;
    });

    const receitaTotal = receitaServicos + receitaProdutos;
    const resultadoOperacional = receitaTotal - cmvTotal - comissoesTotal - taxasTotal;
    const margemOperacional = receitaTotal > 0 ? (resultadoOperacional / receitaTotal) * 100 : 0;

    const consolidado = {
      receita_servicos: Number(receitaServicos.toFixed(2)),
      receita_produtos: Number(receitaProdutos.toFixed(2)),
      receita_total: Number(receitaTotal.toFixed(2)),
      cmv: Number(cmvTotal.toFixed(2)),
      comissoes: Number(comissoesTotal.toFixed(2)),
      taxas: Number(taxasTotal.toFixed(2)),
      resultado_operacional: Number(resultadoOperacional.toFixed(2)),
      margem_operacional: Number(margemOperacional.toFixed(2))
    };

    res.json({
      consolidado,
      servicos: servicosSummaryList,
      produtos: produtosSummaryList,
      vendas: salesAnalyticList,
      detalhes_servicos: listServicesFiltered,
      detalhes_produtos: listProductsFiltered,
      descontar_taxa_cartao_comissao
    });
  } catch (error) {
    console.error('OPERATIONAL RESULT REPORT ERROR:', error.message, error.stack);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoque = async (req, res) => {
  const { categorias, produto_id } = req.query;

  try {
    const where = { deletado: 'N' };

    if (produto_id) {
      where.id = produto_id;
    }

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      if (typeof categorias === 'string') {
        categoriasIds = categorias.split(',').filter(Boolean);
      } else if (Array.isArray(categorias)) {
        categoriasIds = categorias.filter(Boolean);
      }
    }

    if (categoriasIds.length > 0) {
      where.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({
      where: { deletado: 'N' }
    });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const mappedProdutos = produtos.map(p => {
      const quantidadeCusto = getQuantidadeCustoEstoque(p);
      const valorTotalCusto = quantidadeCusto * (p.custo_unitario || 0);
      const valorTotalVenda = quantidadeCusto * (p.preco_venda || 0);
      const statusEstoque = (p.quantidade_estoque || 0) <= (p.estoque_minimo || 0) ? 'alerta' : 'normal';

      return {
        id: p.id,
        nome: p.nome,
        produto_nome: p.nome,
        categoria_id: p.categoria_id,
        categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
        unidade_medida: p.unidade_medida || 'un',
        quantidade_estoque: p.quantidade_estoque || 0,
        estoque_minimo: p.estoque_minimo || 0,
        custo_unitario: p.custo_unitario || 0,
        preco_venda: p.preco_venda || 0,
        valor_total_custo: valorTotalCusto,
        valor_total_venda: valorTotalVenda,
        status_estoque: statusEstoque,
        uso_exclusivo_servicos: p.uso_exclusivo_servicos || false,
        quantidade_por_unidade: p.quantidade_por_unidade || 0,
        quantidade_por_embalagem: p.quantidade_por_unidade || 0,
        unidade_medida_insumo: p.unidade_medida_insumo || ''
      };
    });

    let totalItens = 0;
    let totalCustoEstoque = 0;
    let totalVendaEstoque = 0;
    let itensAlerta = 0;

    mappedProdutos.forEach(p => {
      totalItens += p.quantidade_estoque;
      totalCustoEstoque += p.valor_total_custo;
      totalVendaEstoque += p.valor_total_venda;
      if (p.status_estoque === 'alerta') {
        itensAlerta += 1;
      }
    });

    const porCategoria = {};
    mappedProdutos.forEach(p => {
      const catName = p.categoria_nome;
      if (!porCategoria[catName]) {
        porCategoria[catName] = {
          quantidade_produtos: 0,
          total_itens: 0,
          valor_custo: 0,
          valor_venda: 0
        };
      }
      porCategoria[catName].quantidade_produtos += 1;
      porCategoria[catName].total_itens += p.quantidade_estoque;
      porCategoria[catName].valor_custo += p.valor_total_custo;
      porCategoria[catName].valor_venda += p.valor_total_venda;
    });

    res.json({
      produtos: mappedProdutos,
      totais: {
        total_produtos: mappedProdutos.length,
        total_itens: totalItens,
        total_custo: totalCustoEstoque,
        total_venda: totalVendaEstoque,
        itens_alerta: itensAlerta
      },
      por_categoria: porCategoria
    });
  } catch (error) {
    console.error('ESTOQUE REPORT ERROR:', error.message, error.stack);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioMovimentacaoEstoque = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    
    const where = {};
    if (data_inicio && data_fim) {
      where.criado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    if (produto_id) {
      where.produto_id = produto_id;
    }

    const movimentacoes = await getMovimentacaoEstoqueModel().findAll({
      where,
      order: [['criado_em', 'DESC']]
    });

    const vendaIds = [...new Set(movimentacoes.filter(m => m.referencia_id).map(m => m.referencia_id))];
    let vendasMap = new Map();
    if (vendaIds.length > 0) {
      const vendas = await getVendaDiretaModel().findAll({
        where: { id: { [Op.in]: vendaIds } }
      });
      vendasMap = new Map(vendas.map(v => [v.id, v]));
    }

    const produtosIds = [...new Set(movimentacoes.map(m => m.produto_id))];
    const whereProdutos = { id: { [Op.in]: produtosIds } };
    
    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }

    const produtos = await getProdutoModel().findAll({
      where: whereProdutos
    });
    const produtosMap = new Map(produtos.map(p => [p.id, p]));

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalAjustes = 0;

    const filtradas = movimentacoes.filter(m => {
      const prod = produtosMap.get(m.produto_id);
      if (!prod) return false;
      if (categoriasIds.length > 0 && !categoriasIds.includes(prod.categoria_id)) {
        return false;
      }
      return true;
    }).map(m => {
      const prod = produtosMap.get(m.produto_id);
      const catNome = prod ? (categoriesMap.get(prod.categoria_id) || prod.categoria || 'Sem Categoria') : 'Sem Categoria';
      
      const q = Math.abs(m.quantidade);
      if (m.tipo === 'entrada') totalEntradas += q;
      else if (m.tipo === 'saida') totalSaidas += q;
      else if (m.tipo === 'ajuste') totalAjustes += q;

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

      return {
        id: m.id,
        data: m.criado_em,
        criado_em: m.criado_em,
        produto_id: m.produto_id,
        produto_nome: m.produto_nome || (prod ? prod.nome : 'Produto Desconhecido'),
        categoria_nome: catNome,
        tipo: m.tipo,
        quantidade: m.quantidade,
        quantidade_anterior: m.quantidade_anterior,
        quantidade_atual: m.quantidade_atual,
        valor_unitario: m.valor_unitario || 0,
        valor_total: Math.abs(getQuantidadeCustoEstoque(prod, m.quantidade)) * (m.valor_unitario || 0),
        motivo: motivoFormatado,
        usuario_nome: m.usuario_nome || 'Sistema',
        unidade_medida: prod ? (prod.unidade_medida || 'un') : 'un',
        quantidade_por_unidade: prod ? (prod.quantidade_por_unidade || 0) : 0,
        quantidade_por_embalagem: prod ? (prod.quantidade_por_unidade || 0) : 0,
        unidade_medida_insumo: prod ? (prod.unidade_medida_insumo || '') : ''
      };
    });

    res.json({
      movimentacoes: filtradas,
      totais: {
        total_entradas: totalEntradas,
        total_saidas: totalSaidas,
        total_ajustes: totalAjustes,
        total_movimentacoes: filtradas.length
      }
    });
  } catch (error) {
    console.error('MOVIMENTACAO ESTOQUE ERROR:', error.message, error.stack);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueAbaixoMinimo = async (req, res) => {
  const { categorias, produto_id } = req.query;
  try {
    const where = {
      deletado: 'N',
      quantidade_estoque: { [Op.lte]: sequelize.col('estoque_minimo') }
    };

    if (produto_id) {
      where.id = produto_id;
    }

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }
    if (categoriasIds.length > 0) {
      where.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const mapped = produtos.map(p => {
      const diferenca = (p.estoque_minimo || 0) - (p.quantidade_estoque || 0);
      return {
        id: p.id,
        nome: p.nome,
        produto_nome: p.nome,
        categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
        unidade_medida: p.unidade_medida || 'un',
        quantidade_estoque: p.quantidade_estoque || 0,
        estoque_minimo: p.estoque_minimo || 0,
        diferenca: diferenca > 0 ? diferenca : 0,
        custo_unitario: p.custo_unitario || 0,
        valor_total_custo: getQuantidadeCustoEstoque(p) * (p.custo_unitario || 0),
        quantidade_por_unidade: p.quantidade_por_unidade || 0,
        quantidade_por_embalagem: p.quantidade_por_unidade || 0,
        unidade_medida_insumo: p.unidade_medida_insumo || ''
      };
    });

    res.json({
      produtos: mapped,
      totais: {
        total_produtos: mapped.length,
        total_itens: mapped.reduce((acc, p) => acc + p.quantidade_estoque, 0)
      }
    });
  } catch (error) {
    console.error('ABAIXO MINIMO ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueSemEstoque = async (req, res) => {
  const { categorias, produto_id } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const where = {
      deletado: 'N',
      quantidade_estoque: { [Op.lte]: 0 }
    };

    if (produto_id) {
      where.id = produto_id;
    }

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }
    if (categoriasIds.length > 0) {
      where.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const mapped = await Promise.all(produtos.map(async p => {
      const ultimaMov = await getMovimentacaoEstoqueModel().findOne({
        where: { produto_id: p.id },
        order: [['criado_em', 'DESC']]
      });

      return {
        id: p.id,
        nome: p.nome,
        produto_nome: p.nome,
        categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
        unidade_medida: p.unidade_medida || 'un',
        quantidade_estoque: p.quantidade_estoque || 0,
        estoque_minimo: p.estoque_minimo || 0,
        data_ultima_movimentacao: ultimaMov ? ultimaMov.criado_em : null,
        motivo_ultima_movimentacao: ultimaMov ? ultimaMov.motivo : 'Sem movimentações',
        quantidade_por_unidade: p.quantidade_por_unidade || 0,
        quantidade_por_embalagem: p.quantidade_por_unidade || 0,
        unidade_medida_insumo: p.unidade_medida_insumo || ''
      };
    }));

    res.json({
      produtos: mapped,
      totais: {
        total_sem_estoque: mapped.length
      }
    });
  } catch (error) {
    console.error('SEM ESTOQUE ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueValorizacao = async (req, res) => {
  const { categorias, produto_id } = req.query;
  try {
    const where = {
      deletado: 'N',
      quantidade_estoque: { [Op.gt]: 0 }
    };

    if (produto_id) {
      where.id = produto_id;
    }

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }
    if (categoriasIds.length > 0) {
      where.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    let totalCusto = 0;
    let totalVenda = 0;
    let totalItens = 0;

    const mapped = produtos.map(p => {
      const quantidadeCusto = getQuantidadeCustoEstoque(p);
      const vCusto = quantidadeCusto * (p.custo_unitario || 0);
      const vVenda = quantidadeCusto * (p.preco_venda || 0);
      const margemPotencial = vVenda - vCusto;

      totalCusto += vCusto;
      totalVenda += vVenda;
      totalItens += p.quantidade_estoque;

      return {
        id: p.id,
        nome: p.nome,
        produto_nome: p.nome,
        categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
        unidade_medida: p.unidade_medida || 'un',
        quantidade_estoque: p.quantidade_estoque || 0,
        custo_unitario: p.custo_unitario || 0,
        preco_venda: p.preco_venda || 0,
        valor_total_custo: vCusto,
        valor_total_venda: vVenda,
        margem_potencial: margemPotencial,
        quantidade_por_unidade: p.quantidade_por_unidade || 0,
        quantidade_por_embalagem: p.quantidade_por_unidade || 0,
        unidade_medida_insumo: p.unidade_medida_insumo || ''
      };
    });

    res.json({
      produtos: mapped,
      totais: {
        total_produtos: mapped.length,
        total_itens: totalItens,
        total_custo: totalCusto,
        total_venda: totalVenda,
        margem_potencial: totalVenda - totalCusto
      }
    });
  } catch (error) {
    console.error('VALORIZACAO ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueConsumoInsumos = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const whereAg = {
      status: 'concluido',
      deletado: 'N'
    };
    if (data_inicio && data_fim) {
      whereAg.data_hora = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    const agendamentos = await getAgendamentoModel().findAll({
      where: whereAg,
      order: [['data_hora', 'ASC']]
    });

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }

    const productsList = await getProdutoModel().findAll();
    const productsMap = new Map(productsList.map(p => [p.id, p]));

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const consumos = [];
    let totalConsumidoQty = 0;
    let totalCustoConsumo = 0;

    for (const ag of agendamentos) {
      const itens = Array.isArray(ag.itens) ? ag.itens : [];
      for (const item of itens) {
        const utilized = item.produtos_utilizados || [];
        for (const pu of utilized) {
          if (produto_id && pu.produto_id !== produto_id) continue;

          const prod = productsMap.get(pu.produto_id);
          if (categoriasIds.length > 0) {
            if (!prod || !categoriasIds.includes(prod.categoria_id)) {
              continue;
            }
          }

          const q = Number(pu.quantidade || 0);
          const custoProp = Number(pu.custo_proporcional || pu.custo_unitario || 0);
          const totalCusto = q * custoProp;

          totalConsumidoQty += q;
          totalCustoConsumo += totalCusto;

          consumos.push({
            agendamento_id: ag.id,
            agendamento_numero: ag.numero || ag.id,
            data: ag.data_hora,
            cliente_nome: ag.cliente_nome || 'Cliente Final',
            servico_nome: item.nome || 'Serviço',
            produto_id: pu.produto_id,
            produto_nome: pu.produto_nome || (prod ? prod.nome : 'Produto'),
            categoria_nome: prod ? (categoriesMap.get(prod.categoria_id) || prod.categoria || 'Sem Categoria') : 'Sem Categoria',
            quantidade: q,
            unidade_medida: prod ? (prod.unidade_medida || 'un') : 'un',
            unidade_medida_insumo: pu.unidade_medida_insumo || (prod ? prod.unidade_medida_insumo : 'un') || 'un',
            quantidade_por_unidade: prod ? (prod.quantidade_por_unidade || 0) : 0,
            quantidade_por_embalagem: prod ? (prod.quantidade_por_unidade || 0) : 0,
            custo_unitario: custoProp,
            custo_total: totalCusto,
            valor_total_custo: totalCusto
          });
        }
      }
    }

    res.json({
      consumos,
      totais: {
        total_itens: consumos.length,
        total_quantidade: totalConsumidoQty,
        total_custo: totalCustoConsumo
      }
    });
  } catch (error) {
    console.error('CONSUMO INSUMOS ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueMaisMovimentados = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const where = {};
    if (produto_id) {
      where.produto_id = produto_id;
    }
    if (data_inicio && data_fim) {
      where.criado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    const movimentacoes = await getMovimentacaoEstoqueModel().findAll({ where });

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }

    const produtos = await getProdutoModel().findAll({ where: { deletado: 'N' } });
    const produtosMap = new Map(produtos.map(p => [p.id, p]));

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const agrupado = {};
    for (const m of movimentacoes) {
      const prod = produtosMap.get(m.produto_id);
      if (!prod) continue;
      if (categoriasIds.length > 0 && !categoriasIds.includes(prod.categoria_id)) {
        continue;
      }

      if (!agrupado[m.produto_id]) {
        agrupado[m.produto_id] = {
          id: prod.id,
          nome: prod.nome,
          produto_nome: prod.nome,
          categoria_nome: categoriesMap.get(prod.categoria_id) || prod.categoria || 'Sem Categoria',
          entradas_qty: 0,
          saidas_qty: 0,
          ajustes_qty: 0,
          total_qty: 0
        };
      }

      const q = Math.abs(m.quantidade);
      if (m.tipo === 'entrada') {
        agrupado[m.produto_id].entradas_qty += q;
      } else if (m.tipo === 'saida') {
        agrupado[m.produto_id].saidas_qty += q;
      } else if (m.tipo === 'ajuste') {
        agrupado[m.produto_id].ajustes_qty += q;
      }
      agrupado[m.produto_id].total_qty += q;
    }

    const result = Object.values(agrupado).sort((a, b) => b.total_qty - a.total_qty);

    res.json({
      produtos: result,
      totais: {
        total_produtos: result.length,
        total_movimentado: result.reduce((acc, r) => acc + r.total_qty, 0)
      }
    });
  } catch (error) {
    console.error('MAIS MOVIMENTADOS ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueSemMovimentacao = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const whereMov = {};
    if (produto_id) {
      whereMov.produto_id = produto_id;
    }
    if (data_inicio && data_fim) {
      whereMov.criado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    const movimentacoes = await getMovimentacaoEstoqueModel().findAll({
      where: whereMov,
      attributes: ['produto_id']
    });
    const movProdutoIds = new Set(movimentacoes.map(m => m.produto_id));

    const whereProd = { deletado: 'N' };
    if (produto_id) {
      whereProd.id = produto_id;
    }
    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }
    if (categoriasIds.length > 0) {
      whereProd.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where: whereProd,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const result = [];
    for (const p of produtos) {
      if (movProdutoIds.has(p.id)) continue;

      const ultimaMov = await getMovimentacaoEstoqueModel().findOne({
        where: { produto_id: p.id },
        order: [['criado_em', 'DESC']]
      });

      const dataBase = ultimaMov ? new Date(ultimaMov.criado_em) : new Date(p.criado_em || new Date());
      const diffTime = Math.abs(new Date() - dataBase);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      result.push({
        id: p.id,
        nome: p.nome,
        produto_nome: p.nome,
        categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
        quantidade_estoque: p.quantidade_estoque || 0,
        custo_unitario: p.custo_unitario || 0,
        valor_total_custo: getQuantidadeCustoEstoque(p) * (p.custo_unitario || 0),
        data_ultima_mov: ultimaMov ? ultimaMov.criado_em : null,
        data_ultima_movimentacao: ultimaMov ? ultimaMov.criado_em : null,
        dias_sem_movimentacao: diffDays,
        unidade_medida: p.unidade_medida || 'un',
        quantidade_por_unidade: p.quantidade_por_unidade || 0,
        quantidade_por_embalagem: p.quantidade_por_unidade || 0,
        unidade_medida_insumo: p.unidade_medida_insumo || ''
      });
    }

    res.json({
      produtos: result,
      totais: {
        total_produtos: result.length,
        total_valor_custo: result.reduce((acc, p) => acc + p.valor_total_custo, 0)
      }
    });
  } catch (error) {
    console.error('SEM MOVIMENTACAO ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueHistoricoAjustes = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const where = {
      tipo: 'ajuste'
    };
    if (data_inicio && data_fim) {
      where.criado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }
    if (produto_id) {
      where.produto_id = produto_id;
    }

    const movimentacoes = await getMovimentacaoEstoqueModel().findAll({
      where,
      order: [['criado_em', 'DESC']]
    });

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }

    const produtos = await getProdutoModel().findAll();
    const produtosMap = new Map(produtos.map(p => [p.id, p]));

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const filtradas = movimentacoes.filter(m => {
      const prod = produtosMap.get(m.produto_id);
      if (categoriasIds.length > 0) {
        if (!prod || !categoriasIds.includes(prod.categoria_id)) {
          return false;
        }
      }
      return true;
    }).map(m => {
      const prod = produtosMap.get(m.produto_id);
      return {
        id: m.id,
        data: m.criado_em,
        criado_em: m.criado_em,
        produto_nome: m.produto_nome || (prod ? prod.nome : 'Produto'),
        categoria_nome: prod ? (categoriesMap.get(prod.categoria_id) || prod.categoria || 'Sem Categoria') : 'Sem Categoria',
        quantidade_anterior: m.quantidade_anterior || 0,
        quantidade_ajustada: m.quantidade,
        quantidade_atual: m.quantidade_atual || 0,
        motivo: m.motivo || '',
        usuario_nome: m.usuario_nome || 'Sistema',
        unidade_medida: prod ? (prod.unidade_medida || 'un') : 'un',
        quantidade_por_unidade: prod ? (prod.quantidade_por_unidade || 0) : 0,
        quantidade_por_embalagem: prod ? (prod.quantidade_por_unidade || 0) : 0,
        unidade_medida_insumo: prod ? (prod.unidade_medida_insumo || '') : ''
      };
    });

    res.json({
      ajustes: filtradas,
      totais: {
        total_ajustes: filtradas.length
      }
    });
  } catch (error) {
    console.error('HISTORICO AJUSTES ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoqueInventario = async (req, res) => {
  const { categorias, produto_id } = req.query;
  try {
    const where = { deletado: 'N' };
    if (produto_id) {
      where.id = produto_id;
    }
    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }
    if (categoriasIds.length > 0) {
      where.categoria_id = { [Op.in]: categoriasIds };
    }

    const produtos = await getProdutoModel().findAll({
      where,
      order: [['nome', 'ASC']]
    });

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    const mapped = produtos.map(p => ({
      id: p.id,
      nome: p.nome,
      produto_nome: p.nome,
      categoria_nome: categoriesMap.get(p.categoria_id) || p.categoria || 'Sem Categoria',
      unidade_medida: p.unidade_medida || 'un',
      quantidade_estoque: p.quantidade_estoque || 0,
      custo_unitario: p.custo_unitario || 0,
      valor_total_custo: getQuantidadeCustoEstoque(p) * (p.custo_unitario || 0),
      quantidade_por_unidade: p.quantidade_por_unidade || 0,
      quantidade_por_embalagem: p.quantidade_por_unidade || 0,
      unidade_medida_insumo: p.unidade_medida_insumo || ''
    }));

    res.json({
      produtos: mapped,
      totais: {
        total_produtos: mapped.length,
        total_itens: mapped.reduce((acc, p) => acc + p.quantidade_estoque, 0),
        total_custo: mapped.reduce((acc, p) => acc + p.valor_total_custo, 0)
      }
    });
  } catch (error) {
    console.error('INVENTARIO ERROR:', error.message);
    res.status(500).json({ detail: error.message });
  }
};

const relatorioEstoquePerdasQuebras = async (req, res) => {
  const { categorias, produto_id, data_inicio, data_fim } = req.query;
  try {
    const { getMovimentacaoEstoqueModel } = await import('../models/MovimentacaoEstoque.js');
    const where = {
      tipo: 'ajuste',
      quantidade: { [Op.lt]: 0 }
    };
    if (data_inicio && data_fim) {
      where.criado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }
    if (produto_id) {
      where.produto_id = produto_id;
    }

    const movimentacoes = await getMovimentacaoEstoqueModel().findAll({
      where,
      order: [['criado_em', 'DESC']]
    });

    let categoriasIds = [];
    if (categorias && categorias !== 'todos' && categorias !== '') {
      categoriasIds = (typeof categorias === 'string' ? categorias.split(',') : categorias).filter(Boolean);
    }

    const produtos = await getProdutoModel().findAll();
    const produtosMap = new Map(produtos.map(p => [p.id, p]));

    const categoriesList = await getCategoriaModel().findAll({ where: { deletado: 'N' } });
    const categoriesMap = new Map(categoriesList.map(c => [c.id, c.nome]));

    let totalPerdasQty = 0;
    let totalPerdasValor = 0;

    const filtradas = movimentacoes.filter(m => {
      const prod = produtosMap.get(m.produto_id);
      if (categoriasIds.length > 0) {
        if (!prod || !categoriasIds.includes(prod.categoria_id)) {
          return false;
        }
      }
      return true;
    }).map(m => {
      const prod = produtosMap.get(m.produto_id);
      const q = Math.abs(m.quantidade);
      const custo = m.valor_unitario || (prod ? prod.custo_unitario : 0) || 0;
      const vPerda = Math.abs(getQuantidadeCustoEstoque(prod, m.quantidade)) * custo;

      totalPerdasQty += q;
      totalPerdasValor += vPerda;

      return {
        id: m.id,
        data: m.criado_em,
        criado_em: m.criado_em,
        produto_nome: m.produto_nome || (prod ? prod.nome : 'Produto'),
        categoria_nome: prod ? (categoriesMap.get(prod.categoria_id) || prod.categoria || 'Sem Categoria') : 'Sem Categoria',
        quantidade: q,
        quantidade_perdida: q,
        custo_unitario: custo,
        valor_total: vPerda,
        motivo: m.motivo || '',
        usuario_nome: m.usuario_nome || 'Sistema',
        unidade_medida: prod ? (prod.unidade_medida || 'un') : 'un',
        quantidade_por_unidade: prod ? (prod.quantidade_por_unidade || 0) : 0,
        quantidade_por_embalagem: prod ? (prod.quantidade_por_unidade || 0) : 0,
        unidade_medida_insumo: prod ? (prod.unidade_medida_insumo || '') : ''
      };
    });

    res.json({
      perdas: filtradas,
      totais: {
        total_itens: filtradas.length,
        total_quantidade: totalPerdasQty,
        total_valor: totalPerdasValor
      }
    });
  } catch (error) {
    console.error('PERDAS QUEBRAS ERROR:', error.message);
    res.status(500).json({ detail: error.message });
    console.log('Finished rendering perdas quebras.');
  }
};

const relatorioCartoes = async (req, res) => {
  const { data_inicio, data_fim, adquirente_id, cartao_tipo, forma_pagamento } = req.query;

  if (!data_inicio || !data_fim) {
    return res.status(400).json({ detail: 'Defina o período de datas (data_inicio e data_fim)' });
  }

  try {
    const { getAdquirenteModel } = await import('../models/Adquirente.js');
    const { getTaxaCartaoModel } = await import('../models/TaxaCartao.js');

    // Carregar catálogos auxiliares
    const adquirentes = await getAdquirenteModel().findAll();
    const adqMap = new Map(adquirentes.map(a => [a.id, a.descricao]));

    const rates = await getTaxaCartaoModel().findAll({ where: { deletado: 'N' } });
    const rateDescMap = new Map(rates.map(r => [r.forma_pagamento, r.descricao]));

    // 1. Fetch payments that are card payments in the period
    const payments = await getPagamentoModel().findAll({
      where: {
        data_hora: { [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`] },
        deletado: 'N',
        [Op.or]: [
          { cartao_tipo: { [Op.not]: null } },
          { forma_pagamento: { [Op.in]: ['cartao_credito', 'cartao_debito'] } }
        ]
      },
      order: [['data_hora', 'DESC']]
    });

    // 2. Fetch related Agendamentos and Vendas to map their sequential identifiers
    const agendamentoIds = [...new Set(payments.map(p => p.agendamento_id).filter(Boolean))];
    const vendaDiretaIds = [...new Set(payments.map(p => p.venda_direta_id).filter(Boolean))];

    let agendamentoMap = new Map();
    if (agendamentoIds.length > 0) {
      const agendamentos = await getAgendamentoModel().findAll({
        attributes: ['id', 'numero'],
        where: { id: { [Op.in]: agendamentoIds } }
      });
      agendamentos.forEach(a => {
        if (a.numero !== null && a.numero !== undefined) {
          agendamentoMap.set(a.id, a.numero);
        }
      });
    }

    let vendaDiretaMap = new Map();
    if (vendaDiretaIds.length > 0) {
      const vendas = await getVendaDiretaModel().findAll({
        attributes: ['id', 'numero_venda'],
        where: { id: { [Op.in]: vendaDiretaIds } }
      });
      vendas.forEach(v => {
        if (v.numero_venda !== null && v.numero_venda !== undefined) {
          vendaDiretaMap.set(v.id, v.numero_venda);
        }
      });
    }

    // 3. Map and apply defaults/fallbacks for legacy payments
    let mapped = payments.map(p => {
      const feeInfo = calculatePaymentFee(p, rates);

      let tipo = p.cartao_tipo;
      let adqId = p.adquirente_id || null;
      let parcelas = p.cartao_parcelas;
      let percentual = feeInfo.taxa_percentual;
      let taxaValor = feeInfo.taxa_valor;
      let liquido = p.valor_liquido !== null ? Number(p.valor_liquido) : Number((p.valor - taxaValor).toFixed(2));
      let dataPrevista = p.data_recebimento_prevista;

      // Se for pagamento legado sem metadados salvos
      if (!tipo) {
        const rate = rates.find(r => r.forma_pagamento === p.forma_pagamento);
        tipo = rate?.tipo_cartao || (p.forma_pagamento === 'cartao_credito' ? 'credito' : 'debito');
        parcelas = tipo === 'credito' ? 1 : null;

        const dias = rate ? (rate.dias_recebimento || 0) : 0;
        const prevDate = new Date(p.data_hora);
        prevDate.setDate(prevDate.getDate() + dias);
        dataPrevista = prevDate;
      }

      const adqNome = adqId ? (adqMap.get(adqId) || 'Não identificada') : 'Sem Adquirente';
      const labelForma = rateDescMap.get(p.forma_pagamento) || (p.forma_pagamento === 'cartao_credito' ? 'Cartão Crédito' : p.forma_pagamento === 'cartao_debito' ? 'Cartão Débito' : p.forma_pagamento);

      let origemIdentificador = null;
      if (p.agendamento_id && agendamentoMap.has(p.agendamento_id)) {
        const num = agendamentoMap.get(p.agendamento_id);
        origemIdentificador = `${String(num).padStart(6, '0')} | S`;
      } else if (p.venda_direta_id && vendaDiretaMap.has(p.venda_direta_id)) {
        const num = vendaDiretaMap.get(p.venda_direta_id);
        origemIdentificador = `${String(num).padStart(6, '0')} | V`;
      }

      return {
        id: p.id,
        data_venda: p.data_hora,
        forma_pagamento: p.forma_pagamento,
        forma_pagamento_label: labelForma,
        tipo_cartao: tipo,
        adquirente_id: adqId,
        adquirente_nome: adqNome,
        parcelas: parcelas,
        taxa_percentual: percentual,
        taxa_valor: taxaValor,
        valor_bruto: Number(p.valor),
        valor_liquido: liquido,
        data_recebimento_prevista: dataPrevista,
        bandeira: p.cartao_bandeira || null,
        origem_identificador: origemIdentificador
      };
    });

    // 3. Aplicar filtros dinâmicos solicitados
    if (adquirente_id && adquirente_id !== 'todos') {
      if (adquirente_id === 'sem_adquirente') {
        mapped = mapped.filter(item => item.adquirente_id === null);
      } else {
        mapped = mapped.filter(item => item.adquirente_id === adquirente_id);
      }
    }

    if (cartao_tipo && cartao_tipo !== 'todos') {
      mapped = mapped.filter(item => item.tipo_cartao === cartao_tipo);
    }

    if (forma_pagamento && forma_pagamento !== 'todos') {
      mapped = mapped.filter(item => item.forma_pagamento === forma_pagamento);
    }

    // 4. Calcular consolidados
    const totais = mapped.reduce((acc, item) => {
      acc.bruto += item.valor_bruto;
      acc.taxa += item.taxa_valor;
      acc.liquido += item.valor_liquido;
      return acc;
    }, { bruto: 0, taxa: 0, liquido: 0 });

    totais.bruto = Number(totais.bruto.toFixed(2));
    totais.taxa = Number(totais.taxa.toFixed(2));
    totais.liquido = Number(totais.liquido.toFixed(2));

    // 5. Agrupado por adquirente (para o relatório comparativo de custos)
    const porAdquirenteObj = {};
    mapped.forEach(item => {
      const nome = item.adquirente_nome;
      if (!porAdquirenteObj[nome]) {
        porAdquirenteObj[nome] = { adquirente: nome, bruto: 0, taxas: 0, liquido: 0 };
      }
      porAdquirenteObj[nome].bruto += item.valor_bruto;
      porAdquirenteObj[nome].taxas += item.taxa_valor;
      porAdquirenteObj[nome].liquido += item.valor_liquido;
    });

    const porAdquirente = Object.values(porAdquirenteObj).map(adq => ({
      adquirente: adq.adquirente,
      bruto: Number(adq.bruto.toFixed(2)),
      taxas: Number(adq.taxas.toFixed(2)),
      liquido: Number(adq.liquido.toFixed(2))
    })).sort((a, b) => b.bruto - a.bruto);

    res.json({
      transacoes: mapped,
      totais,
      por_adquirente: porAdquirente
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const relatorioAgendamentosCancelados = async (req, res) => {
  const { data_inicio, data_fim, cliente_id } = req.query;
  try {
    const where = {
      status: 'cancelado',
      deletado: 'N'
    };

    if (data_inicio && data_fim) {
      where.cancelado_em = {
        [Op.between]: [`${data_inicio}T00:00:00`, `${data_fim}T23:59:59`]
      };
    }

    if (cliente_id && cliente_id !== 'todos') {
      where.cliente_id = cliente_id;
    }

    const agendamentos = await getAgendamentoModel().findAll({
      where,
      order: [['cancelado_em', 'DESC']]
    });

    res.json(agendamentos);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  dashboard,
  dashboardDetail,
  relatorioCaixa,
  relatorioDre,
  relatorioProdutos,
  relatorioServicos,
  relatorioResultadoOperacional,
  relatorioEstoque,
  relatorioMovimentacaoEstoque,
  relatorioEstoqueAbaixoMinimo,
  relatorioEstoqueSemEstoque,
  relatorioEstoqueValorizacao,
  relatorioEstoqueConsumoInsumos,
  relatorioEstoqueMaisMovimentados,
  relatorioEstoqueSemMovimentacao,
  relatorioEstoqueHistoricoAjustes,
  relatorioEstoqueInventario,
  relatorioEstoquePerdasQuebras,
  relatorioCartoes,
  relatorioAgendamentosCancelados
};

