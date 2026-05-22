import Cliente from '../models/Cliente.js';
import Agendamento from '../models/Agendamento.js';
import VendaDireta from '../models/VendaDireta.js';
import { Op } from 'sequelize';

const listClientes = async (req, res) => {
  try {
    const clientes = await Cliente.findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });
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
    if (cliente) {
      await cliente.update({
        deletado: 'S',
        deletado_por: req.user ? req.user.name : 'Sistema',
        deletado_em: new Date()
      });
    }
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
      where: { cliente_id: req.params.cid, deletado: 'N' },
      order: [['data_hora', 'DESC']],
      limit: 100
    });

    const vendas = await VendaDireta.findAll({
      where: { cliente_id: req.params.cid, deletado: 'N' },
      order: [['data_venda', 'DESC']],
      limit: 100
    });

    const concluidos = agendamentos.filter(a => a.status === 'concluido');
    const vendasPagas = vendas.filter(v => v.status === 'pago');
    const totalGasto = concluidos.reduce((acc, a) => acc + a.valor_total, 0) + vendasPagas.reduce((acc, v) => acc + v.valor_total, 0);

    res.json({
      cliente,
      agendamentos,
      vendas,
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
