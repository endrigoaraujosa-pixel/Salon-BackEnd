import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { v4 as uuidv4 } from 'uuid';

const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Email ou senha inválidos' });
    }

    if (!user.ativo) {
      return res.status(401).json({ detail: 'Usuário inativo' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('access_token', token, {
      httpOnly: true,
      secure: false, // set to true in production
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const logout = async (req, res) => {
  res.clearCookie('access_token', { path: '/' });
  res.json({ ok: true });
};

const me = async (req, res) => {
  res.json(req.user);
};

export { login, logout, me };
