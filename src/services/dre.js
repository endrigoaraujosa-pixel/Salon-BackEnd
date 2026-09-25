import { allocateMoney, reportCardFee } from './reportCardFees.js';
// Pure calculation: the report never creates rates, payments or accounting entries.
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const present = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const money = value => Math.round((num(value) + Number.EPSILON) * 100) / 100;
const sum = rows => money(rows.reduce((total, row) => total + num(row.valor), 0));
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const date = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const json = value => { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return null; } };
const array = value => { const parsed = json(value); return Array.isArray(parsed) ? parsed.filter(Boolean) : []; };
const mapById = rows => new Map(rows.map(row => [String(row.id), row]));
const live = row => row.deletado !== 'S' && norm(row.status) !== 'cancelado';

export function validDrePeriod(start, end) {
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return valid(start) && valid(end) && start <= end;
}

export function buildDre({ agendamentos = [], vendas = [], pagamentos = [], despesas = [], receitas = [],
  produtos = [], servicos = [], colaboradores = [], categorias = [], taxas = [], comissoes = [], config = {},
  data_inicio, data_fim, categoria = 'todos', status = 'todos', hoje = date(new Date()) }) {
  const productMap = mapById(produtos), serviceMap = mapById(servicos), staffMap = mapById(colaboradores);
  const categoryMap = mapById(categorias);
  const advanced = new Map(comissoes.map(row => [`${row.colaborador_id}_${row.servico_id}`, row]));
  const categoryName = id => categoryMap.get(String(id))?.nome;
  const target = norm(categoryName(categoria) || categoria);
  const matches = (id, name) => !categoria || categoria === 'todos' || String(id) === String(categoria) || norm(name || categoryName(id)) === target;
  const inPeriod = value => date(value) >= data_inicio && date(value) <= data_fim;
  const warnings = new Set();
  const detalhes = { agendamentos: [], vendas: [], outras_receitas: [], cmv: [], insumos: [], comissoes: [], taxas_cartao: [], despesas: [], compras_estoque: [] };
  const selectedAgs = new Set(), selectedSales = new Set();
  const shares = new Map();
  const paidFilter = (row, paid) => {
    if (status === 'pago') return paid;
    if (status === 'pendente') return !paid && date(row.data_vencimento) >= hoje;
    if (status === 'vencido') return !paid && date(row.data_vencimento) < hoje;
    return true;
  };
  if (status !== 'todos') warnings.add('Recorte por situação financeira: este resultado não representa o DRE completo nem o fluxo de caixa. Custos seguem as operações selecionadas.');
  if (categoria && categoria !== 'todos') warnings.add('Recorte por categoria: despesas gerais não são rateadas entre produtos e serviços.');

  function unitCost(item, proportional = false) {
    const product = productMap.get(String(item.produto_id));
    if (proportional && present(item.custo_proporcional)) {
      if (num(item.custo_proporcional) === 0) warnings.add('Há produtos ou insumos com custo zero ou ausente. Confira o cadastro antes de considerar o lucro definitivo.');
      return num(item.custo_proporcional);
    }
    const historical = present(item.custo_unitario);
    if (!historical) warnings.add('Há custos sem histórico na operação; foi usado o cadastro atual quando disponível.');
    const cost = historical ? num(item.custo_unitario) : num(product?.custo_unitario);
    if (cost === 0) warnings.add('Há produtos ou insumos com custo zero ou ausente. Confira o cadastro antes de considerar o lucro definitivo.');
    if (!proportional) return cost;
    const quantity = num(item.quantidade_por_unidade ?? product?.quantidade_por_unidade);
    return quantity > 0 ? cost / quantity : cost;
  }

  function commission(item, parent, base, auxiliary, common) {
    const suffix = auxiliary ? '_auxiliar' : '';
    const id = auxiliary ? item.auxiliar_id : item.colaborador_id;
    const stored = item[`comissao_valor_calculado${suffix}`];
    if (!id && !present(stored)) return;
    const staff = staffMap.get(String(id));
    let pct = item[`comissao_percentual${suffix}`];
    let value = stored;
    if (!present(value)) {
      if (!present(pct)) {
        const rule = staff?.usar_comissao_avancada ? advanced.get(`${id}_${item.servico_id}`) || staff : staff;
        if (!rule) { warnings.add('Há comissões sem histórico e sem cadastro do colaborador para calcular.'); return; }
        const hasAux = item.auxiliar_id && !['null', 'undefined'].includes(String(item.auxiliar_id));
        pct = auxiliary ? rule.comissao_auxiliar ?? 20 : hasAux ? rule.comissao_ajuda ?? 30 : rule.comissao_sozinho ?? rule.comissao_principal ?? 40;
        warnings.add('Há comissões antigas calculadas com as regras atuais por falta de histórico.');
      }
      value = base * num(pct) / 100;
    }
    detalhes.comissoes.push({ ...common, id: `${common.id}-comissao${suffix}`, categoria: 'Comissões de serviços',
      descricao: `${common.descricao} — ${staff?.nome || id || 'Colaborador'}${auxiliary ? ' (auxiliar)' : ''}`,
      valor: money(value), base_calculo: money(base), percentual: present(pct) ? num(pct) : null,
      origem: present(stored) ? 'Comissão registrada no atendimento' : 'Comissão calculada',
      status: parent.comissao_paga ? 'Pago' : 'Provisionado' });
  }

  for (const ag of agendamentos.filter(live)) {
    // Future appointments are forecasts, not earned revenue.
    if (ag.status !== 'concluido' || !inPeriod(ag.data_hora)) continue;
    if (status === 'pago' && num(ag.valor_pago) <= 0 && num(ag.valor_total) > 0) continue;
    if (['pendente', 'vencido'].includes(status)) continue;
    const items = array(ag.itens);
    const total = items.reduce((acc, item) => acc + num(item.valor), 0);
    let selected = 0, count = 0;
    const selectedIndexes = [];
    if (!items.length && matches(null, 'Serviço')) {
      detalhes.agendamentos.push({ id: ag.id, descricao: `Atendimento #${ag.numero || ag.id}`, data: date(ag.data_hora),
        valor: money(ag.valor_total), categoria: 'Serviço', status: ag.status, origem: 'Atendimento' });
      selectedAgs.add(ag.id); selected = num(ag.valor_total); count = 1; selectedIndexes.push(0);
      warnings.add('Há atendimentos sem itens: insumos e comissões não puderam ser apurados.');
    }
    items.forEach((item, index) => {
      const service = serviceMap.get(String(item.servico_id));
      const catId = item.categoria_id ?? service?.categoria_id;
      if (!matches(catId, categoryName(catId))) return;
      count++; selectedIndexes.push(index); selected += num(item.valor); selectedAgs.add(ag.id);
      const common = { id: `${ag.id}-${index}`, agendamento_id: ag.id, data: date(ag.data_hora),
        descricao: `${item.nome || service?.nome || 'Serviço'} — #${ag.numero || ag.id} — ${ag.cliente_nome || 'Consumidor'}`,
        categoria: categoryName(catId) || 'Serviço', status: ag.status, origem: 'Atendimento' };
      detalhes.agendamentos.push({ ...common, valor: money(item.valor) });
      let supplies = 0;
      array(item.produtos_utilizados).forEach((supply, supplyIndex) => {
        const unit = unitCost(supply, true);
        const value = money(num(supply.quantidade) * unit);
        supplies += value;
        detalhes.insumos.push({ ...common, id: `${common.id}-insumo-${supplyIndex}`, valor: value,
          categoria: 'Insumos de serviços', quantidade: num(supply.quantidade), custo_unitario: unit,
          descricao: `${supply.produto_nome || supply.nome || productMap.get(String(supply.produto_id))?.nome || 'Insumo'} — ${common.descricao}`,
          origem: present(supply.custo_proporcional) || present(supply.custo_unitario) ? 'Consumo registrado' : 'Consumo / custo atual' });
      });
      const discount = json(ag.desconto_aplicado);
      const baseOriginal = present(item.base_comissao_original) ? num(item.base_comissao_original) :
        Math.max(0, num(discount?.incide_comissao === false ? item.valor_original ?? item.valor : item.valor) - supplies);
      const deduct = item.descontou_taxa_cartao ?? config?.descontar_taxa_cartao_comissao;
      const base = present(item.base_comissao_final) ? num(item.base_comissao_final) : Math.max(0, baseOriginal - (deduct ? num(item.taxa_cartao_descontada) : 0));
      commission(item, ag, base, false, common);
      commission(item, ag, base, true, common);
    });
    shares.set(`a:${ag.id}`, { weights: items.length ? items.map(item => num(item.valor)) : [num(ag.valor_total)], selectedIndexes, fraction: total > 0 ? selected / total : count / (items.length || 1), data: date(ag.data_hora), numero: ag.numero || ag.id });
  }

  for (const sale of vendas.filter(live)) {
    if (sale.status !== 'pago' || !inPeriod(sale.data_venda) || ['pendente', 'vencido'].includes(status)) continue;
    const parsed = array(sale.itens);
    const items = parsed.length ? parsed : [{ produto_id: sale.produto_id, produto_nome: sale.produto_nome, quantidade: sale.quantidade, subtotal: sale.valor_total }];
    const total = items.reduce((acc, item) => acc + num(item.subtotal ?? num(item.preco_unitario) * num(item.quantidade)), 0);
    let selected = 0, count = 0;
    const selectedIndexes = [];
    items.forEach((item, index) => {
      const product = productMap.get(String(item.produto_id));
      const catId = item.categoria_id ?? product?.categoria_id;
      if (!matches(catId, product?.categoria || categoryName(catId))) return;
      const revenue = num(item.subtotal ?? num(item.preco_unitario) * num(item.quantidade));
      selectedIndexes.push(index); selected += revenue; count++; selectedSales.add(sale.id);
      const common = { id: `${sale.id}-${index}`, venda_direta_id: sale.id, data: date(sale.data_venda),
        descricao: `${item.produto_nome || product?.nome || 'Produto'} — #${sale.numero_venda || sale.id}`,
        categoria: product?.categoria || categoryName(catId) || 'Venda de Produto', status: sale.status, origem: 'Venda direta' };
      detalhes.vendas.push({ ...common, valor: money(revenue) });
      const unit = unitCost(item);
      detalhes.cmv.push({ ...common, valor: money(num(item.quantidade) * unit), categoria: 'CMV',
        quantidade: num(item.quantidade), custo_unitario: unit, origem: present(item.custo_unitario) ? 'Custo registrado na venda' : 'Custo atual do cadastro' });
      if (sale.colaborador_id) {
        const pct = num(item.comissao_pct ?? product?.comissao);
        if (!present(item.comissao_pct)) warnings.add('Há comissões antigas calculadas com as regras atuais por falta de histórico.');
        const discount = json(sale.desconto_aplicado);
        const base = discount?.incide_comissao === false && present(item.preco_unitario_original) ? num(item.preco_unitario_original) * num(item.quantidade) : revenue;
        detalhes.comissoes.push({ ...common, valor: money(base * pct / 100), categoria: 'Comissões de produtos',
          descricao: `${common.descricao} — ${sale.colaborador_nome || staffMap.get(String(sale.colaborador_id))?.nome || sale.colaborador_id}`,
          percentual: pct, base_calculo: money(base), status: sale.comissao_paga ? 'Pago' : 'Provisionado', origem: 'Comissão da venda' });
      }
    });
    shares.set(`v:${sale.id}`, { weights: items.map(item => num(item.subtotal ?? num(item.preco_unitario) * num(item.quantidade))), selectedIndexes, fraction: total > 0 ? selected / total : count / items.length, data: date(sale.data_venda), numero: sale.numero_venda || sale.id });
  }

  for (const payment of pagamentos.filter(live)) {
    const share = shares.get(payment.agendamento_id ? `a:${payment.agendamento_id}` : `v:${payment.venda_direta_id}`);
    if (!share || share.fraction <= 0) continue;
    const fee = reportCardFee(payment, taxas);
    if (!fee) continue;
    if (fee.alerta) warnings.add(fee.alerta);
    if (fee.incompleta) continue;
    const type = fee.tipo;
    const pct = fee.percentual;
    const feeShares = allocateMoney(fee.taxa_valor, share.weights);
    const baseShares = allocateMoney(payment.valor, share.weights);
    const allocatedBase = money(share.selectedIndexes.reduce((total, index) => total + baseShares[index], 0));
    const allocatedFee = money(share.selectedIndexes.reduce((total, index) => total + feeShares[index], 0));
    detalhes.taxas_cartao.push({ id: payment.id, pagamento_id: payment.id,
      agendamento_id: payment.agendamento_id || null, venda_direta_id: payment.venda_direta_id || null,
      data: share.data, data_pagamento: date(payment.data_hora),
      descricao: `${payment.agendamento_id ? 'Atendimento' : 'Venda'} #${share.numero} — ${payment.forma_pagamento || type || 'Cartão'}`,
      bandeira: payment.cartao_bandeira || '', parcelas: payment.cartao_parcelas ?? null,
      valor_liquido: money(allocatedBase - allocatedFee), data_recebimento_prevista: date(payment.data_recebimento_prevista),
      rateado: share.fraction !== 1,
      categoria: type === 'credito' ? 'Cartão de crédito' : type === 'debito' ? 'Cartão de débito' : 'Outras taxas de cartão',
      tipo: type || 'outros', valor: allocatedFee, base_calculo: allocatedBase,
      percentual: present(pct) ? num(pct) : null, origem: fee.origem, status: 'Reconhecido' });
  }

  function financialRows(rows, expense) {
    for (const row of rows.filter(live)) {
      const competence = date(row.data_documento || row.data_vencimento);
      if (!inPeriod(competence) || !matches(null, row.categoria) || !paidFilter(row, expense ? row.pago : row.recebido)) continue;
      if (!row.data_documento) warnings.add('Lançamentos sem data de documento usam o vencimento como referência de competência.');
      const detail = { id: row.id, descricao: row.descricao, valor: money(row.valor), data: competence,
        data_pagamento: expense ? row.data_pagamento : row.data_recebimento, categoria: row.categoria || 'Sem categoria',
        tipo: ['fixo', 'variavel'].includes(norm(row.tipo)) ? norm(row.tipo) : 'nao_classificado',
        fornecedor: row.fornecedor || row.cliente || '', documento: row.numero_documento || '', status: row.status,
        origem: expense ? 'Contas a pagar' : 'Outras receitas' };
      if (expense && row.entrada_estoque_id) { detalhes.compras_estoque.push(detail); continue; }
      if (!row.categoria) warnings.add('Há lançamentos financeiros sem categoria.');
      if (expense && detail.tipo === 'nao_classificado') warnings.add('Despesas sem tipo fixo/variável foram incluídas no total como não classificadas.');
      if (expense && /comiss|cartao|insumo|mercadoria|estoque/.test(norm(`${row.categoria} ${row.descricao}`)))
        warnings.add('Revise despesas manuais de comissões, cartões e estoque: sem vínculo com a operação, não é possível eliminar duplicidades automaticamente.');
      (expense ? detalhes.despesas : detalhes.outras_receitas).push(detail);
    }
  }
  financialRows(despesas, true);
  financialRows(receitas, false);
  const fixed = sum(detalhes.despesas.filter(row => row.tipo === 'fixo'));
  const variable = sum(detalhes.despesas.filter(row => row.tipo === 'variavel'));
  const unclassified = sum(detalhes.despesas.filter(row => row.tipo === 'nao_classificado'));
  const fees = sum(detalhes.taxas_cartao), commissions = sum(detalhes.comissoes);
  const cmv = sum(detalhes.cmv), supplies = sum(detalhes.insumos);
  const revenue = money(sum(detalhes.agendamentos) + sum(detalhes.vendas) + sum(detalhes.outras_receitas));
  const gross = money(revenue - cmv - supplies);
  const operatingExpenses = money(fixed + variable + unclassified + fees + commissions);
  const profit = money(gross - operatingExpenses);
  detalhes.despesas_operacionais = [...detalhes.despesas, ...detalhes.comissoes, ...detalhes.taxas_cartao];
  detalhes.custos_despesas = [...detalhes.cmv, ...detalhes.insumos, ...detalhes.despesas_operacionais];
  const group = rows => rows.reduce((acc, row) => { acc[row.categoria] = money((acc[row.categoria] || 0) + row.valor); return acc; }, Object.create(null));
  return { data_inicio, data_fim, regime: 'competencia', receita_servicos: sum(detalhes.agendamentos),
    receita_vendas_diretas: sum(detalhes.vendas), outras_receitas: sum(detalhes.outras_receitas), receita_bruta: revenue,
    custo_produtos: cmv, custo_insumos: supplies, comissoes: commissions, lucro_bruto: gross,
    despesas: { fixas: fixed, variaveis: variable, nao_classificadas: unclassified },
    taxas_cartao: { credito: sum(detalhes.taxas_cartao.filter(row => row.tipo === 'credito')),
      debito: sum(detalhes.taxas_cartao.filter(row => row.tipo === 'debito')),
      outros: sum(detalhes.taxas_cartao.filter(row => !['credito', 'debito'].includes(row.tipo))), total: fees },
    despesas_operacionais: operatingExpenses, total_custos_despesas: money(cmv + supplies + operatingExpenses),
    lucro_liquido: profit, margem_liquida: revenue ? money(profit / revenue * 100) : 0,
    total_atendimentos: selectedAgs.size, total_vendas_diretas: selectedSales.size, detalhes,
    despesas_por_categoria: group(detalhes.despesas_operacionais), receitas_por_categoria: group(detalhes.outras_receitas),
    alertas: [...warnings], compras_estoque_excluidas: sum(detalhes.compras_estoque) };
}
