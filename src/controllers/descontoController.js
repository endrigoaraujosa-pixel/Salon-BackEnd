import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import { getDescontoModel } from '../models/Desconto.js';
import { getUserModel } from '../models/User.js';

export const listDescontos = async (req, res) => {
  try {
    const list = await getDescontoModel().findAll({
      where: { deletado: 'N' },
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const createDesconto = async (req, res) => {
  const { codigo, descricao, tipo, valor, ativo, itens_vinculados, requer_autorizacao, usuarios_autorizados, incide_comissao } = req.body;

  try {
    if (!codigo || !codigo.trim()) {
      return res.status(400).json({ detail: 'O código do desconto é obrigatório.' });
    }
    const uppercaseCode = codigo.toUpperCase().replace(/\s+/g, "");

    // Check duplicate code
    const existing = await getDescontoModel().findOne({
      where: {
        codigo: uppercaseCode,
        deletado: 'N'
      }
    });
    if (existing) {
      return res.status(400).json({ detail: 'Já existe um desconto ativo cadastrado com esse código.' });
    }

    const discountVal = parseFloat(valor);
    if (isNaN(discountVal) || discountVal <= 0) {
      return res.status(400).json({ detail: 'Insira um valor de desconto válido maior que zero.' });
    }

    const newDiscount = await getDescontoModel().create({
      codigo: uppercaseCode,
      descricao: descricao ? descricao.trim() : null,
      tipo: tipo || 'porcentagem',
      valor: discountVal,
      ativo: ativo !== false,
      itens_vinculados: itens_vinculados ? JSON.stringify(itens_vinculados) : null,
      requer_autorizacao: !!requer_autorizacao,
      incide_comissao: incide_comissao !== false && incide_comissao !== 0,
      usuarios_autorizados: usuarios_autorizados ? JSON.stringify(usuarios_autorizados) : null
    });

    res.status(201).json(newDiscount);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const updateDesconto = async (req, res) => {
  const { id } = req.params;
  const { codigo, descricao, tipo, valor, ativo, itens_vinculados, requer_autorizacao, usuarios_autorizados, incide_comissao } = req.body;

  try {
    const desconto = await getDescontoModel().findOne({ where: { id, deletado: 'N' } });
    if (!desconto) {
      return res.status(444).json({ detail: 'Desconto não encontrado.' });
    }

    const uppercaseCode = codigo.toUpperCase().replace(/\s+/g, "");

    // Check duplicate code (if changed)
    if (uppercaseCode !== desconto.codigo) {
      const existing = await getDescontoModel().findOne({
        where: {
          codigo: uppercaseCode,
          deletado: 'N',
          id: { [Op.ne]: id }
        }
      });
      if (existing) {
        return res.status(400).json({ detail: 'Já existe outro desconto ativo cadastrado com esse código.' });
      }
    }

    const discountVal = parseFloat(valor);
    if (isNaN(discountVal) || discountVal <= 0) {
      return res.status(400).json({ detail: 'Insira um valor de desconto válido maior que zero.' });
    }

    desconto.codigo = uppercaseCode;
    desconto.descricao = descricao ? descricao.trim() : null;
    desconto.tipo = tipo || 'porcentagem';
    desconto.valor = discountVal;
    desconto.ativo = ativo !== false;
    desconto.itens_vinculados = itens_vinculados ? JSON.stringify(itens_vinculados) : null;
    desconto.requer_autorizacao = !!requer_autorizacao;
    desconto.incide_comissao = incide_comissao !== false && incide_comissao !== 0;
    desconto.usuarios_autorizados = usuarios_autorizados ? JSON.stringify(usuarios_autorizados) : null;

    await desconto.save();
    res.json(desconto);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const deleteDesconto = async (req, res) => {
  const { id } = req.params;
  const userName = req.user ? req.user.email : 'system';

  try {
    const desconto = await getDescontoModel().findOne({ where: { id, deletado: 'N' } });
    if (!desconto) {
      return res.status(404).json({ detail: 'Desconto não encontrado.' });
    }

    desconto.deletado = 'S';
    desconto.deletado_por = userName;
    desconto.deletado_em = new Date();

    await desconto.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export const validarDescontoAutorizacao = async (req, res) => {
  const { id, email, password } = req.body;

  try {
    const desconto = await getDescontoModel().findOne({ where: { id, deletado: 'N' } });
    if (!desconto) {
      return res.status(444).json({ detail: 'Desconto não encontrado.' });
    }

    // Find the authorizing user
    const user = await getUserModel().findOne({
      where: {
        email: email.toLowerCase().trim(),
        deletado: 'N'
      }
    });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Credenciais inválidas para autorização.' });
    }

    if (!user.ativo) {
      return res.status(401).json({ detail: 'Este usuário autorizador está inativo.' });
    }

    // Check if the user is authorized to apply this discount.
    // If the discount requires authorization:
    if (desconto.requer_autorizacao) {
      // Admins are always authorized
      if (user.role === 'admin') {
        return res.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
      }

      let authUsers = [];
      try {
        authUsers = desconto.usuarios_autorizados ? JSON.parse(desconto.usuarios_autorizados) : [];
      } catch (e) {
        authUsers = [];
      }

      if (!authUsers.includes(user.id)) {
        return res.status(403).json({ detail: 'Este usuário não possui autorização para aplicar este desconto.' });
      }
    }

    res.json({ success: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};
