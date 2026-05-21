import Servico from '../models/Servico.js';

const listServ = async (req, res) => {
  try {
    const servs = await Servico.findAll({ order: [['nome', 'ASC']] });
    res.json(servs);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createServ = async (req, res) => {
  try {
    const { categoria_id } = req.body;
    if (!categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    console.log("createServ payload received:", JSON.stringify(req.body, null, 2));
    const serv = await Servico.create(req.body);
    console.log("createServ success, saved record:", JSON.stringify(serv.toJSON(), null, 2));
    res.status(201).json(serv);
  } catch (error) {
    console.error("createServ error:", error);
    res.status(500).json({ detail: error.message });
  }
};

const updateServ = async (req, res) => {
  try {
    const { categoria_id } = req.body;
    if (categoria_id !== undefined && !categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    console.log("updateServ sid:", req.params.sid, "payload received:", JSON.stringify(req.body, null, 2));
    const serv = await Servico.findByPk(req.params.sid);
    if (!serv) return res.status(404).json({ detail: 'Serviço não encontrado' });
    
    await serv.update(req.body);
    console.log("updateServ success, updated record:", JSON.stringify(serv.toJSON(), null, 2));
    res.json(serv);
  } catch (error) {
    console.error("updateServ error:", error);
    res.status(500).json({ detail: error.message });
  }
};

const deleteServ = async (req, res) => {
  try {
    const serv = await Servico.findByPk(req.params.sid);
    if (serv) await serv.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { listServ, createServ, updateServ, deleteServ };
