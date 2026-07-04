import axios from 'axios';
import { sendLocalMessage } from '../local-client.js';
import { formatPhoneNumber } from '../../../utils/index.js';

function getEvolutionBaseUrl(config = {}) {
  const configuredUrl = String(config.api_url || '').trim();
  const envUrl = String(process.env.EVOLUTION_API_URL || '').trim();

  if (configuredUrl && configuredUrl !== 'external' && configuredUrl !== 'local') {
    return configuredUrl.replace(/\/+$/, '');
  }

  return envUrl.replace(/\/+$/, '');
}

function getEvolutionApiKey(config = {}) {
  return String(process.env.EVOLUTION_API_TOKEN || config.token || '').trim();
}

function buildEvolutionHeaders(config = {}) {
  const apiKey = getEvolutionApiKey(config);
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { apikey: apiKey } : {})
  };
}

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
      let cleanPhone = formatPhoneNumber(phone);

      // Valida o número de telefone e obtém o JID correto
      let targetNumber = cleanPhone;
      const checkResult = await this.checkNumber(cleanPhone, config);
      if (checkResult && checkResult.exists && checkResult.jid) {
        targetNumber = checkResult.jid;
        console.log(`[WhatsAppProvider] Número verificado com sucesso. Usando JID: ${targetNumber}`);
      } else if (checkResult && checkResult.exists === false && !checkResult.error) {
        // Se a verificação retornou explicitamente que o número não existe no WhatsApp
        console.warn(`[WhatsAppProvider] O número ${cleanPhone} não foi encontrado no WhatsApp.`);
        return {
          success: false,
          error: `O número ${phone} não está cadastrado no WhatsApp.`
        };
      } else {
        // Caso ocorra algum erro na checagem, prossegue com o número limpo original como fallback
        console.warn(`[WhatsAppProvider] Erro ou resposta inválida na validação do número ${cleanPhone}. Prosseguindo com o número original como fallback.`);
      }

      // Monta a URL e os headers
      const baseUrl = getEvolutionBaseUrl(config);
      const instance = config.instancia;
      if (!baseUrl) {
        return {
          success: false,
          error: 'URL da Evolution API nao configurada.'
        };
      }

      // Suporta Evolution API /message/sendText/:instance
      const url = `${baseUrl}/message/sendText/${instance}`;

      // Evolution API v2 Payload Structure
      const payload = {
        number: targetNumber,
        text: message
      };

      const response = await axios.post(url, payload, {
        headers: buildEvolutionHeaders(config),
        timeout: 15000 // 15 segundos timeout
      });

      // A Evolution pode retornar HTTP 200 mesmo quando a entrega ainda nao aconteceu.
      // Aqui exigimos pelo menos o ID aceito pela API para evitar marcar erro inesperado como "Enviado".
      const keyId = response.data?.key?.id || response.data?.messageId || response.data?.id;
      if (!keyId) {
        return {
          success: false,
          error: 'A Evolution aceitou a requisicao, mas nao retornou identificador da mensagem.'
        };
      }

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
      const baseUrl = getEvolutionBaseUrl(config);
      const instance = config.instancia;
      if (!baseUrl || !instance) {
        return { exists: false, error: true };
      }

      const url = `${baseUrl}/chat/whatsappNumbers/${instance}`;

      // Gerar lista de números a checar para tratar o 9º dígito no Brasil
      const numbersToCheck = [cleanPhone];
      if (cleanPhone.startsWith('55') && (cleanPhone.length === 12 || cleanPhone.length === 13)) {
        const ddd = cleanPhone.substring(2, 4);
        if (cleanPhone.length === 13) {
          // Remove o 9º dígito: 55 + DDD + 8 dígitos restantes
          const alternative = '55' + ddd + cleanPhone.substring(5);
          if (!numbersToCheck.includes(alternative)) {
            numbersToCheck.push(alternative);
          }
        } else if (cleanPhone.length === 12) {
          // Insere o 9º dígito: 55 + DDD + 9 + 8 dígitos restantes
          const alternative = '55' + ddd + '9' + cleanPhone.substring(4);
          if (!numbersToCheck.includes(alternative)) {
            numbersToCheck.push(alternative);
          }
        }
      }

      const payload = {
        numbers: numbersToCheck
      };

      const response = await axios.post(url, payload, {
        headers: buildEvolutionHeaders(config),
        timeout: 10000
      });

      if (response.data && Array.isArray(response.data)) {
        const found = response.data.find(item => item && item.exists);
        if (found) {
          return {
            exists: true,
            jid: found.jid || `${found.number}@s.whatsapp.net`
          };
        }
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
