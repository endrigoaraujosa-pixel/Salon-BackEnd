import Cliente from '../models/Cliente.js';
import Agendamento from '../models/Agendamento.js';
import { Op } from 'sequelize';

const listClientes = async (req, res) => {
  try {
    const clientes = await Cliente.findAll({ order: [['nome', 'ASC']] });
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createCliente = async (req, res) => {
  try {
    const cliente = await Cliente.create(req.body);
    res.status(201).json(cliente);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.cid);
    if (!cliente) return res.status(404).json({ detail: 'Cliente não encontrado' });
    
    await cliente.update(req.body);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.cid);
    if (cliente) await cliente.destroy();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const historicoCliente = async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.cid);
    if (!cliente) return res.status(404).json({ detail: 'Cliente não encontrado' });

    const agendamentos = await Agendamento.findAll({
      where: { cliente_id: req.params.cid },
      order: [['data_hora', 'DESC']],
      limit: 100
    });

    const concluidos = agendamentos.filter(a => a.status === 'concluido');
    const totalGasto = concluidos.reduce((acc, a) => acc + a.valor_total, 0);

    res.json({
      cliente,
      agendamentos,
      total_gasto: totalGasto,
      total_visitas: concluidos.length
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listClientes,
  createCliente,
  updateCliente,
  deleteCliente,
  historicoCliente
};
