import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import PerfilAcesso from '../models/PerfilAcesso.js';

const protect = async (req, res, next) => {
  let token;

  if (req.cookies && req.cookies.access_token) {
    token = req.cookies.access_token;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ detail: 'Não autenticado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.sub);

    if (!user) {
      return res.status(401).json({ detail: 'Usuário não encontrado' });
    }

    const perfil = user.perfil_acesso_id ? await PerfilAcesso.findByPk(user.perfil_acesso_id) : null;

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      colaborador_id: user.colaborador_id,
      perfil_acesso_id: user.perfil_acesso_id,
      perfil: perfil ? perfil.toJSON() : null,
      ativo: user.ativo,
      pode_alterar_concluido: user.pode_alterar_concluido,
      pode_excluir_agendamento: user.pode_excluir_agendamento,
      pode_excluir_pagamento: user.pode_excluir_pagamento
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ detail: 'Sessão expirada' });
    }
    return res.status(401).json({ detail: 'Token inválido' });
  }
};

const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ detail: 'Acesso restrito a administradores' });
  }
};

const requirePermission = (menu, acao) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ detail: 'Não autenticado' });
    }

    // Administrators always bypass all constraints
    if (req.user.role === 'admin') {
      return next();
    }

    // Special Permission overrides
    if (menu === 'agenda' && acao === 'excluir') {
      if (req.user.pode_excluir_agendamento || req.user.pode_excluir_pagamento) {
        return next();
      }
    }

    if (menu === 'vendas' && acao === 'excluir') {
      if (req.user.pode_excluir_pagamento) {
        return next();
      }
    }

    const perfil = req.user.perfil;
    if (!perfil || !perfil.permissoes) {
      return res.status(403).json({ detail: 'Acesso restrito: Perfil de acesso sem permissões definidas.' });
    }

    if (menu) {
      const menusPerm = perfil.permissoes.menus || {};
      if (!menusPerm[menu]) {
        // Permitir listagem (GET) de entidades fundamentais caso possua permissão de Agenda ou Vendas
        const isGetRequest = req.method === 'GET';
        const isFoundationalMenu = ['clientes', 'colaboradores', 'servicos', 'produtos'].includes(menu);
        const hasAgendaOrVendas = !!(menusPerm.agenda || menusPerm.vendas);

        if (isGetRequest && isFoundationalMenu && hasAgendaOrVendas) {
          // Permissão concedida para uso funcional na Agenda/Vendas
        } else {
          return res.status(403).json({ detail: `Você não tem permissão para acessar este módulo (${menu}).` });
        }
      }
    }

    if (acao) {
      const acoesPerm = perfil.permissoes.acoes || {};
      if (!acoesPerm[acao]) {
        return res.status(403).json({ detail: `Você não tem permissão para realizar esta ação (${acao}).` });
      }
    }

    next();
  };
};

export { protect, admin, requirePermission };
