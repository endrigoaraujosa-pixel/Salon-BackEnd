import axios from 'axios';
import { sendLocalMessage } from '../local-client.js';

export class WhatsAppProvider {
  /**
   * Envia uma mensagem via WhatsApp.
   * @param {string} phone - O telefone do cliente (com DDI e DDD)
   * @param {string} message - O conteúdo formatado da mensagem
   * @param {object} [config] - Configurações de API (api_url, instancia, token)
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async sendMessage(phone, message, config = null) {
    // Se não tiver configurações de API, executa a simulação
    if (!config || !config.instancia) {
      return { success: false, error: "Configurações de WhatsApp não encontradas" };
    }

    try {
      // Limpa caracteres especiais do telefone (mantendo apenas números)
      let cleanPhone = phone.replace(/\D/g, "");

      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = "55" + cleanPhone;
      }
      // Monta a URL e os headers
      const baseUrl = process.env.EVOLUTION_API_URL
      const instance = config.instancia;

      // Suporta Evolution API /message/sendText/:instance
      const url = `${baseUrl}/message/sendText/${instance}`;

      // Evolution API v2 Payload Structure
      const payload = {
        number: cleanPhone,
        text: message
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.EVOLUTION_API_TOKEN || ''
        },
        timeout: 15000 // 15 segundos timeout
      });

      // Retorna sucesso com o messageId da Evolution API
      const keyId = response.data?.key?.id || response.data?.messageId || `sent_${Date.now()}`;
      return {
        success: true,
        messageId: keyId
      };

    } catch (error) {
      const errorMsg = error.response?.data?.message || error.response?.data?.detail || error.message;
      console.error(`[WhatsAppProvider] Erro ao enviar mensagem real para ${phone}:`, errorMsg);
      return {
        success: false,
        error: `Erro na API de Envio: ${errorMsg}`
      };
    }
  }
}

const providerInstance = new WhatsAppProvider();
export default providerInstance;
