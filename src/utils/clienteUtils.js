import { Op } from 'sequelize';
import { getClienteModel } from '../models/Cliente.js';

/**
 * Busca um cliente ativo pelo número de telefone como identificador principal.
 * Remove caracteres não numéricos e compara os últimos dígitos (suporta formatos variados).
 * 
 * @param {string} telefoneInput - Número de telefone em qualquer formato
 * @param {object} options - Opções adicionais do Sequelize (ex: { transaction })
 * @returns {Promise<object|null>} Cliente Sequelize ou null se não encontrado
 */
export const findClienteByTelefone = async (telefoneInput, options = {}) => {
  if (!telefoneInput) return null;

  const digits = String(telefoneInput).replace(/\D/g, '');
  if (!digits || digits.length < 8) return null;

  const last8 = digits.slice(-8);
  const Cliente = getClienteModel();

  // Buscar todos os clientes ativos com telefone cadastrado
  const candidates = await Cliente.findAll({
    where: {
      deletado: 'N',
      telefone: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] }
    },
    ...options
  });

  // Encontrar correspondência onde os últimos 8 dígitos numéricos coincidem
  const match = candidates.find(c => {
    if (!c.telefone) return false;
    const cDigits = String(c.telefone).replace(/\D/g, '');
    if (cDigits.length < 8) return false;
    return cDigits.endsWith(last8) || digits.endsWith(cDigits.slice(-8));
  });

  return match || null;
};
