import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Cliente = sequelize.define('Cliente', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  telefone: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  email: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  data_nascimento: {
    type: DataTypes.STRING(20),
    defaultValue: ''
  },
  endereco: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  criado_em: {
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
  tableName: 'clientes'
});

export default Cliente;
