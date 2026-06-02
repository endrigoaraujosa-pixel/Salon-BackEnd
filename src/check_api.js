import { Sequelize } from 'sequelize';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import models
import Colaborador from './models/Colaborador.js';
import Agendamento from './models/Agendamento.js';
import VendaDireta from './models/VendaDireta.js';
import Produto from './models/Produto.js';
import PagamentoComissao from './models/PagamentoComissao.js';
import Servico from './models/Servico.js';
import { Op } from 'sequelize';

async function main() {
  const data_inicio = '2026-06-01';
  const data_fim = '2026-06-30';
  const statusFilter = 'pendente';
  const start = data_inicio;
  const end = data_fim;
  const periodo = `${data_inicio}_${data_fim}`;

  try {
    const colaboradores = await Colaborador.findAll({ where: { deletado: 'N' } });
    const produtos = await Produto.findAll({ where: { deletado: 'N' } });
    const servicos = await Servico.findAll({ where: { deletado: 'N' } });
    
    let filteredColaboradores = colaboradores;
    
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

              const base_comissao = Math.max(0, val_serv_comissao - custo_produtos);
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

              const base_comissao = Math.max(0, val_serv_comissao - custo_produtos);
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
                pago: !!item.comissao_paga_auxiliar,
                insumos_pendentes
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

      // 2. Processar comissões de vendas de produtos (vendas diretas)
      for (const venda of vendas) {
        if (venda.colaborador_id !== colab.id) continue;
        const itensVenda = Array.isArray(venda.itens) && venda.itens.length > 0 ? venda.itens : [];
        for (const item of itensVenda) {
          let pct = item.comissao_pct != null ? Number(item.comissao_pct) : null;
          if (pct == null) {
            const prod = produtos.find(p => p.id === item.produto_id);
            pct = prod ? Number(prod.comissao || 0) : 0;
          }
          const val_item = Number(item.subtotal || item.preco_unitario * item.quantidade || 0);
          const val_com = val_item * (pct / 100);

          if (venda.comissao_paga) {
            total_produtos_pago += val_item;
          } else {
            total_produtos_pendente += val_item;
          }

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
              pago: !!venda.comissao_paga
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

      if (statusFilter === 'pendente' || statusFilter === 'todos') {
        if (val_comissao_pendente > 0 || (colab.ativo && val_comissao_pendente === 0 && val_comissao_pago === 0)) {
          let comissao_produtos_pendente = 0;
          for (const det of detalhes_pendente) {
            if (det.tipo === 'produto') {
              comissao_produtos_pendente += det.valor_comissao;
            }
          }
          comissoesList.push({
            colaborador_id: colab.id,
            colaborador_nome: (colab.nome || '').trim(),
            atendimentos: set_atendimentos_pendente.size,
            total_principal: total_principal_pendente,
            total_auxiliar: total_auxiliar_pendente,
            total_produtos: total_produtos_pendente,
            valor_comissao: Number(val_comissao_pendente.toFixed(2)),
            pago: false,
            detalhes: detalhes_pendente
          });
          totalComissoes += val_comissao_pendente;
        }
      }
    }

    const faturamentoBrutoServicos = agendamentos.reduce((acc, a) => acc + (a.valor_pago || a.valor_total || 0), 0);
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
            let custo_u = Number(pu.custo_unitario || 0);
            if (custo_u === 0) {
              const prod = produtos.find(p => p.id === pu.produto_id);
              custo_u = prod ? Number(prod.custo_unitario || 0) : 0;
            }
            custo_produtos += Number(pu.quantidade || 0) * custo_u;
          }
          totalInsumosTotal += custo_produtos;
        }
      }
    }

    console.log({
      totalInsumosTotal,
      comissoesListLength: comissoesList.length,
      filteredColaboradoresLength: filteredColaboradores.length
    });
  } catch (error) {
    console.error(error);
  }
}

main();
