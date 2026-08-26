export const formatPhoneNumber = (number) => {
  // Remove todos os caracteres que não são números
  let cleanPhone = number.replace(/\D/g, '');

  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = "55" + cleanPhone;
  }

  return cleanPhone;
}

export const maskPhoneNumber = (number) => {
  if (!number) return '';
  const clean = String(number).replace(/\D/g, '');
  if (clean.length < 8) return '****';
  const prefix = clean.substring(0, Math.min(5, clean.length - 4));
  const suffix = clean.substring(clean.length - 4);
  return `${prefix}****${suffix}`;
};


/**
 * Formata os nomes dos profissionais de um agendamento.
 * Se houver 1 profissional, exibe o nome dele.
 * Se houver exatamente 2 profissionais, separa com "e" em vez de vírgula.
 * Se houver 3 ou mais profissionais, separa com vírgula e o último com "e".
 * Exemplo: "Keila Frutuoso e Cleitiany" ou "Keila, Cleitiany e Maria".
 * 
 * @param {Array} profissionais - Lista de objetos profissionais.
 * @returns {string} String com os nomes formatados.
 */
export function formatProfissionalNames(profissionais) {
  if (!Array.isArray(profissionais) || profissionais.length === 0) {
    return "Não informado";
  }

  const nomes = profissionais
    .map(p => p && p.nome)
    .filter(nome => typeof nome === 'string' && nome.trim().length > 0)
    .map(nome => nome.trim());

  if (nomes.length === 0) {
    return "Não informado";
  }

  if (nomes.length === 1) {
    return nomes[0];
  }

  if (nomes.length === 2) {
    return `${nomes[0]} e ${nomes[1]}`;
  }

  // 3 ou mais: "A, B e C"
  const ultimo = nomes.pop();
  return `${nomes.join(", ")} e ${ultimo}`;
}