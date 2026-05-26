import PerfilAcesso from '../models/PerfilAcesso.js';
import User from '../models/User.js';

// List all profiles
const listarPerfis = async (req, res) => {
  try {
    const perfis = await PerfilAcesso.findAll({
      where: { deletado: 'N' },
      order: [['nome', 'ASC']]
    });
    res.json(perfis);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Retrieve a single profile
const obterPerfil = async (req, res) => {
  try {
    const perfil = await PerfilAcesso.findByPk(req.params.id);
    if (!perfil || perfil.deletado === 'S') {
      return res.status(404).json({ detail: 'Perfil de acesso não encontrado.' });
    }
    res.json(perfil);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Create a new profile
const criarPerfil = async (req, res) => {
  try {
    const { nome, descricao, permissoes } = req.body;
    if (!nome || !nome.trim()) {
      return res.status(400).json({ detail: 'O nome do perfil é obrigatório.' });
    }
    if (!permissoes) {
      return res.status(400).json({ detail: 'As permissões são obrigatórias.' });
    }

    const novoPerfil = await PerfilAcesso.create({
      nome: nome.trim(),
      descricao: descricao || '',
      permissoes,
      ativo: true
    });
    res.status(201).json(novoPerfil);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Update an existing profile
const atualizarPerfil = async (req, res) => {
  try {
    const { nome, descricao, permissoes, ativo } = req.body;
    const perfil = await PerfilAcesso.findByPk(req.params.id);
    if (!perfil || perfil.deletado === 'S') {
      return res.status(404).json({ detail: 'Perfil de acesso não encontrado.' });
    }

    if (nome !== undefined) {
      if (!nome.trim()) {
        return res.status(400).json({ detail: 'O nome do perfil é obrigatório.' });
      }
      perfil.nome = nome.trim();
    }

    if (descricao !== undefined) perfil.descricao = descricao;
    if (permissoes !== undefined) perfil.permissoes = permissoes;
    if (ativo !== undefined) perfil.ativo = ativo;

    await perfil.save();
    res.json(perfil);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

// Soft delete a profile
const deletarPerfil = async (req, res) => {
  try {
    const perfil = await PerfilAcesso.findByPk(req.params.id);
    if (!perfil || perfil.deletado === 'S') {
      return res.status(404).json({ detail: 'Perfil de acesso não encontrado.' });
    }

    // Check if any user is currently linked to this profile
    const userCount = await User.count({
      where: { perfil_acesso_id: perfil.id, deletado: 'N' }
    });
    if (userCount > 0) {
      return res.status(400).json({ 
        detail: 'Este perfil não pode ser excluído pois está vinculado a um ou mais usuários ativos.' 
      });
    }

    // Base default profiles cannot be deleted to avoid crashing the system
    if (perfil.id === 'admin-profile-uuid-0000000000000000000' || perfil.id === 'func-profile-uuid-0000000000000000000') {
      return res.status(400).json({ detail: 'Os perfis base do sistema não podem ser excluídos.' });
    }

    perfil.deletado = 'S';
    perfil.deletado_em = new Date();
    if (req.user) perfil.deletado_por = req.user.name || req.user.email;

    await perfil.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  listarPerfis,
  obterPerfil,
  criarPerfil,
  atualizarPerfil,
  deletarPerfil
};
