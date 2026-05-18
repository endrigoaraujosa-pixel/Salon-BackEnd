import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const Colaborador = sequelize.define('Colaborador', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  cargo: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  telefone: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  comissao_principal: {
    type: DataTypes.FLOAT,
    defaultValue: 40
  },
  comissao_auxiliar: {
    type: DataTypes.FLOAT,
    defaultValue: 20
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'colaboradores'
});

export default Colaborador;
