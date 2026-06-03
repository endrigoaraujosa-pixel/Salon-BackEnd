import { db } from '../config/db.js';
import { Op } from 'sequelize';

const listServ = async (req, res) => {
  try {
    const servs = await db.Servico.findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });
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
    const serv = await db.Servico.create(req.body);
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
    const serv = await db.Servico.findByPk(req.params.sid);
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
    const { params, user } = req;

    // Verificar se o serviço possui agendamento em aberto, confirmado ou em andamento
    const activeAgendamentos = await db.Agendamento.findAll({
      attributes: ['id', 'itens'],
      where: {
        deletado: 'N',
        status: { [Op.in]: ['agendado', 'confirmado', 'em_andamento'] }
      }
    });

    const hasActiveAppointment = activeAgendamentos.some(ag => {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }
      return Array.isArray(itens) && itens.some(item => item.servico_id === params.sid);
    });

    if (hasActiveAppointment) {
      console.warn(`[AUDIT] Tentativa de exclusão de serviço bloqueada: O serviço ID ${params.sid} possui agendamentos ativos.`);
      return res.status(400).json({ detail: "Não é permitido excluir um serviço que possui agendamentos em aberto, confirmados ou em andamento." });
    }

    const serv = await db.Servico.findByPk(params.sid);
    if (serv) {
      await serv.update({
        deletado: 'S',
        deletado_por: user ? user.name : 'Sistema',
        deletado_em: new Date()
      });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export { createServ, deleteServ, listServ, updateServ };

