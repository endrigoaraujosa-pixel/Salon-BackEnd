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
    const serv = await Servico.create(req.body);
    res.status(201).json(serv);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateServ = async (req, res) => {
  try {
    const serv = await Servico.findByPk(req.params.sid);
    if (!serv) return res.status(404).json({ detail: 'Serviço não encontrado' });
    
    await serv.update(req.body);
    res.json(serv);
  } catch (error) {
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
