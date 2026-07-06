import * as whatsappService from './whatsapp.service.js';
import * as campanhaService from './campanha.service.js';
import { getLocalClientStatus, disconnectLocalClient } from './local-client.js';
import { getWhatsappConfigModel } from '../../models/WhatsappConfig.js';
// import 'dotenv/config';

export const getWhatsappConfig = async (req, res) => {
  try {
    const config = await whatsappService.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const saveWhatsappConfig = async (req, res) => {
  try {
    const config = await whatsappService.saveConfig(req.body);
    res.json(config);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const getWhatsappHistory = async (req, res) => {
  try {
    const history = await whatsappService.getHistory(req.query);
    res.json(history);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const postResendReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await whatsappService.resendReminder(id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

export const getLocalStatus = async (req, res) => {
  try {
    const status = getLocalClientStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const postLocalDisconnect = async (req, res) => {
  try {
    await disconnectLocalClient();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const startLocalIntegration = async (req, res) => {
  try {
    const instance = req.body.subdominio;
    const urlEvolution = process.env.EVOLUTION_API_URL + "/instance/create";
    const payload = {
      instanceName: instance,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS"
    }

    const response = await fetch(urlEvolution, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apiKey': process.env.EVOLUTION_API_TOKEN
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const result = await response.json();

      await whatsappService.saveConfig({
        api_url: 'external',
        instancia: result.instance.instanceName,
        token: result.hash,
      });

      res.json({
        success: true,
        message: 'Integração iniciada com sucesso',
        data: result
      });

    } else {
      const errorData = await response.json();
      res.status(500).json({ detail: errorData.detalhe });
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const getExternalStatus = async (req, res) => {
  try {
    const { instance } = req.params;
    const urlEvolution = process.env.EVOLUTION_API_URL + `/instance/connectionState/${instance}`;

    const response = await fetch(urlEvolution, {
      method: 'GET',
      headers: {
        'apiKey': process.env.EVOLUTION_API_TOKEN
      }
    });

    const result = await response.json();
    if (response.ok) {
      res.json({ ...result, message: "status consultado com sucesso", success: true });
    } else {
      res.status(200).json({ message: result.error || "Erro ao consultar status", success: false });
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const getExternalQrCode = async (req, res) => {
  try {
    const { instance } = req.params;
    const urlEvolution = process.env.EVOLUTION_API_URL + `/instance/connect/${instance}`;

    const response = await fetch(urlEvolution, {
      method: 'GET',
      headers: {
        'apiKey': process.env.EVOLUTION_API_TOKEN
      }
    });

    if (response.ok) {
      const result = await response.json();
      res.json(result);
    } else {
      const errorData = await response.json();
      res.status(500).json({ detail: errorData.detail || "Erro ao buscar qr code" });
    }
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const postCheckWhatsappNumber = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ detail: "Telefone não fornecido." });
    }
    const result = await whatsappService.checkWhatsappNumber(phone);
    res.json(result);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// ─── Campanhas de Mensagem em Massa ───────────────────────────────────────────

export const listCampanhas = async (req, res) => {
  try {
    const result = await campanhaService.listCampanhas(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const getCampanha = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await campanhaService.getCampanha(id);
    res.json(result);
  } catch (error) {
    res.status(404).json({ detail: error.message });
  }
};

export const createCampanha = async (req, res) => {
  try {
    const usuarioNome = req.user?.name || req.user?.email || 'Sistema';
    const campanha = await campanhaService.createCampanha(req.body, usuarioNome);
    res.status(201).json(campanha);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};

export const cancelarCampanha = async (req, res) => {
  try {
    const { id } = req.params;
    const campanha = await campanhaService.cancelarCampanha(id);
    res.json(campanha);
  } catch (error) {
    res.status(400).json({ detail: error.message });
  }
};
