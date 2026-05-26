import Colaborador from '../models/Colaborador.js';

const listColab = async (req, res) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const attributes = isAdmin 
      ? undefined 
      : ['id', 'nome', 'cargo', 'ativo', 'deletado'];

    const cols = await Colaborador.findAll({
      where: { deletado: 'N' },
      attributes,
      order: [['nome', 'ASC']]
    });
    res.json(cols);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createColab = async (req, res) => {
  try {
    const colab = await Colaborador.create(req.body);
    res.status(201).json(colab);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateColab = async (req, res) => {
  try {
    const colab = await Colaborador.findByPk(req.params.cid);
    if (!colab) return res.status(404).json({ detail: 'Colaborador não encontrado' });
    
    await colab.update(req.body);
    res.json(colab);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteColab = async (req, res) => {
  try {
    const colab = await Colaborador.findByPk(req.params.cid);
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
