const numeric = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const present = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const money = value => Math.round((numeric(value) + Number.EPSILON) * 100) / 100;

// Decimal arithmetic avoids binary .toFixed rounding 250 * 5.39% to 13.47.
// Multiplying amount by percent gives the fee in cents directly.
export function calculateCardFee(amount, percent) {
  const fraction = value => {
    const match = String(numeric(value)).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    const decimals = match[3] || '';
    const scale = decimals.length - Number(match[4] || 0);
    const integer = BigInt(match[2] + decimals) * (match[1] ? -1n : 1n);
    return scale >= 0 ? [integer, 10n ** BigInt(scale)] : [integer * 10n ** BigInt(-scale), 1n];
  };
  const [amountN, amountD] = fraction(amount);
  const [percentN, percentD] = fraction(percent);
  const product = amountN * percentN;
  const numerator = product < 0n ? -product : product;
  const denominator = amountD * percentD;
  const cents = (numerator * 2n + denominator) / (denominator * 2n);
  return Number(product < 0n ? -cents : cents) / 100;
}

// Allocate whole cents before filtering or grouping. The largest remainders
// receive the leftover cents, with original item order as the tie breaker.
export function allocateMoney(value, weights) {
  if (!weights.length) return [];
  const cents = Math.round(Math.abs(numeric(value)) * 100);
  const sign = numeric(value) < 0 ? -1 : 1;
  let units = weights.map(weight => Math.max(0, Math.round(numeric(weight) * 100)));
  if (!units.some(Boolean)) units = units.map(() => 1);
  const total = units.reduce((sum, unit) => sum + unit, 0);
  const shares = units.map((unit, index) => {
    const numerator = cents * unit;
    return { index, cents: Math.floor(numerator / total), remainder: numerator % total };
  });
  let remaining = cents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining-- <= 0) break;
    share.cents++;
  }
  return shares.map(share => sign * share.cents / 100);
}

export function reportCardFee(payment, rates) {
  const rate = rates.find(row => row.forma_pagamento === payment.forma_pagamento);
  const tipo = payment.cartao_tipo || rate?.tipo_cartao || ({ cartao_credito: 'credito', cartao_debito: 'debito' })[payment.forma_pagamento];
  if (!tipo && !present(payment.cartao_taxa_valor)) return null;
  const installments = Math.min(12, Math.max(1, numeric(payment.cartao_parcelas) || 1));
  let percentual = payment.cartao_taxa_percentual;
  if (!present(percentual) && rate && rate.deletado !== 'S' && rate.ativo !== false)
    percentual = tipo === 'credito' ? rate[`taxa_${installments}x`] ?? rate.percentual : rate.percentual;
  let fee = payment.cartao_taxa_valor;
  let alerta;
  if (!present(fee)) {
    if (!present(percentual)) return { tipo: tipo || 'outros', taxa_valor: 0, percentual: null, incompleta: true,
      alerta: 'Há pagamentos em cartão sem taxa registrada ou configurada; o custo está incompleto.' };
    fee = calculateCardFee(payment.valor, percentual);
    if (!present(payment.cartao_taxa_percentual)) alerta = 'Há taxas de cartão estimadas pela configuração atual, sem histórico no pagamento.';
  }
  return { tipo: tipo || 'outros', taxa_valor: money(fee), percentual: present(percentual) ? numeric(percentual) : null,
    origem: present(payment.cartao_taxa_valor) ? 'Taxa registrada no pagamento' : 'Taxa calculada', alerta };
}

export function allocateCardFees(payments, rates, weights) {
  const cents = weights.map(() => 0);
  for (const payment of payments) {
    if (payment.deletado === 'S') continue;
    const fee = reportCardFee(payment, rates);
    if (!fee) continue;
    allocateMoney(fee.taxa_valor, weights).forEach((value, index) => { cents[index] += Math.round(value * 100); });
  }
  return cents.map(value => value / 100);
}
