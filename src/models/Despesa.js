import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const Despesa = sequelize.define('Despesa', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  descricao: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  tipo: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'fixo' // 'fixo' or 'variavel'
  },
  categoria: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  data_documento: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  data_vencimento: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  data_pagamento: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  pago: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Aberto' // 'Aberto', 'Pago', 'Vencido', 'Cancelado'
  },
  numero_documento: {
    type: DataTypes.STRING(100),
    defaultValue: ''
  },
  fornecedor: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  baixado_por: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  baixado_em: {
    type: DataTypes.DATE,
    allowNull: true
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  entrada_estoque_id: {
    type: DataTypes.STRING(36),
    allowNull: true
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
  tableName: 'despesas',
  timestamps: false
});

export const getDespesaModel = () => {
  const tenant = getTenantSchema();
  return Despesa.schema(tenant);
};

export default Despesa;
