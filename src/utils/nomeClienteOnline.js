export function normalizarNomeCliente(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

export function nomeClienteCompleto(value) {
  const nome = normalizarNomeCliente(value);
  const partes = nome.split(' ');
  return nome.length <= 255 && partes.length >= 2
    && partes.every(parte => /^\p{L}[\p{L}\p{M}'’.-]*$/u.test(parte));
}
