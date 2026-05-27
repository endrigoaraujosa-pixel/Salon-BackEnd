import Colaborador from '../models/Colaborador.js';
import Agendamento from '../models/Agendamento.js';
import VendaDireta from '../models/VendaDireta.js';
import Produto from '../models/Produto.js';
import PagamentoComissao from '../models/PagamentoComissao.js';
import Servico from '../models/Servico.js';
import { Op } from 'sequelize';

const normalizeName = (name) => {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const listComissoes = async (req, res) => {
  const { mes, data_inicio, data_fim, status } = req.query;
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
    const colaboradores = await Colaborador.findAll({ where: { deletado: 'N' } });
    const produtos = await Produto.findAll({ where: { deletado: 'N' } });
    const servicos = await Servico.findAll({ where: { deletado: 'N' } });
    
    let filteredColaboradores = colaboradores;
    if (req.user && req.user.role !== 'admin') {
      if (req.user.colaborador_id) {
        filteredColaboradores = colaboradores.filter(c => c.id === req.user.colaborador_id);
      } else {
        const normalizedUserName = normalizeName(req.user.name);
        filteredColaboradores = colaboradores.filter(c => normalizeName(c.nome) === normalizedUserName);
      }
    }
    
    // Buscar agendamentos concluídos no período
    const agendamentos = await Agendamento.findAll({
      where: {
        status: 'concluido',
        deletado: 'N',
        data_hora: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    // Buscar vendas diretas pagas no período
    const vendas = await VendaDireta.findAll({
      where: {
        status: 'pago',
        deletado: 'N',
        data_venda: {
          [Op.between]: [`${start}T00:00:00`, `${end}T23:59:59`]
        }
      }
    });

    const pagamentosComissao = await PagamentoComissao.findAll({ where: { periodo, deletado: 'N' } });

    const comissoesList = [];
    let totalComissoes = 0;

    for (const colab of filteredColaboradores) {
      // 1. Processar comissões de serviços (agendamentos)
      const detalhes_pendente = [];
      const detalhes_pago = [];
      
      let total_principal_pendente = 0;
      let total_auxiliar_pendente = 0;
      let total_produtos_pendente = 0;
      let atendimentos_pendente = 0;

      let total_principal_pago = 0;
      let total_auxiliar_pago = 0;
      let total_produtos_pago = 0;
      let atendimentos_pago = 0;

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
              const pct = temAuxiliar
                ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
                : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 0));
              
              // Calculate cost of products used in this service execution
              let custo_produtos = 0;
              const produtos_utilizados = item.produtos_utilizados || [];
              for (const pu of produtos_utilizados) {
                let custo_u = Number(pu.custo_unitario || 0);
                if (custo_u === 0) {
                  const prod = produtos.find(p => p.id === pu.produto_id);
                  custo_u = prod ? Number(prod.custo_unitario || 0) : 0;
                }
                custo_produtos += Number(pu.quantidade || 0) * custo_u;
              }

              const base_comissao = Math.max(0, val_serv - custo_produtos);
              const val_com = base_comissao * (pct / 100);
              
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
                base_comissao: Number(base_comissao.toFixed(2)),
                percentual_aplicado: pct,
                valor_comissao: Number(val_com.toFixed(2)),
                pago: !!item.comissao_paga,
                insumos_pendentes
              };

              if (item.comissao_paga) {
                total_principal_pago += val_serv;
                atendimentos_pago++;
                detalhes_pago.push(det);
              } else {
                total_principal_pendente += val_serv;
                atendimentos_pendente++;
                detalhes_pendente.push(det);
              }
            }
            if (item.auxiliar_id === colab.id) {
              const val_serv = Number(item.valor || 0);
              const pct = Number(colab.comissao_auxiliar || 0);
              
              // Calculate cost of products used in this service execution
              let custo_produtos = 0;
              const produtos_utilizados = item.produtos_utilizados || [];
              for (const pu of produtos_utilizados) {
                let custo_u = Number(pu.custo_unitario || 0);
                if (custo_u === 0) {
                  const prod = produtos.find(p => p.id === pu.produto_id);
                  custo_u = prod ? Number(prod.custo_unitario || 0) : 0;
                }
                custo_produtos += Number(pu.quantidade || 0) * custo_u;
              }

              const base_comissao = Math.max(0, val_serv - custo_produtos);
              const val_com = base_comissao * (pct / 100);

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
                base_comissao: Number(base_comissao.toFixed(2)),
                percentual_aplicado: pct,
                valor_comissao: Number(val_com.toFixed(2)),
                pago: !!item.comissao_paga,
                insumos_pendentes
              };

              if (item.comissao_paga) {
                total_auxiliar_pago += val_serv;
                atendimentos_pago++;
                detalhes_pago.push(det);
              } else {
                total_auxiliar_pendente += val_serv;
                atendimentos_pendente++;
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

          if (pct > 0) {
            const val_item = Number(item.subtotal || item.preco_unitario * item.quantidade || 0);
            const val_com = val_item * (pct / 100);

            const det = {
              tipo: 'produto',
              numero: venda.numero_venda,
              papel: 'Vendedor',
              descricao: item.produto_nome,
              data: venda.data_venda,
              valor_movimentacao: val_item,
              percentual_aplicado: pct,
              valor_comissao: Number(val_com.toFixed(2)),
              pago: !!venda.comissao_paga
            };

            if (venda.comissao_paga) {
              total_produtos_pago += val_item;
              atendimentos_pago++;
              detalhes_pago.push(det);
            } else {
              total_produtos_pendente += val_item;
              atendimentos_pendente++;
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
          comissoesList.push({
            colaborador_id: colab.id,
            colaborador_nome: colab.nome,
            comissao_principal: colab.comissao_principal,
            comissao_sozinho: colab.comissao_sozinho,
            comissao_ajuda: colab.comissao_ajuda,
            comissao_auxiliar: colab.comissao_auxiliar,
            atendimentos: atendimentos_pendente,
            total_principal: total_principal_pendente,
            total_auxiliar: total_auxiliar_pendente,
            total_produtos: total_produtos_pendente,
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
          comissoesList.push({
            colaborador_id: colab.id,
            colaborador_nome: colab.nome,
            comissao_principal: colab.comissao_principal,
            comissao_sozinho: colab.comissao_sozinho,
            comissao_ajuda: colab.comissao_ajuda,
            comissao_auxiliar: colab.comissao_auxiliar,
            atendimentos: atendimentos_pago,
            total_principal: total_principal_pago,
            total_auxiliar: total_auxiliar_pago,
            total_produtos: total_produtos_pago,
            valor_comissao: Number(val_comissao_pago.toFixed(2)),
            pago: true,
            data_pagamento: data_pagamento,
            detalhes: detalhes_pago
          });
          totalComissoes += val_comissao_pago;
        }
      }
    }

    const faturamentoBrutoServicos = agendamentos.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);
    
    let faturamentoBrutoProdutos = 0;
    for (const venda of vendas) {
      if (!venda.colaborador_id) continue;
      let itensVenda = [];
      try {
        itensVenda = typeof venda.itens === 'string' ? JSON.parse(venda.itens) : venda.itens;
      } catch (e) {
        itensVenda = [];
      }
      if (!Array.isArray(itensVenda) || itensVenda.length === 0) {
        itensVenda = [{ produto_id: venda.produto_id, produto_nome: venda.produto_nome, quantidade: venda.quantidade, subtotal: venda.valor_total, comissao_pct: null }];
      }
      for (const item of itensVenda) {
        let pct = item.comissao_pct != null ? Number(item.comissao_pct) : null;
        if (pct == null) {
          const prod = produtos.find(p => p.id === item.produto_id);
          pct = prod ? Number(prod.comissao || 0) : 0;
        }
        if (pct > 0) {
          const val_item = Number(item.subtotal || item.preco_unitario * item.quantidade || 0);
          faturamentoBrutoProdutos += val_item;
        }
      }
    }

    const faturamentoBrutoTotal = faturamentoBrutoServicos + faturamentoBrutoProdutos;

    res.json({
      periodo,
      total: Number(totalComissoes.toFixed(2)),
      faturamento_bruto_servicos: Number(faturamentoBrutoServicos.toFixed(2)),
      faturamento_bruto_produtos: Number(faturamentoBrutoProdutos.toFixed(2)),
      faturamento_bruto_total: Number(faturamentoBrutoTotal.toFixed(2)),
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
    const agendamentos = await Agendamento.findAll({
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
          if (item.colaborador_id === colaborador_id || item.auxiliar_id === colaborador_id) {
            if (!item.comissao_paga) {
              item.comissao_paga = true;
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
    await VendaDireta.update(
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
    await PagamentoComissao.create({
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
    const agendamentos = await Agendamento.findAll({
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
          if (item.colaborador_id === colaborador_id || item.auxiliar_id === colaborador_id) {
            if (item.comissao_paga) {
              item.comissao_paga = false;
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
    await VendaDireta.update(
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
    await PagamentoComissao.update(
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
