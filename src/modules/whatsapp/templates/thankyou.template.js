export const DEFAULT_THANKYOU_TEMPLATE = `Olá, {nome}!

Agradecemos por escolher nossos serviços. Foi um prazer atendê-lo(a) no dia {data}, às {hora}.

Serviços realizados:
{servicos_valores}

Esperamos revê-lo(a) em breve. Conte sempre com nossa equipe!

Atenciosamente.`;

/**
 * Substitui as variáveis no template de agradecimento pelos valores correspondentes do agendamento.
 * 
 * @param {string} template - O template da mensagem de agradecimento.
 * @param {object} params - Objeto contendo nome, data, hora, servico, profissional e servicos_valores.
 * @returns {string} A mensagem formatada.
 */
export function formatThankYouMessage(template, params) {
  const tpl = template || DEFAULT_THANKYOU_TEMPLATE;
  return tpl
    .replace(/{nome}/g, params.nome || "")
    .replace(/{data}/g, params.data || "")
    .replace(/{hora}/g, params.hora || "")
    .replace(/{servico}/g, params.servico || "")
    .replace(/{profissional}/g, params.profissional || "")
    .replace(/{servicos_valores}/g, params.servicos_valores || "");
}
