import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const OutrasReceitas = sequelize.define('OutrasReceitas', {
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
  categoria: {
    type: DataTypes.STRING(255),
    defaultValue: ''
  },
  data_recebimento: {
    type: DataTypes.STRING(50),
    defaultValue: ''
  },
  observacoes: {
    type: DataTypes.TEXT,
    defaultValue: ''
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
  tableName: 'outras_receitas',
  timestamps: false
});

export default OutrasReceitas;
