import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';

let client = null;
let clientState = {
  status: 'disconnected', // 'disconnected', 'connecting', 'ready'
  qr: null,
  user: null
};

export function getLocalClientStatus() {
  return clientState;
}

export async function initLocalClient() {
  if (client) {
    console.log('[LocalWhatsApp] Cliente já inicializado.');
    return;
  }

  console.log('[LocalWhatsApp] Inicializando cliente WhatsApp local...');
  clientState.status = 'connecting';

  try {
    client = new Client({
      authStrategy: new LocalAuth({
        clientId: 'salon-client'
      }),
      puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      }
    });

    client.on('qr', async (qr) => {
      console.log('[LocalWhatsApp] QR Code recebido. Gerando imagem...');
      clientState.status = 'disconnected';
      clientState.user = null;
      try {
        // Gera imagem Base64 para exibir no frontend
        clientState.qr = await qrcode.toDataURL(qr);
        
        // Também imprime no terminal caso o usuário prefira ler de lá!
        qrcodeTerminal.generate(qr, { small: true });
      } catch (err) {
        console.error('[LocalWhatsApp] Erro ao gerar imagem do QR Code:', err);
      }
    });

    client.on('ready', () => {
      console.log('[LocalWhatsApp] Conectado e pronto para uso!');
      clientState.status = 'ready';
      clientState.qr = null;
      clientState.user = client.info?.wid?.user || 'Conectado';
    });

    client.on('authenticated', () => {
      console.log('[LocalWhatsApp] Autenticado com sucesso.');
    });

    client.on('auth_failure', (msg) => {
      console.error('[LocalWhatsApp] Falha na autenticação:', msg);
      clientState.status = 'disconnected';
      clientState.qr = null;
      clientState.user = null;
    });

    client.on('disconnected', (reason) => {
      console.log('[LocalWhatsApp] Cliente desconectado:', reason);
      clientState.status = 'disconnected';
      clientState.qr = null;
      clientState.user = null;
    });

    await client.initialize();
  } catch (error) {
    console.error('[LocalWhatsApp] Erro na inicialização do cliente:', error);
    clientState.status = 'disconnected';
  }
}

export async function disconnectLocalClient() {
  if (!client) return;
  console.log('[LocalWhatsApp] Desconectando cliente...');
  try {
    await client.logout();
    await client.destroy();
  } catch (error) {
    console.error('[LocalWhatsApp] Erro ao deslogar cliente:', error);
  } finally {
    client = null;
    clientState = {
      status: 'disconnected',
      qr: null,
      user: null
    };
    // Re-inicializa para gerar um novo QR Code imediatamente
    initLocalClient();
  }
}

export async function sendLocalMessage(phone, message) {
  if (!client || clientState.status !== 'ready') {
    throw new Error('WhatsApp local não está conectado ou pronto.');
  }

  // Limpa caracteres especiais do telefone
  let cleanPhone = phone.replace(/\D/g, "");
  
  // Garante DDI 55 se faltar
  if (cleanPhone.length === 10 || cleanPhone.length === 11) {
    cleanPhone = "55" + cleanPhone;
  }

  // Se for Brasil, aplica a regra do 9º dígito para DDDs >= 31 (onde o JID é registrado sem o 9º dígito)
  if (cleanPhone.startsWith("55") && cleanPhone.length === 13) {
    const ddd = parseInt(cleanPhone.substring(2, 4), 10);
    if (ddd >= 31) {
      // Remove o "9" após o DDD (index 4)
      cleanPhone = cleanPhone.substring(0, 4) + cleanPhone.substring(5);
      console.log(`[LocalWhatsApp] Formatado número brasileiro (DDD >= 31, sem 9º dígito): ${cleanPhone}`);
    }
  }

  let chatId = `${cleanPhone}@c.us`;

  try {
    console.log(`[LocalWhatsApp] Validando número ${cleanPhone} no WhatsApp...`);
    const numberId = await client.getNumberId(cleanPhone);
    if (numberId) {
      chatId = numberId._serialized;
      console.log(`[LocalWhatsApp] ID retornado pelo WhatsApp: ${chatId}`);
    } else {
      console.log(`[LocalWhatsApp] Número não encontrado via getNumberId. Usando JID padrão: ${chatId}`);
    }
  } catch (err) {
    console.warn(`[LocalWhatsApp] Erro ao obter getNumberId (prosseguindo com JID padrão):`, err.message);
  }

  console.log(`[LocalWhatsApp] Enviando mensagem para: ${chatId}`);
  const response = await client.sendMessage(chatId, message);
  return {
    success: true,
    messageId: response.id?.id || `local_${Date.now()}`
  };
}
