import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Pagamento = sequelize.define('Pagamento', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  agendamento_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  valor: {
    type: DataTypes.FLOAT,
    allowNull: false
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
  }
}, {
  tableName: 'pagamentos'
});

export default Pagamento;
