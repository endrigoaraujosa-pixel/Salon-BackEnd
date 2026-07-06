import { getColaboradorModel } from '../models/Colaborador.js';
import { getServicoModel } from '../models/Servico.js';
import { getColaboradorComissaoServicoModel } from '../models/ColaboradorComissaoServico.js';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const gerenciarCargaInicialComissaoAvancada = async (colaborador, transaction) => {
  if (!colaborador.usar_comissao_avancada) return;

  const ColabComissaoServicoModel = getColaboradorComissaoServicoModel();
  
  // 1. Verificar se o colaborador já possui registros de comissão por serviço cadastrados
  const count = await ColabComissaoServicoModel.count({
    where: { colaborador_id: colaborador.id },
    transaction
  });

  // Se já possui registros, não executa a carga inicial (preserva edições anteriores)
  if (count > 0) return;

  // 2. Buscar todos os serviços não deletados
  const ServicoModel = getServicoModel();
  const servicos = await ServicoModel.findAll({
    where: { deletado: 'N' },
    transaction
  });

  if (servicos.length === 0) return;

  // 3. Preparar registros para inserção em lote
  const comissoesParaInserir = servicos.map(serv => ({
    id: uuidv4(),
    colaborador_id: colaborador.id,
    servico_id: serv.id,
    comissao_principal: Number(colaborador.comissao_sozinho !== null && colaborador.comissao_sozinho !== undefined ? colaborador.comissao_sozinho : (colaborador.comissao_principal || 40)),
    comissao_sozinho: Number(colaborador.comissao_sozinho !== null && colaborador.comissao_sozinho !== undefined ? colaborador.comissao_sozinho : (colaborador.comissao_principal || 40)),
    comissao_ajuda: Number(colaborador.comissao_ajuda !== undefined && colaborador.comissao_ajuda !== null ? colaborador.comissao_ajuda : 30),
    comissao_auxiliar: Number(colaborador.comissao_auxiliar !== undefined && colaborador.comissao_auxiliar !== null ? colaborador.comissao_auxiliar : 20)
  }));

  // 4. Inserir em lote usando ignoreDuplicates para segurança extra contra concorrência
  await ColabComissaoServicoModel.bulkCreate(comissoesParaInserir, {
    ignoreDuplicates: true,
    transaction
  });
};

const listColab = async (req, res) => {
  try {
    const hasSensitivePerm = req.user && (
      req.user.role === 'admin' ||
      req.user.perfil?.permissoes?.['colaboradores.dados_sensiveis'] === true
    );
    const ownColaboradorId = req.user?.colaborador_id || null;

    const cols = await getColaboradorModel().findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });

    // Se tem permissão global, retorna tudo. Caso contrário, filtra os dados sensíveis,
    // exceto para o colaborador vinculado ao próprio usuário logado.
    const result = hasSensitivePerm
      ? cols
      : cols.map(c => {
          const isOwnProfile = ownColaboradorId && String(c.id) === String(ownColaboradorId);
          if (isOwnProfile) return c; // retorna completo para si mesmo
          // Remove dados sensíveis dos demais
          const { telefone, comissao_sozinho, comissao_ajuda, comissao_auxiliar, comissao_principal, ...safe } = c.toJSON();
          return safe;
        });

    res.json(result);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createColab = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { nome } = req.body;
    if (!nome || !nome.trim()) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'O preenchimento do campo Nome é obrigatório para a conclusão do cadastro.' });
    }
    
    const colab = await getColaboradorModel().create(req.body, { transaction });
    
    // Executa a carga inicial de comissão se usar_comissao_avancada for true
    await gerenciarCargaInicialComissaoAvancada(colab, transaction);

    await transaction.commit();
    res.status(201).json(colab);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const updateColab = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { nome } = req.body;
    if (nome !== undefined && (!nome || !nome.trim())) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'O preenchimento do campo Nome é obrigatório para a conclusão do cadastro.' });
    }
    const colab = await getColaboradorModel().findByPk(req.params.cid, { transaction });
    if (!colab) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Colaborador não encontrado' });
    }
    
    await colab.update(req.body, { transaction });
    
    // Executa a carga inicial de comissão se usar_comissao_avancada for ativada
    await gerenciarCargaInicialComissaoAvancada(colab, transaction);

    await transaction.commit();
    res.json(colab);
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

