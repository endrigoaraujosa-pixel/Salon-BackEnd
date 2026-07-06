import { getServicoModel } from '../models/Servico.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getColaboradorModel } from '../models/Colaborador.js';
import { getColaboradorComissaoServicoModel } from '../models/ColaboradorComissaoServico.js';
import { sequelize } from '../config/db.js';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';

const listServ = async (req, res) => {
  try {
    const servs = await getServicoModel().findAll({
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
    const { categoria_id, nome } = req.body;
    if (!categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    if (nome) {
      const existing = await getServicoModel().findOne({
        where: {
          nome: sequelize.where(sequelize.fn('LOWER', sequelize.col('nome')), nome.trim().toLowerCase()),
          deletado: 'N'
        }
      });
      if (existing) {
        return res.status(400).json({ detail: 'Já existe um serviço cadastrado com este nome.' });
      }
    }
    console.log("createServ payload received:", JSON.stringify(req.body, null, 2));
    const serv = await getServicoModel().create(req.body);
    console.log("createServ success, saved record:", JSON.stringify(serv.toJSON(), null, 2));
    
    // Inclusão de Novos Serviços:
    // Buscar todos os colaboradores que utilizam comissão avançada e não deletados
    const colaboradoresAvancados = await getColaboradorModel().findAll({
      where: {
        usar_comissao_avancada: true,
        deletado: 'N'
      }
    });

    if (colaboradoresAvancados.length > 0) {
      const comissoesParaInserir = colaboradoresAvancados.map(colab => ({
        id: uuidv4(),
        colaborador_id: colab.id,
        servico_id: serv.id,
        comissao_principal: Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
        comissao_sozinho: Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
        comissao_ajuda: Number(colab.comissao_ajuda !== undefined && colab.comissao_ajuda !== null ? colab.comissao_ajuda : 30),
        comissao_auxiliar: Number(colab.comissao_auxiliar !== undefined && colab.comissao_auxiliar !== null ? colab.comissao_auxiliar : 20)
      }));

      await getColaboradorComissaoServicoModel().bulkCreate(comissoesParaInserir, {
        ignoreDuplicates: true
      });
      console.log(`Comissões automáticas criadas para o novo serviço para ${colaboradoresAvancados.length} colaboradores.`);
    }

    res.status(201).json(serv);
  } catch (error) {
    console.error("createServ error:", error);
    res.status(500).json({ detail: error.message });
  }
};

const updateServ = async (req, res) => {
  try {
    const { categoria_id, nome } = req.body;
    if (categoria_id !== undefined && !categoria_id) {
      return res.status(400).json({ detail: 'A categoria é obrigatória' });
    }
    if (nome) {
      const existing = await getServicoModel().findOne({
        where: {
          nome: sequelize.where(sequelize.fn('LOWER', sequelize.col('nome')), nome.trim().toLowerCase()),
          deletado: 'N',
          id: { [Op.ne]: req.params.sid }
        }
      });
      if (existing) {
        return res.status(400).json({ detail: 'Já existe um serviço cadastrado com este nome.' });
      }
    }
    console.log("updateServ sid:", req.params.sid, "payload received:", JSON.stringify(req.body, null, 2));
    const serv = await getServicoModel().findByPk(req.params.sid);
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
    const activeAgendamentos = await getAgendamentoModel().findAll({
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

    const serv = await getServicoModel().findByPk(params.sid);
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

