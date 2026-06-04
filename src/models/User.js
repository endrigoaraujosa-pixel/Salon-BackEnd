import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const User = sequelize.define('User', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  email: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: false
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  name: {
    type: DataTypes.STRING(255)
  },
  role: {
    type: DataTypes.STRING(50),
    defaultValue: 'funcionario'
  },
  perfil_acesso_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  pode_alterar_concluido: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pode_excluir_agendamento: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  pode_excluir_pagamento: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  deletado: {
    type: DataTypes.STRING(1),
    defaultValue: 'N',
    allowNull: false
  },
  deletado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  deletado_em: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'users'
  
});

export const getUserModel = () => {
  const tenant = getTenantSchema();

  return User.schema(tenant);
};

export default User;
