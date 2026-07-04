import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import PerfilAcesso from '../models/PerfilAcesso.js';
import { getTenantSchema } from '../config/tenantContext.js';

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
    const activeTenant = getTenantSchema();
    if (decoded.tenant && decoded.tenant !== activeTenant) {
      return res.status(401).json({ detail: 'Acesso negado: Token inválido para esta sessão/empresa.' });
    }
    const user = await User.schema(activeTenant).findByPk(decoded.sub);

    if (!user) {
      return res.status(401).json({ detail: 'Usuário não encontrado' });
    }

    const perfil = user.perfil_acesso_id ? await PerfilAcesso.schema(getTenantSchema()).findByPk(user.perfil_acesso_id) : null;

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

const requirePermission = (permissionKey, acao) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ detail: 'Não autenticado' });
    }

    // Administrators always bypass all constraints
    if (req.user.role === 'admin') {
      return next();
    }

    // Normalização para o novo formato flat JSON
    let key = permissionKey;
    if (permissionKey && acao) {
      if (permissionKey === 'estoque' && acao.startsWith('estoque.')) {
        key = acao;
      } else if (permissionKey === 'agenda' && acao === 'realizar_pagamento') {
        key = 'agenda.pagamento';
      } else if (permissionKey === 'vendas' && acao === 'realizar_pagamento') {
        key = 'vendas.pagamento';
      } else {
        key = `${permissionKey}.${acao}`;
      }
    } else if (permissionKey && !Array.isArray(permissionKey) && !permissionKey.includes('.')) {
      if (permissionKey === 'receitas') {
        key = 'receitas.visualizar';
      } else {
        key = `${permissionKey}.visualizar`;
      }
    }

    // Special Permission overrides (acts as additional overrides even if they have a profile)
    if (key === 'agenda.excluir' && req.user.pode_excluir_agendamento) {
      return next();
    }
    if ((key === 'vendas.cancelar' || key === 'vendas.excluir' || key === 'agenda.pagamento.excluir') && req.user.pode_excluir_pagamento) {
      return next();
    }

    const perfil = req.user.perfil;
    if (!perfil || !perfil.permissoes) {
      return res.status(403).json({ detail: 'Acesso restrito: Perfil de acesso sem permissões definidas.' });
    }

    // Permissão para visualizar deletados da lixeira de um módulo específico
    if (key === 'auditoria.visualizar') {
      const modulo = req.query.modulo;
      if (modulo === 'agendamento' && perfil.permissoes['agenda.excluir'] === true) {
        return next();
      }
      if (modulo === 'cliente' && perfil.permissoes['clientes.excluir'] === true) {
        return next();
      }
      if (modulo === 'colaborador' && perfil.permissoes['colaboradores.excluir'] === true) {
        return next();
      }
      if (modulo === 'servico' && perfil.permissoes['servicos.excluir'] === true) {
        return next();
      }
      if (modulo === 'produto' && perfil.permissoes['produtos.excluir'] === true) {
        return next();
      }
      if ((modulo === 'venda' || modulo === 'venda_direta') && perfil.permissoes['vendas.cancelar'] === true) {
        return next();
      }
      if (modulo === 'despesa' && perfil.permissoes['despesas.excluir'] === true) {
        return next();
      }
      if (modulo === 'receita' && perfil.permissoes['receitas.excluir'] === true) {
        return next();
      }
    }

    // Permissão para restaurar registros da lixeira de um módulo específico
    if (key === 'auditoria.restaurar') {
      const modulo = req.body && req.body.modulo;
      if (modulo === 'agendamento' && perfil.permissoes['agenda.excluir'] === true) {
        return next();
      }
      if (modulo === 'cliente' && perfil.permissoes['clientes.excluir'] === true) {
        return next();
      }
      if (modulo === 'colaborador' && perfil.permissoes['colaboradores.excluir'] === true) {
        return next();
      }
      if (modulo === 'servico' && perfil.permissoes['servicos.excluir'] === true) {
        return next();
      }
      if (modulo === 'produto' && perfil.permissoes['produtos.excluir'] === true) {
        return next();
      }
      if ((modulo === 'venda' || modulo === 'venda_direta') && perfil.permissoes['vendas.cancelar'] === true) {
        return next();
      }
      if (modulo === 'despesa' && perfil.permissoes['despesas.excluir'] === true) {
        return next();
      }
      if (modulo === 'receita' && perfil.permissoes['receitas.excluir'] === true) {
        return next();
      }
    }

    const hasPermission = Array.isArray(key)
      ? key.some(k => perfil.permissoes[k] === true)
      : perfil.permissoes[key] === true;

    if (!hasPermission) {
      // Permitir listagem (GET) de entidades fundamentais caso possua permissão de Agenda ou Vendas
      const isGetRequest = req.method === 'GET';
      const keyString = Array.isArray(key) ? key[0] : key;
      const isFoundationalMenu = ['clientes.visualizar', 'colaboradores.visualizar', 'servicos.visualizar', 'produtos.visualizar'].includes(keyString);
      const hasAgendaOrVendas = !!(perfil.permissoes['agenda.visualizar'] || perfil.permissoes['vendas.visualizar']);

      if (isGetRequest && isFoundationalMenu && hasAgendaOrVendas) {
        return next();
      } else {
        const displayKey = Array.isArray(key) ? key.join(' ou ') : key;
        
        // Log de Tentativa de Acesso Negado (Fuso America/Recife)
        console.warn(`[ACESSO NEGADO] Usuário: ${req.user.email} (${req.user.name}) | Data/Hora: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Recife' })} | Rota: ${req.method} ${req.originalUrl} | Permissão requerida: ${displayKey}`);
        
        return res.status(403).json({ detail: `Você não tem permissão para realizar esta ação (${displayKey}).` });
      }
    }

    next();
  };
};

export { protect, admin, requirePermission };
