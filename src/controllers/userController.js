import User from '../models/User.js';
import PerfilAcesso from '../models/PerfilAcesso.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const listUsers = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    
    let whereClause = { deletado: 'N' };
    if (!isAdmin) {
      whereClause.id = req.user.id;
    }

    const users = await User.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'email', 'role', 'perfil_acesso_id', 'colaborador_id', 'ativo', 'pode_alterar_concluido', 'pode_excluir_agendamento', 'pode_excluir_pagamento', 'created_at'],
      order: [['name', 'ASC']]
    });
    res.json(users);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ detail: 'Acesso restrito a administradores' });
    }
    const { name, email, role, perfil_acesso_id, colaborador_id, ativo, senha, pode_alterar_concluido, pode_excluir_agendamento, pode_excluir_pagamento } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ detail: 'Email e senha são obrigatórios' });
    }
    
    const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(400).json({ detail: 'Este email já está cadastrado' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(senha, salt);

    let calculatedRole = role || 'funcionario';
    if (perfil_acesso_id) {
      const p = await PerfilAcesso.findByPk(perfil_acesso_id);
      if (p) {
        if (p.nome === 'Administrador' || p.permissoes?.acoes?.is_admin) {
          calculatedRole = 'admin';
        } else {
          calculatedRole = 'funcionario';
        }
      }
    }

    const user = await User.create({
      id: uuidv4(),
      name,
      email: email.toLowerCase().trim(),
      role: calculatedRole,
      perfil_acesso_id: perfil_acesso_id || null,
      colaborador_id: colaborador_id || null,
      ativo: ativo !== undefined ? ativo : true,
      pode_alterar_concluido: pode_alterar_concluido || false,
      pode_excluir_agendamento: pode_excluir_agendamento || false,
      pode_excluir_pagamento: pode_excluir_pagamento || false,
      password_hash
    });

    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      perfil_acesso_id: user.perfil_acesso_id,
      colaborador_id: user.colaborador_id,
      ativo: user.ativo,
      pode_alterar_concluido: user.pode_alterar_concluido,
      pode_excluir_agendamento: user.pode_excluir_agendamento,
      pode_excluir_pagamento: user.pode_excluir_pagamento
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const isEditingSelf = req.params.id === req.user.id;

    if (!isAdmin && !isEditingSelf) {
      return res.status(403).json({ detail: 'Você não tem permissão para editar outros usuários.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ detail: 'Usuário não encontrado' });
    }

    const { name, email, role, perfil_acesso_id, colaborador_id, ativo, senha, pode_alterar_concluido, pode_excluir_agendamento, pode_excluir_pagamento } = req.body;

    if (!isAdmin && isEditingSelf) {
      if (senha && senha.trim()) {
        const salt = await bcrypt.genSalt(10);
        user.password_hash = await bcrypt.hash(senha, salt);
        await user.save();
        return res.json({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          perfil_acesso_id: user.perfil_acesso_id,
          colaborador_id: user.colaborador_id,
          ativo: user.ativo,
          pode_alterar_concluido: user.pode_alterar_concluido,
          pode_excluir_agendamento: user.pode_excluir_agendamento,
          pode_excluir_pagamento: user.pode_excluir_pagamento
        });
      }
      return res.status(400).json({ detail: 'Nenhuma alteração enviada ou permitida.' });
    }

    if (email && email.toLowerCase().trim() !== user.email) {
      const existing = await User.findOne({ where: { email: email.toLowerCase().trim() } });
      if (existing) {
        return res.status(400).json({ detail: 'Este email já está cadastrado' });
      }
      user.email = email.toLowerCase().trim();
    }

    if (name !== undefined) user.name = name;
    
    if (perfil_acesso_id !== undefined) {
      user.perfil_acesso_id = perfil_acesso_id;
      if (perfil_acesso_id) {
        const p = await PerfilAcesso.findByPk(perfil_acesso_id);
        if (p) {
          if (p.nome === 'Administrador' || p.permissoes?.acoes?.is_admin) {
            user.role = 'admin';
          } else {
            user.role = 'funcionario';
          }
        }
      } else {
        user.role = 'funcionario';
      }
    } else if (role !== undefined) {
      user.role = role;
    }

    if (ativo !== undefined) user.ativo = ativo;
    if (colaborador_id !== undefined) user.colaborador_id = colaborador_id || null;
    if (pode_alterar_concluido !== undefined) user.pode_alterar_concluido = pode_alterar_concluido;
    if (pode_excluir_agendamento !== undefined) user.pode_excluir_agendamento = pode_excluir_agendamento;
    if (pode_excluir_pagamento !== undefined) user.pode_excluir_pagamento = pode_excluir_pagamento;

    if (senha && senha.trim()) {
      const salt = await bcrypt.genSalt(10);
      user.password_hash = await bcrypt.hash(senha, salt);
    }

    await user.save();

    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      perfil_acesso_id: user.perfil_acesso_id,
      colaborador_id: user.colaborador_id,
      ativo: user.ativo,
      pode_alterar_concluido: user.pode_alterar_concluido,
      pode_excluir_agendamento: user.pode_excluir_agendamento,
      pode_excluir_pagamento: user.pode_excluir_pagamento
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ detail: 'Acesso restrito a administradores' });
    }
    const user = await User.findByPk(req.params.id);
    if (user) {
      if (user.id === req.user.id) {
        return res.status(400).json({ detail: 'Você não pode excluir o próprio usuário conectado' });
      }
      await user.update({
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

export {
  listUsers,
  createUser,
  updateUser,
  deleteUser
};
