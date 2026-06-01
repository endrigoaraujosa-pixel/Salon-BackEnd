export const DEFAULT_TEMPLATE = `Olá, {nome}!

Passando para lembrar que você possui um horário agendado.

📅 Data: {data}
⏰ Hora: {hora}
💇 Serviço: {servico}
👤 Profissional: {profissional}

Estamos esperando você.`;

/**
 * Substitui as variáveis no template pelos valores correspondentes do agendamento.
 * 
 * @param {string} template - O template da mensagem.
 * @param {object} params - Objeto contendo nome, data, hora, servico e profissional.
 * @returns {string} A mensagem formatada.
 */
export function formatMessage(template, params) {
  const tpl = template || DEFAULT_TEMPLATE;
  return tpl
    .replace(/{nome}/g, params.nome || "")
    .replace(/{data}/g, params.data || "")
    .replace(/{hora}/g, params.hora || "")
    .replace(/{servico}/g, params.servico || "")
    .replace(/{profissional}/g, params.profissional || "");
}
