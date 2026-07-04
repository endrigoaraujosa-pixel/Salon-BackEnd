import { getColaboradorModel } from '../models/Colaborador.js';

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
  try {
    const { nome } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ detail: 'O preenchimento do campo Nome é obrigatório para a conclusão do cadastro.' });
    }
    const colab = await getColaboradorModel().create(req.body);
    res.status(201).json(colab);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateColab = async (req, res) => {
  try {
    const { nome } = req.body;
    if (nome !== undefined && (!nome || !nome.trim())) {
      return res.status(400).json({ detail: 'O preenchimento do campo Nome é obrigatório para a conclusão do cadastro.' });
    }
    const colab = await getColaboradorModel().findByPk(req.params.cid);
    if (!colab) return res.status(404).json({ detail: 'Colaborador não encontrado' });
    
    await colab.update(req.body);
    res.json(colab);
  } catch (error) {
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

export { listColab, createColab, updateColab, deleteColab };
