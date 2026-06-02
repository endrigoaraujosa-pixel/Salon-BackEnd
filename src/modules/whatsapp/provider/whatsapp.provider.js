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
    // Se a API_URL for configurada como 'local', envia pelo WhatsApp Web integrado
    if (config && config.api_url === 'local') {
      try {
        return await sendLocalMessage(phone, message);
      } catch (error) {
        console.error(`[WhatsAppProvider] Erro ao enviar pelo WhatsApp Local para ${phone}:`, error.message);
        return {
          success: false,
          error: `Erro no WhatsApp Local: ${error.message}`
        };
      }
    }

    // Se não tiver configurações de API, executa a simulação
    if (!config || !config.api_url || !config.instancia) {
      console.log(`[WhatsAppProvider] Modo Simulação - Envio de mensagem para ${phone}:`);
      console.log(`========================================`);
      console.log(message);
      console.log(`========================================`);
      
      return {
        success: true,
        messageId: `mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`
      };
    }

    try {
      // Limpa caracteres especiais do telefone (mantendo apenas números)
      let cleanPhone = phone.replace(/\D/g, "");
      
      // Garante o DDI (55 para Brasil) caso falte
      if (cleanPhone.length === 10 || cleanPhone.length === 11) {
        cleanPhone = "55" + cleanPhone;
      }

      // Monta a URL e os headers
      const baseUrl = config.api_url.endsWith('/') ? config.api_url.slice(0, -1) : config.api_url;
      const instance = config.instancia;
      
      // Suporta Evolution API /message/sendText/:instance
      const url = `${baseUrl}/message/sendText/${instance}`;
      
      const payload = {
        number: cleanPhone,
        // Evolution API v2 Payload Structure (Root level)
        text: message,
        delay: 1200,
        linkPreview: false,
        // Evolution API v1 Payload Structure (Nested level)
        options: {
          delay: 1200,
          presence: "composing",
          linkPreview: false
        },
        textMessage: {
          text: message
        }
      };

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.token || ''
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
