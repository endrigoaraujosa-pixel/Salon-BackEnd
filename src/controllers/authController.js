import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getUserModel } from '../models/User.js';
import { getPerfilAcessoModel } from '../models/PerfilAcesso.js';

const isMobileRequest = (req) => {
  const userAgent = req.headers['user-agent'] || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  const isMobileHeader = req.headers['x-is-mobile'] === 'true';
  return isMobileUA || isMobileHeader;
};

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await getUserModel().findOne({ where: { email: email.toLowerCase().trim(), deletado: 'N' } });

    if (!user || !(await bcrypt.compare(password, user.password_hash)) || !user.ativo) {
      return res.status(400).json({ detail: 'Email ou senha inválidos' });
    }

    const isMobile = isMobileRequest(req);

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30m' }
    );

    const refreshToken = jwt.sign(
      { sub: user.id },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_refresh',
      { expiresIn: '1d' }
    );

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 60 * 1000,
      path: '/'
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/'
    });

    const perfil = user.perfil_acesso_id ? await getPerfilAcessoModel().findByPk(user.perfil_acesso_id) : null;

    res.json({
      token,
      user: {
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
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const refreshToken = async (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) {
    return res.status(401).json({ detail: 'Refresh token não encontrado' });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_refresh'
    );

    const user = await getUserModel().findByPk(decoded.sub);

    if (!user || !user.ativo) {
      return res.status(401).json({ detail: 'Usuário não encontrado ou inativo' });
    }

    const isMobile = isMobileRequest(req);
    const tokenExpiry = isMobile ? '30m' : '15m';
    const cookieMaxAge = isMobile ? 30 * 60 * 1000 : 15 * 60 * 1000;

    const newAccessToken = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: tokenExpiry }
    );

    const newRefreshToken = jwt.sign(
      { sub: user.id },
      process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET + '_refresh',
      { expiresIn: isMobile ? '24h' : '1h' }
    );

    res.cookie('access_token', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: cookieMaxAge,
      path: '/'
    });

    res.cookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: isMobile ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    const perfil = user.perfil_acesso_id ? await getPerfilAcessoModel().findByPk(user.perfil_acesso_id) : null;

    res.json({
      token: newAccessToken,
      user: {
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
      }
    });
  } catch (error) {
    res.clearCookie('refresh_token', { path: '/' });
    res.clearCookie('access_token', { path: '/' });
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ detail: 'Refresh token expirado, faça login novamente' });
    }
    return res.status(401).json({ detail: 'Refresh token inválido' });
  }
};

const logout = async (req, res) => {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
  res.json({ ok: true });
};

const me = async (req, res) => {
  res.json(req.user);
};

export { login, logout, me, refreshToken };

