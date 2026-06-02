import * as whatsappService from './whatsapp.service.js';
import { getLocalClientStatus, disconnectLocalClient } from './local-client.js';

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

