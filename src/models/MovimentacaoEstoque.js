import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';

const MovimentacaoEstoque = sequelize.define('MovimentacaoEstoque', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  produto_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  produto_nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  tipo: {
    type: DataTypes.STRING(50), // 'entrada', 'saida', 'ajuste'
    allowNull: false
  },
  quantidade: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  quantidade_anterior: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  quantidade_atual: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  valor_unitario: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  motivo: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  referencia_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  criado_em: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'movimentacoes_estoque',
  timestamps: true
});

export default MovimentacaoEstoque;
