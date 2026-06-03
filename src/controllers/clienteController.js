import { db } from '../config/db.js';
import { Op } from 'sequelize';

const listClientes = async (req, res) => {
  try {
    const clientes = await db.Cliente.findAll({
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
    const cliente = await db.Cliente.create(req.body);
    res.status(201).json(cliente);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateCliente = async (req, res) => {
  try {
    const cliente = await db.Cliente.findByPk(req.params.cid);
    if (!cliente) return res.status(404).json({ detail: 'Cliente não encontrado' });
    
    await cliente.update(req.body);
    res.json(cliente);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteCliente = async (req, res) => {
  try {
    const cliente = await db.Cliente.findByPk(req.params.cid);
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
    const cliente = await db.Cliente.findByPk(req.params.cid);
    if (!cliente) return res.status(404).json({ detail: 'Cliente não encontrado' });

    const agendamentos = await db.Agendamento.findAll({
      where: { cliente_id: req.params.cid, deletado: 'N' },
      order: [['data_hora', 'DESC']],
      limit: 100
    });

    const vendas = await db.VendaDireta.findAll({
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

const rankingClientes = async (req, res) => {
  try {
    const { startDate, endDate, limit = 10, type = 'consumo' } = req.query;
    
    const clientes = await db.Cliente.findAll({
      where: { deletado: 'N' }
    });

    const agendWhere = { deletado: 'N', status: 'concluido' };
    const vendaWhere = { deletado: 'N', status: 'pago' };

    if (startDate || endDate) {
      const dateRange = {};
      if (startDate) dateRange[Op.gte] = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateRange[Op.lte] = end;
      }
      agendWhere.data_hora = dateRange;
      vendaWhere.data_venda = dateRange;
    }

    const AgendamentoModel = db.Agendamento;
    const VendaDiretaModel = db.VendaDireta;

    const agendamentos = await AgendamentoModel.findAll({
      attributes: [
        'cliente_id',
        [AgendamentoModel.sequelize.fn('SUM', AgendamentoModel.sequelize.col('valor_total')), 'total_gasto'],
        [AgendamentoModel.sequelize.fn('COUNT', AgendamentoModel.sequelize.col('id')), 'total_visitas']
      ],
      where: agendWhere,
      group: ['cliente_id'],
      raw: true
    });

    const vendas = await VendaDiretaModel.findAll({
      attributes: [
        'cliente_id',
        [VendaDiretaModel.sequelize.fn('SUM', VendaDiretaModel.sequelize.col('valor_total')), 'total_gasto']
      ],
      where: vendaWhere,
      group: ['cliente_id'],
      raw: true
    });

    const rankingMap = {};

    clientes.forEach(c => {
      rankingMap[c.id] = {
        cliente_id: c.id,
        nome: c.nome,
        telefone: c.telefone || "",
        email: c.email || "",
        total_gasto: 0,
        total_visitas: 0
      };
    });

    agendamentos.forEach(a => {
      if (rankingMap[a.cliente_id]) {
        rankingMap[a.cliente_id].total_gasto += Number(a.total_gasto || 0);
        rankingMap[a.cliente_id].total_visitas += Number(a.total_visitas || 0);
      }
    });

    vendas.forEach(v => {
      if (rankingMap[v.cliente_id]) {
        rankingMap[v.cliente_id].total_gasto += Number(v.total_gasto || 0);
      }
    });

    const rankingArray = Object.values(rankingMap);

    if (type === 'visitas') {
      rankingArray.sort((a, b) => b.total_visitas - a.total_visitas || b.total_gasto - a.total_gasto);
    } else if (type === 'todos') {
      rankingArray.sort((a, b) => a.nome.localeCompare(b.nome));
    } else {
      rankingArray.sort((a, b) => b.total_gasto - a.total_gasto || b.total_visitas - a.total_visitas);
    }

    const result = type === 'todos' ? rankingArray : rankingArray.slice(0, Number(limit));

    const ranked = result.map((item, idx) => ({
      ...item,
      posicao: idx + 1
    }));

    res.json(ranked);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listClientes,
  createCliente,
  updateCliente,
  deleteCliente,
  historicoCliente,
  rankingClientes
};
