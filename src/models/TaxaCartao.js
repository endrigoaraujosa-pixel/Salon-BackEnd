import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const TaxaCartao = sequelize.define('TaxaCartao', {
  forma_pagamento: {
    type: DataTypes.STRING(50),
    primaryKey: true
  },
  percentual: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  dias_recebimento: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    allowNull: true
  },
  adquirente_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  descricao: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  tipo_cartao: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  bandeira: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  // Installment rates
  taxa_1x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_2x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_3x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_4x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_5x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_6x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_7x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_8x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_9x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_10x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_11x: { type: DataTypes.FLOAT, defaultValue: 0 },
  taxa_12x: { type: DataTypes.FLOAT, defaultValue: 0 },
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
  },
  criado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  criado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  alterado_por_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  alterado_por_nome: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'taxas_cartao',
  timestamps: false
});

export const getTaxaCartaoModel = () => {
  const tenant = getTenantSchema();
  return TaxaCartao.schema(tenant);
};

export default TaxaCartao;
