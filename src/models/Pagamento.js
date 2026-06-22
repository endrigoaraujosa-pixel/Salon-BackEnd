import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Pagamento = sequelize.define('Pagamento', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  agendamento_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  venda_direta_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  valor_recebido: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  troco: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  credito_gerado: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  forma_pagamento: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  observacao: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  data_hora: {
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
  tableName: 'pagamentos'
});

export const getPagamentoModel = () => {
  const tenant = getTenantSchema();
  return Pagamento.schema(tenant);
};

export default Pagamento;
