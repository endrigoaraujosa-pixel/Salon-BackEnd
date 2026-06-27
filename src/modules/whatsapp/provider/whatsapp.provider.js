import axios from 'axios';
import { sendLocalMessage } from '../local-client.js';
import { formatPhoneNumber } from '../../../utils/index.js';

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
      console.log(`[WhatsAppProvider - Simulação] Mensagem simulada para ${phone}: ${message}`);
      return { success: true, messageId: `simulated_${Date.now()}` };
    }

    // Se for Modo Local
    if (config.api_url === 'local' || config.instancia === 'local') {
      try {
        console.log(`[WhatsAppProvider] Enviando mensagem via WhatsApp Local para ${phone}`);
        return await sendLocalMessage(phone, message);
      } catch (err) {
        console.error(`[WhatsAppProvider] Erro ao enviar mensagem via WhatsApp Local para ${phone}:`, err.message);
        return {
          success: false,
          error: `Erro no WhatsApp Local: ${err.message}`
        };
      }
    }

    try {
      // Limpa caracteres especiais do telefone (mantendo apenas números)
      let cleanPhone = formatPhoneNumber(phone)
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

  /**
   * Verifica se um número possui WhatsApp
   * @param {string} phone - O telefone a ser verificado
   * @param {object} config - Configurações de API (instancia)
   * @returns {Promise<{ exists: boolean, jid?: string }>}
   */
  async checkNumber(phone, config = null) {
    if (!config) {
      return { exists: true };
    }

    try {
      let cleanPhone = formatPhoneNumber(phone);
      const baseUrl = process.env.EVOLUTION_API_URL;
      const instance = config.instancia;

      const url = `${baseUrl}/chat/whatsappNumbers/${instance}`;

      const payload = {
        numbers: [cleanPhone]
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.EVOLUTION_API_TOKEN || ''
        },
        timeout: 10000
      });

      if (response.data && response.data.length > 0) {
        return {
          exists: response.data[0].exists,
          jid: response.data[0].jid
        };
      }

      return { exists: false };
    } catch (error) {
      console.error(`[WhatsAppProvider] Erro ao verificar número ${phone}:`, error.message);
      // Em caso de erro de API, não podemos afirmar se não existe, mas retornamos false ou um indicador de erro
      return { exists: false, error: true };
    }
  }
}

const providerInstance = new WhatsAppProvider();
export default providerInstance;