const deleteColab = async (req, res) => {
  try {
    const colab = await getColaboradorModel().findByPk(req.params.cid);
    if (colab) {
      await colab.update({
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

const getComissoesServico = async (req, res) => {
  try {
    const { cid } = req.params;
    const colab = await getColaboradorModel().findByPk(cid);
    if (!colab) return res.status(404).json({ detail: 'Colaborador não encontrado' });

    // Buscar todos os serviços não deletados
    const servicos = await getServicoModel().findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });

    const ColabComissaoServicoModel = getColaboradorComissaoServicoModel();
    
    // Buscar comissões do colaborador
    const comissoes = await ColabComissaoServicoModel.findAll({
      where: { colaborador_id: cid }
    });

    const comissoesMap = new Map(comissoes.map(c => [c.servico_id, c]));

    const missingComissoes = [];
    
    const result = servicos.map(serv => {
      let com = comissoesMap.get(serv.id);
      
      if (!com && colab.usar_comissao_avancada) {
        // Se falta comissão no banco e comissão avançada está ativa, preparamos para criar automaticamente
        const defaultComissao = {
          id: uuidv4(),
          colaborador_id: cid,
          servico_id: serv.id,
          comissao_principal: Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
          comissao_sozinho: Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
          comissao_ajuda: Number(colab.comissao_ajuda !== undefined && colab.comissao_ajuda !== null ? colab.comissao_ajuda : 30),
          comissao_auxiliar: Number(colab.comissao_auxiliar !== undefined && colab.comissao_auxiliar !== null ? colab.comissao_auxiliar : 20)
        };
        missingComissoes.push(defaultComissao);
        
        return {
          servico_id: serv.id,
          servico_nome: serv.nome,
          servico_descricao: serv.descricao || "",
          comissao_principal: defaultComissao.comissao_principal,
          comissao_sozinho: defaultComissao.comissao_sozinho,
          comissao_ajuda: defaultComissao.comissao_ajuda,
          comissao_auxiliar: defaultComissao.comissao_auxiliar
        };
      }

      return {
        servico_id: serv.id,
        servico_nome: serv.nome,
        servico_descricao: serv.descricao || "",
        comissao_principal: com ? com.comissao_principal : Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
        comissao_sozinho: com ? com.comissao_sozinho : Number(colab.comissao_sozinho !== null && colab.comissao_sozinho !== undefined ? colab.comissao_sozinho : (colab.comissao_principal || 40)),
        comissao_ajuda: com ? com.comissao_ajuda : Number(colab.comissao_ajuda !== undefined && colab.comissao_ajuda !== null ? colab.comissao_ajuda : 30),
        comissao_auxiliar: com ? com.comissao_auxiliar : Number(colab.comissao_auxiliar !== undefined && colab.comissao_auxiliar !== null ? colab.comissao_auxiliar : 20)
      };
    });

    // Persistir comissões ausentes se a comissão avançada estiver ativa
    if (missingComissoes.length > 0) {
      await ColabComissaoServicoModel.bulkCreate(missingComissoes, {
        ignoreDuplicates: true
      });
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateComissoesServico = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { cid } = req.params;
    const { comissoes } = req.body; // array de { servico_id, comissao_sozinho, comissao_ajuda, comissao_auxiliar }

    if (!Array.isArray(comissoes)) {
      await transaction.rollback();
      return res.status(400).json({ detail: 'Formato inválido. Esperado um array de comissões.' });
    }

    const colab = await getColaboradorModel().findByPk(cid, { transaction });
    if (!colab) {
      await transaction.rollback();
      return res.status(404).json({ detail: 'Colaborador não encontrado' });
    }

    const ColabComissaoServicoModel = getColaboradorComissaoServicoModel();

    const comissoesExistentes = await ColabComissaoServicoModel.findAll({
      where: { colaborador_id: cid },
      transaction
    });

    const comissoesMap = new Map(comissoesExistentes.map(c => [c.servico_id, c]));

    for (const c of comissoes) {
      const existing = comissoesMap.get(c.servico_id);
      
      const comissao_sozinho = Number(c.comissao_sozinho);
      const comissao_ajuda = Number(c.comissao_ajuda);
      const comissao_auxiliar = Number(c.comissao_auxiliar);

      if (existing) {
        await existing.update({
          comissao_principal: comissao_sozinho,
          comissao_sozinho,
          comissao_ajuda,
          comissao_auxiliar
        }, { transaction });
      } else {
        await ColabComissaoServicoModel.create({
          id: uuidv4(),
          colaborador_id: cid,
          servico_id: c.servico_id,
          comissao_principal: comissao_sozinho,
          comissao_sozinho,
          comissao_ajuda,
          comissao_auxiliar
        }, { transaction });
      }
    }

    await transaction.commit();
    res.json({ ok: true });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ detail: error.message });
  }
};

export { listColab, createColab, updateColab, deleteColab, getComissoesServico, updateComissoesServico };
