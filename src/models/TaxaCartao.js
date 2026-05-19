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
  }
}, {
  tableName: 'taxas_cartao',
  timestamps: false
});

export default TaxaCartao;
