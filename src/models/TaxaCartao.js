import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';

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
  tableName: 'taxas_cartao',
  timestamps: false
});

export default TaxaCartao;
