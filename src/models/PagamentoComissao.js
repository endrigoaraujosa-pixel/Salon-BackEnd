import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const PagamentoComissao = sequelize.define('PagamentoComissao', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  periodo: {
    type: DataTypes.STRING(50), // Pode armazenar 'YYYY-MM' ou 'YYYY-MM-DD_YYYY-MM-DD'
    allowNull: false
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  data_pagamento: {
    type: DataTypes.DATE,
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
  tableName: 'pagamentos_comissao',
  timestamps: false
});

export const getPagamentoComissaoModel = () => {
  const tenant = getTenantSchema();
  return PagamentoComissao.schema(tenant);
};

export default PagamentoComissao;
