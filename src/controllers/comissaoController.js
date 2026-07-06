import { Op } from 'sequelize';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getProdutoModel } from '../models/Produto.js';
import { getServicoModel } from '../models/Servico.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getVendaDiretaModel } from '../models/VendaDireta.js';
import { getPagamentoComissaoModel } from '../models/PagamentoComissao.js';
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

const getCustoProporcional = (pu, produtos) => {
  if (pu.custo_proporcional !== undefined && Number(pu.custo_proporcional) > 0) {
    return Number(pu.custo_proporcional);
  }
  
  let custoUnitario = Number(pu.custo_unitario || 0);
  let qtyPorUnidade = Number(pu.quantidade_por_unidade || 0);
  
  if (custoUnitario === 0 || qtyPorUnidade === 0) {
    const prod = produtos.find(p => p.id === pu.produto_id);
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

const listComissoes = async (req, res) => {
  const { mes, data_inicio, data_fim, status, colaborador_id } = req.query;
  const statusFilter = status || 'pendente'; // 'pendente' | 'pago' | 'todos'
  
  let start, end, periodo;
  if (data_inicio && data_fim) {
    start = data_inicio;
    end = data_fim;
    periodo = `${data_inicio}_${data_fim}`;
  } else if (mes) {
    const [year, month] = mes.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    start = `${mes}-01`;
    end = `${mes}-${String(lastDay).padStart(2, '0')}`;
    periodo = mes;
  } else {
    return res.status(400).json({ detail: 'Informe o mês ou o período de datas' });
  }

  try {
    const { getConfiguracaoSistemaModel } = await import('../models/ConfiguracaoSistema.js');
    const systemConfig = await getConfiguracaoSistemaModel().findOne();
    const descontar_taxa_cartao_comissao = systemConfig ? !!systemConfig.descontar_taxa_cartao_comissao : false;

    const colaboradores = await getColaboradorModel().findAll({ where: { deletado: 'N' } });
    const produtos = await getProdutoModel().findAll({ where: { deletado: 'N' } });
    const servicos = await getServicoModel().findAll({ where: { deletado: 'N' } });
    
    const ColabComissaoServicoModel = getColaboradorComissaoServicoModel();
    const comissoesAvancadas = await ColabComissaoServicoModel.findAll();
    const comissoesAvancadasMap = new Map();
    for (const c of comissoesAvancadas) {
      comissoesAvancadasMap.set(`${c.colaborador_id}_${c.servico_id}`, c);
    }

    let filteredColaboradores = colaboradores;
    const canSeeAll = req.user && (req.user.role === 'admin' || req.user.perfil?.permissoes?.['comissoes.visualizar_todos'] === true);
    if (!canSeeAll) {
      if (req.user.colaborador_id) {
        filteredColaboradores = colaboradores.filter(c => c.id === req.user.colaborador_id);
      } else {
        const normalizedUserName = normalizeName(req.user.name);
        filteredColaboradores = colaboradores.filter(c => normalizeName(c.nome) === normalizedUserName);
      }
    } else if (colaborador_id && colaborador_id !== 'todos') {
      filteredColaboradores = colaboradores.filter(c => String(c.id) === String(colaborador_id));
    }
    
    // Buscar agendamentos concluídos no período
    const agendamentos = await getAgendamentoModel().findAll({
      where: {
        status: 'concluido',
        deletado: 'N',
        data_hora: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    // Buscar vendas diretas pagas no período
    const vendas = await getVendaDiretaModel().findAll({
      where: {
        status: 'pago',
        deletado: 'N',
        data_venda: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    const pagamentosComissao = await getPagamentoComissaoModel().findAll({ where: { periodo, deletado: 'N' } });

    const comissoesList = [];
    let totalComissoes = 0;
    const uniqueAgendamentosPeriodo = new Set();

    for (const colab of filteredColaboradores) {
      // 1. Processar comissões de serviços (agendamentos)
      const detalhes_pendente = [];
      const detalhes_pago = [];
      
      let total_principal_pendente = 0;
      let total_auxiliar_pendente = 0;
      let total_produtos_pendente = 0;
      const set_atendimentos_pendente = new Set();

      let total_principal_pago = 0;
      let total_auxiliar_pago = 0;
      let total_produtos_pago = 0;
      const set_atendimentos_pago = new Set();

      for (const ag of agendamentos) {
        let itens = [];
        try {
          itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
        } catch (e) {
          itens = ag.itens || [];
        }

        if (Array.isArray(itens)) {
          for (const item of itens) {
            if (item.colaborador_id === colab.id) {
              const val_serv = Number(item.valor || 0);
               const temAuxiliar = !!(item.auxiliar_id && String(item.auxiliar_id).trim() !== "" && String(item.auxiliar_id).trim() !== "null" && String(item.auxiliar_id).trim() !== "undefined");
              let pct;
              if (item.comissao_percentual !== undefined && item.comissao_percentual !== null) {
                pct = Number(item.comissao_percentual);
              } else {
                if (colab.usar_comissao_avancada) {
                  const key = `${colab.id}_${item.servico_id}`;
                  const comAvancada = comissoesAvancadasMap.get(key);
                  if (comAvancada) {
                    pct = temAuxiliar
                      ? Number(comAvancada.comissao_ajuda !== null && comAvancada.comissao_ajuda !== undefined ? comAvancada.comissao_ajuda : 30)
                      : Number(comAvancada.comissao_sozinho !== null && comAvancada.comissao_sozinho !== undefined ? comAvancada.comissao_sozinho : (comAvancada.comissao_principal || 0));
                  } else {
                    pct = temAuxiliar
                      ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
                      : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 0));
                  }
                } else {
                  pct = temAuxiliar
                    ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
                    : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 0));
                }
              }
              
              // Calculate cost of products used in this service execution
              let custo_produtos = 0;
              const produtos_utilizados = item.produtos_utilizados || [];
              for (const pu of produtos_utilizados) {
                const custo_prop = getCustoProporcional(pu, produtos);
                custo_produtos += Number(pu.quantidade || 0) * custo_prop;
              }

              // Decidir base de comissão com base na flag do desconto
              let val_serv_comissao = val_serv;
              if (item.valor_original !== undefined && item.valor_original !== item.valor) {
                let descontoMeta = ag.desconto_aplicado;
                if (typeof descontoMeta === 'string') {
                  try {
                    descontoMeta = JSON.parse(descontoMeta);
                  } catch (e) {}
                }
                if (descontoMeta && descontoMeta.incide_comissao === false) {
                  val_serv_comissao = Number(item.valor_original || item.valor);
                }
              }

              const base_comissao_original = item.base_comissao_original !== undefined
                ? Number(item.base_comissao_original)
                : Math.max(0, val_serv_comissao - custo_produtos);
              
              const taxa_cartao_descontada = item.taxa_cartao_descontada !== undefined
                ? Number(item.taxa_cartao_descontada)
                : 0;

              let base_comissao_final = base_comissao_original;
              if (descontar_taxa_cartao_comissao) {
                base_comissao_final = Math.max(0, base_comissao_original - taxa_cartao_descontada);
              }

              const val_com = item.comissao_valor_calculado !== undefined && item.comissao_valor_calculado !== null
                ? Number(item.comissao_valor_calculado)
                : Math.max(0, base_comissao_final * (pct / 100));
              
              const s_model = servicos.find(x => x.id === item.servico_id);
              const linkedCount = s_model?.produtos_vinculados?.length || 0;
              const utilizedCount = item.produtos_utilizados?.length || 0;
              const insumos_pendentes = (linkedCount > 0 && utilizedCount === 0);
              
              const det = {
                tipo: 'servico',
                numero: ag.numero,
                papel: temAuxiliar ? 'Principal (Com ajuda)' : 'Principal (Sozinho)',
                descricao: item.nome,
                data: ag.data_hora,
                valor_movimentacao: val_serv,
                custo_produtos: Number(custo_produtos.toFixed(2)),
                base_comissao: Number(base_comissao_final.toFixed(2)),
                percentual_aplicado: pct,
                valor_comissao: Number(val_com.toFixed(2)),
                pago: !!item.comissao_paga,
                insumos_pendentes,
                cliente_nome: ag.cliente_nome,
                base_comissao_original: base_comissao_original,
                taxa_cartao_descontada: taxa_cartao_descontada,
                descontou_taxa_cartao: descontar_taxa_cartao_comissao && (taxa_cartao_descontada > 0)
              };

              if (item.comissao_paga) {
                total_principal_pago += val_serv;
                set_atendimentos_pago.add(ag.id);
                uniqueAgendamentosPeriodo.add(ag.id);
                detalhes_pago.push(det);
              } else {
                total_principal_pendente += val_serv;
                set_atendimentos_pendente.add(ag.id);
                uniqueAgendamentosPeriodo.add(ag.id);
                detalhes_pendente.push(det);
              }
            }
            if (item.auxiliar_id === colab.id) {
              const val_serv = Number(item.valor || 0);
              let pct;
              if (item.comissao_percentual_auxiliar !== undefined && item.comissao_percentual_auxiliar !== null) {
                pct = Number(item.comissao_percentual_auxiliar);
              } else {
                if (colab.usar_comissao_avancada) {
                  const key = `${colab.id}_${item.servico_id}`;
                  const comAvancada = comissoesAvancadasMap.get(key);
                  if (comAvancada) {
                    pct = Number(comAvancada.comissao_auxiliar !== null && comAvancada.comissao_auxiliar !== undefined ? comAvancada.comissao_auxiliar : 0);
                  } else {
                    pct = Number(colab.comissao_auxiliar || 0);
                  }
                } else {
                  pct = Number(colab.comissao_auxiliar || 0);
                }
              }
              
              // Calculate cost of products used in this service execution
              let custo_produtos = 0;
              const produtos_utilizados = item.produtos_utilizados || [];
              for (const pu of produtos_utilizados) {
                const custo_prop = getCustoProporcional(pu, produtos);
                custo_produtos += Number(pu.quantidade || 0) * custo_prop;
              }

              // Decidir base de comissão com base na flag do desconto
              let val_serv_comissao = val_serv;
              if (item.valor_original !== undefined && item.valor_original !== item.valor) {
                let descontoMeta = ag.desconto_aplicado;
                if (typeof descontoMeta === 'string') {
                  try {
                    descontoMeta = JSON.parse(descontoMeta);
                  } catch (e) {}
                }
                if (descontoMeta && descontoMeta.incide_comissao === false) {
                  val_serv_comissao = Number(item.valor_original || item.valor);
                }
              }

              const base_comissao_original = item.base_comissao_original !== undefined
                ? Number(item.base_comissao_original)
                : Math.max(0, val_serv_comissao - custo_produtos);
              
              const taxa_cartao_descontada = item.taxa_cartao_descontada !== undefined
                ? Number(item.taxa_cartao_descontada)
                : 0;

              let base_comissao_final = base_comissao_original;
              if (descontar_taxa_cartao_comissao) {
                base_comissao_final = Math.max(0, base_comissao_original - taxa_cartao_descontada);
              }

              const val_com = item.comissao_valor_calculado_auxiliar !== undefined && item.comissao_valor_calculado_auxiliar !== null
                ? Number(item.comissao_valor_calculado_auxiliar)
                : Math.max(0, base_comissao_final * (pct / 100));

              const s_model = servicos.find(x => x.id === item.servico_id);
              const linkedCount = s_model?.produtos_vinculados?.length || 0;
              const utilizedCount = item.produtos_utilizados?.length || 0;
              const insumos_pendentes = (linkedCount > 0 && utilizedCount === 0);

              const det = {
                tipo: 'servico',
                numero: ag.numero,
                papel: 'Auxiliar',
                descricao: item.nome,
                data: ag.data_hora,
                valor_movimentacao: val_serv,
                custo_produtos: Number(custo_produtos.toFixed(2)),
                base_comissao: Number(base_comissao_final.toFixed(2)),
                percentual_aplicado: pct,
                valor_comissao: Number(val_com.toFixed(2)),
                pago: !!item.comissao_paga_auxiliar,
                insumos_pendentes,
                cliente_nome: ag.cliente_nome,
                base_comissao_original: base_comissao_original,
                taxa_cartao_descontada: item.taxa_cartao_descontada !== undefined ? Number(item.taxa_cartao_descontada) : 0,
                descontou_taxa_cartao: descontar_taxa_cartao_comissao && (item.taxa_cartao_descontada > 0)
              };

              const isPagoAux = !!item.comissao_paga_auxiliar;
              if (isPagoAux) {
                total_auxiliar_pago += val_serv;
                set_atendimentos_pago.add(ag.id);
                uniqueAgendamentosPeriodo.add(ag.id);
                detalhes_pago.push(det);
              } else {
                total_auxiliar_pendente += val_serv;
                set_atendimentos_pendente.add(ag.id);
                uniqueAgendamentosPeriodo.add(ag.id);
                detalhes_pendente.push(det);
              }
            }
          }
        }
      }

      // 2. Processar comissões de vendas de produtos (vendas diretas) — suporta multi-itens
      for (const venda of vendas) {
        if (venda.colaborador_id !== colab.id) continue;

        // Carrinho novo: processar cada item individualmente
        const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0
          ? venda.itens
          : [{ produto_id: venda.produto_id, produto_nome: venda.produto_nome, quantidade: venda.quantidade, subtotal: venda.valor_total, comissao_pct: null }];

        for (const item of itensVenda) {
          // Se comissao_pct está no item, usa direto; caso contrário busca no produto
          let pct = item.comissao_pct != null ? Number(item.comissao_pct) : null;
          if (pct == null) {
            const prod = produtos.find(p => p.id === item.produto_id);
            pct = prod ? Number(prod.comissao || 0) : 0;
          }

          const val_item = Number(item.subtotal || item.preco_unitario * item.quantidade || 0);

          // Decidir base de comissão com base na flag do desconto
          let val_item_comissao = val_item;
          if (item.preco_unitario_original !== undefined) {
            let descontoMeta = venda.desconto_aplicado;
            if (typeof descontoMeta === 'string') {
              try {
                descontoMeta = JSON.parse(descontoMeta);
              } catch (e) {}
            }
            if (descontoMeta && descontoMeta.incide_comissao === false) {
              val_item_comissao = Number(item.preco_unitario_original) * Number(item.quantidade);
            }
          }

          const val_com = val_item_comissao * (pct / 100);

          // Sempre inclui no total de produtos vendidos (mesmo sem comissão)
          if (venda.comissao_paga) {
            total_produtos_pago += val_item;
          } else {
            total_produtos_pendente += val_item;
          }

          // Só cria detalhe de comissão se há percentual > 0
          if (pct > 0) {
            const det = {
              tipo: 'produto',
              numero: venda.numero_venda,
              papel: 'Vendedor',
              descricao: item.produto_nome,
              data: venda.data_venda,
              valor_movimentacao: val_item,
              percentual_aplicado: pct,
              valor_comissao: Number(val_com.toFixed(2)),
              pago: !!venda.comissao_paga,
              cliente_nome: venda.cliente_nome
            };

            if (venda.comissao_paga) {
              detalhes_pago.push(det);
            } else {
              detalhes_pendente.push(det);
            }
          }
        }
      }

      const val_comissao_pendente = detalhes_pendente.reduce((acc, d) => acc + d.valor_comissao, 0);
      const val_comissao_pago = detalhes_pago.reduce((acc, d) => acc + d.valor_comissao, 0);

      const pagRec = pagamentosComissao.find(p => p.colaborador_id === colab.id);
      const data_pagamento = pagRec ? pagRec.data_pagamento : null;

      // Adicionar linha de Não Pago se houver comissões pendentes (ou se ativo e listando pendentes)
      if (statusFilter === 'pendente' || statusFilter === 'todos') {
        if (val_comissao_pendente > 0 || (colab.ativo && val_comissao_pendente === 0 && val_comissao_pago === 0)) {
          let comissao_produtos_pendente = 0;
          for (const det of detalhes_pendente) {
            if (det.tipo === 'produto') {
              comissao_produtos_pendente += det.valor_comissao;
            }
          }
          // Ordenar serviços/produtos por data de agendamento/venda em ordem cronológica
          detalhes_pendente.sort((a, b) => new Date(a.data) - new Date(b.data));

          comissoesList.push({
            colaborador_id: colab.id,
            colaborador_nome: (colab.nome || '').trim(),
            comissao_principal: colab.comissao_principal,
            comissao_sozinho: colab.comissao_sozinho,
            comissao_ajuda: colab.comissao_ajuda,
            comissao_auxiliar: colab.comissao_auxiliar,
            atendimentos: set_atendimentos_pendente.size,
            total_principal: total_principal_pendente,
            total_auxiliar: total_auxiliar_pendente,
            total_produtos: total_produtos_pendente,
            comissao_produtos: Number(comissao_produtos_pendente.toFixed(2)),
            valor_comissao: Number(val_comissao_pendente.toFixed(2)),
            pago: false,
            data_pagamento: null,
            detalhes: detalhes_pendente
          });
          totalComissoes += val_comissao_pendente;
        }
      }

      // Adicionar linha de Pago se houver comissões pagas
      if (statusFilter === 'pago' || statusFilter === 'todos') {
        if (val_comissao_pago > 0) {
          let comissao_produtos_pago = 0;
          for (const det of detalhes_pago) {
            if (det.tipo === 'produto') {
              comissao_produtos_pago += det.valor_comissao;
            }
          }
          // Ordenar serviços/produtos por data de agendamento/venda em ordem cronológica
          detalhes_pago.sort((a, b) => new Date(a.data) - new Date(b.data));

          comissoesList.push({
            colaborador_id: colab.id,
            colaborador_nome: (colab.nome || '').trim(),
            comissao_principal: colab.comissao_principal,
            comissao_sozinho: colab.comissao_sozinho,
            comissao_ajuda: colab.comissao_ajuda,
            comissao_auxiliar: colab.comissao_auxiliar,
            atendimentos: set_atendimentos_pago.size,
            total_principal: total_principal_pago,
            total_auxiliar: total_auxiliar_pago,
            total_produtos: total_produtos_pago,
            comissao_produtos: Number(comissao_produtos_pago.toFixed(2)),
            valor_comissao: Number(val_comissao_pago.toFixed(2)),
            pago: true,
            data_pagamento: data_pagamento,
            detalhes: detalhes_pago
          });
          totalComissoes += val_comissao_pago;
        }
      }
    }

    // Faturamento bruto de serviços = soma de todos os agendamentos concluídos (valor único por atendimento)
    const faturamentoBrutoServicos = agendamentos.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);
    
    // Faturamento bruto de produtos = soma de todas as vendas diretas pagas (valor total da venda)
    const faturamentoBrutoProdutos = vendas.reduce((acc, v) => acc + (v.valor_pago || v.valor_total || 0), 0);

    const faturamentoBrutoTotal = faturamentoBrutoServicos + faturamentoBrutoProdutos;

    // Calcular deduções de insumos deduplicadas
    const isColabInFilter = (id) => filteredColaboradores.some(c => c.id === id);
    let totalInsumosTotal = 0;
    for (const ag of agendamentos) {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }
      if (Array.isArray(itens)) {
        for (const item of itens) {
          if (!isColabInFilter(item.colaborador_id) && !isColabInFilter(item.auxiliar_id)) {
            continue;
          }
          let custo_produtos = 0;
          const produtos_utilizados = item.produtos_utilizados || [];
          for (const pu of produtos_utilizados) {
            const custo_prop = getCustoProporcional(pu, produtos);
            custo_produtos += Number(pu.quantidade || 0) * custo_prop;
          }
          totalInsumosTotal += custo_produtos;
        }
      }
    }

    res.json({
      periodo,
      total: Number(totalComissoes.toFixed(2)),
      faturamento_bruto_servicos: Number(faturamentoBrutoServicos.toFixed(2)),
      faturamento_bruto_produtos: Number(faturamentoBrutoProdutos.toFixed(2)),
      faturamento_bruto_total: Number(faturamentoBrutoTotal.toFixed(2)),
      custo_insumos_total: Number(totalInsumosTotal.toFixed(2)),
      atendimentos_total_count: uniqueAgendamentosPeriodo.size,
      descontar_taxa_cartao_comissao,
      comissoes: comissoesList
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const pagarComissao = async (req, res) => {
  const { colaborador_id, mes, periodo, valor } = req.body;
  const p = periodo || mes;
  
  let start, end;
  if (p.includes('_')) {
    const parts = p.split('_');
    start = parts[0];
    end = parts[1];
  } else {
    const [year, month] = p.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    start = `${p}-01`;
    end = `${p}-${String(lastDay).padStart(2, '0')}`;
  }

  try {
    // 1. Marcar comissões de serviços como pagas no JSON dos agendamentos concluídos do período
    const agendamentos = await getAgendamentoModel().findAll({
      where: {
        status: 'concluido',
        deletado: 'N',
        data_hora: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    for (const ag of agendamentos) {
      let itens = [];
      let updated = false;
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }

      if (Array.isArray(itens)) {
        itens = itens.map(item => {
          if (item.colaborador_id === colaborador_id) {
            if (!item.comissao_paga) {
              item.comissao_paga = true;
              updated = true;
            }
          }
          if (item.auxiliar_id === colaborador_id) {
            if (!item.comissao_paga_auxiliar) {
              item.comissao_paga_auxiliar = true;
              updated = true;
            }
          }
          return item;
        });

        if (updated) {
          ag.itens = itens;
          ag.changed('itens', true);
          await ag.save();
        }
      }
    }

    // 2. Marcar comissões de vendas como pagas no período
    await getVendaDiretaModel().update(
      { comissao_paga: true },
      {
        where: {
          colaborador_id,
          status: 'pago',
          deletado: 'N',
          data_venda: {
            [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
          }
        }
      }
    );

    // 3. Registrar o log do pagamento
    await getPagamentoComissaoModel().create({
      colaborador_id,
      periodo: p,
      valor: valor || 0
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const desfazerPagamento = async (req, res) => {
  const { colaborador_id, mes, periodo } = req.query;
  const p = periodo || mes;

  let start, end;
  if (p.includes('_')) {
    const parts = p.split('_');
    start = parts[0];
    end = parts[1];
  } else {
    const [year, month] = p.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    start = `${p}-01`;
    end = `${p}-${String(lastDay).padStart(2, '0')}`;
  }

  try {
    // 1. Desmarcar comissões de serviços no período
    const agendamentos = await getAgendamentoModel().findAll({
      where: {
        status: 'concluido',
        deletado: 'N',
        data_hora: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    for (const ag of agendamentos) {
      let itens = [];
      let updated = false;
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }

      if (Array.isArray(itens)) {
        itens = itens.map(item => {
          if (item.colaborador_id === colaborador_id) {
            if (item.comissao_paga) {
              item.comissao_paga = false;
              updated = true;
            }
          }
          if (item.auxiliar_id === colaborador_id) {
            if (item.comissao_paga_auxiliar) {
              item.comissao_paga_auxiliar = false;
              updated = true;
            }
          }
          return item;
        });

        if (updated) {
          ag.itens = itens;
          ag.changed('itens', true);
          await ag.save();
        }
      }
    }

    // 2. Desmarcar comissões de vendas no período
    await getVendaDiretaModel().update(
      { comissao_paga: false },
      {
        where: {
          colaborador_id,
          status: 'pago',
          deletado: 'N',
          data_venda: {
            [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
          }
        }
      }
    );

    // 3. Deletar registro do pagamento comissão
    await getPagamentoComissaoModel().update(
      {
        deletado: 'S',
        deletado_por: req.user ? req.user.name : 'Sistema',
        deletado_em: new Date()
      },
      {
        where: { colaborador_id, periodo: p }
      }
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listComissoes,
  pagarComissao,
  desfazerPagamento
};
